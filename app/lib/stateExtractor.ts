import { createHash } from 'crypto';
import { createLLMProvider } from '@/app/lib/llm/provider';
import type { LLMRuntimeOverride } from '@/app/lib/llm/types';
import type { StageData, Stage2ExperimentPlan } from '@/app/models/stageData';
import { repairJson } from '@/app/lib/llm/jsonRepair';
import {
  STUDENT_FACT_EXTRACTOR_PROMPT_VERSION,
  STUDENT_FACT_EXTRACTOR_VERSION,
} from '@/app/lib/contractVersions';
import {
  canonicalResearchQuestion,
  researchQuestionHash,
  stage2DraftHash,
} from '@/app/lib/stageState';
import { composeStage2Plan, evaluateStage2Readiness } from '@/app/lib/stage2Readiness';

export const EXTRACTOR_VERSION = STUDENT_FACT_EXTRACTOR_VERSION;
export const EXTRACTOR_PROMPT_VERSION = STUDENT_FACT_EXTRACTOR_PROMPT_VERSION;

export interface ExtractedFact {
  field: string;
  value: unknown;
  sourceQuote: string;
}

export interface RejectedExtractedFact extends ExtractedFact {
  reason: string;
}

export interface ValidatedExtraction {
  accepted: ExtractedFact[];
  rejected: RejectedExtractedFact[];
}

export interface ExtractorCallResult extends ValidatedExtraction {
  rawOutput: string;
  prompt: string;
  promptSha256: string;
  provider: string;
  model: string;
  modelFamily: string;
  generationParams: Record<string, unknown>;
  deterministicFallbacks: string[];
}

export function ensureExplicitConfirmationFact(
  stage: number,
  accepted: ExtractedFact[],
  currentStudentMessage: string,
): { accepted: ExtractedFact[]; applied: boolean } {
  const field = stage === 1 ? 'stage1.confirmed' : null;
  if (!field || accepted.some((fact) => fact.field === field && fact.value === true)) {
    return { accepted, applied: false };
  }
  const patterns = [
    /我(?:已经)?(?:确认|同意)(?!不)[^，。！？\n]{0,24}/,
    /我确定(?:要|就|按|用|这个|该|上述|这样)[^，。！？\n]{0,24}/,
    /(?:就按|按)(?:这个|该|上述)(?:问题|方向|方案)(?:做|进行|来)?/,
    /(?:这个|该|上述)(?:问题|方向|方案)没问题(?!吗|么)/,
    /就这样(?:做|进行)?/,
  ];
  const sourceQuote = patterns.map((pattern) => currentStudentMessage.match(pattern)?.[0]?.trim()).find(Boolean);
  if (!sourceQuote) return { accepted, applied: false };
  return {
    accepted: [...accepted, { field, value: true, sourceQuote }],
    applied: true,
  };
}

const ALLOWED_FIELDS: Record<number, Record<string, 'string' | 'string[]' | 'number' | 'boolean'>> = {
  1: {
    'stage1.originalInterest': 'string',
    'stage1.retainedFeature': 'string',
    'stage1.classroomProxy': 'string',
    'stage1.researchQuestion': 'string',
    'stage1.confirmed': 'boolean',
  },
  2: {
    'stage2.hypothesis': 'string',
    'stage2.independentVariable.name': 'string',
    'stage2.independentVariable.levels': 'string[]',
    'stage2.dependentVariable.name': 'string',
    'stage2.dependentVariable.measurement': 'string',
    'stage2.dependentVariable.unit': 'string',
    'stage2.controlledVariables': 'string[]',
    'stage2.materials': 'string[]',
    'stage2.procedure': 'string[]',
    'stage2.repeatCount': 'number',
    'stage2.safetyNotes': 'string[]',
  },
};

function modelFamily(provider: string, model: string): string {
  const normalized = model.toLowerCase();
  if (normalized.includes('deepseek')) return 'deepseek';
  if (normalized.includes('qwen')) return 'qwen';
  if (normalized.includes('claude')) return 'anthropic';
  if (/gpt|o\d|openai/.test(normalized) || provider === 'openai') return 'openai';
  return `${provider}:${normalized.split(/[-_:]/)[0] || 'unknown'}`;
}

function parseFacts(raw: string): ExtractedFact[] {
  const candidates = [raw.trim()];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);
  for (const candidate of candidates) {
    for (const repaired of [candidate, repairJson(candidate)]) {
      try {
        const parsed = JSON.parse(repaired) as unknown;
        const facts = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === 'object' && Array.isArray((parsed as { facts?: unknown }).facts)
            ? (parsed as { facts: unknown[] }).facts
            : [];
        return facts.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const fact = item as Record<string, unknown>;
          return typeof fact.field === 'string' && typeof fact.sourceQuote === 'string'
            ? [{ field: fact.field, value: fact.value, sourceQuote: fact.sourceQuote }]
            : [];
        });
      } catch {
        // Try next representation.
      }
    }
  }
  return [];
}

function valueMatches(value: unknown, type: string): boolean {
  if (type === 'string') return typeof value === 'string' && value.trim().length > 0;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string[]') return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim());
  return false;
}

function explicitlyAnswersNoList(field: string, value: unknown, sourceQuote: string): boolean {
  if (!Array.isArray(value) || value.length > 0) return true;
  const labels = field === 'stage2.controlledVariables'
    ? '(?:控制变量|控制条件|保持不变的条件|需要保持一致的条件)'
    : field === 'stage2.safetyNotes'
      ? '(?:安全风险|安全事项|安全注意|特别风险)'
      : null;
  if (!labels) return false;
  if (/(?:还没|尚未|暂未|没想好|没有想好|不知道|不清楚|未确定)/.test(sourceQuote)) return false;
  return new RegExp(`(?:没有|无|不需要|无需)(?:额外|其他|特别)?(?:的)?${labels}|${labels}.{0,6}(?:没有|无|不需要|无需)`).test(sourceQuote);
}

export function validateExtractedFacts(
  stage: number,
  facts: ExtractedFact[],
  studentMessages: string[],
): ValidatedExtraction {
  const accepted: ExtractedFact[] = [];
  const rejected: RejectedExtractedFact[] = [];
  const allowed = ALLOWED_FIELDS[stage] ?? {};
  for (const fact of facts) {
    const sourceQuote = fact.sourceQuote.trim();
    let reason = '';
    if (!Object.hasOwn(allowed, fact.field)) reason = 'FIELD_NOT_ALLOWED_FOR_STAGE';
    else if (!sourceQuote || !studentMessages.some((message) => message.includes(sourceQuote))) reason = 'SOURCE_QUOTE_NOT_FOUND_IN_STUDENT_MESSAGES';
    else if (!valueMatches(fact.value, allowed[fact.field])) reason = 'VALUE_TYPE_INVALID';
    else if (!explicitlyAnswersNoList(fact.field, fact.value, sourceQuote)) reason = 'EMPTY_LIST_NOT_EXPLICIT';
    else if (fact.field.endsWith('.confirmed') && fact.value === true && !/(确认|确定|就这样|没问题|可以|同意|按这个)/.test(sourceQuote)) reason = 'CONFIRMATION_NOT_EXPLICIT';
    if (reason) rejected.push({ ...fact, reason });
    else accepted.push({ ...fact, sourceQuote });
  }
  return { accepted, rejected };
}

export function buildExtractorPrompt(stage: number): string {
  const allowed = ALLOWED_FIELDS[stage] ?? {};
  return `你是版本化的学生事实提取器 ${EXTRACTOR_VERSION}。你不是导师，不生成教学语言。
只能从提供的 currentStudentMessage 逐字增量提取事实；existingFacts 和 expectedFocusId 只帮助理解短回答，不能作为 sourceQuote，导师历史绝不能当作事实来源。
只允许当前阶段字段：${JSON.stringify(allowed)}
每条事实必须包含能在学生消息中逐字定位的非空 sourceQuote。信息不足就不输出，不得推测、补全常识或改写引文。
只有学生明确表达确认时，confirmed 才能为 true。
阶段2的 controlledVariables 和 safetyNotes 可以是空数组，但只有学生明确说“没有/无”时才能输出空数组；未回答时不要输出该字段。
只输出 JSON：{"facts":[{"field":"...","value":...,"sourceQuote":"学生原文"}]}`;
}

function appendFallback(
  accepted: ExtractedFact[],
  field: string,
  value: unknown,
  sourceQuote: string,
  fallback: string,
  fallbacks: string[],
) {
  if (accepted.some((item) => item.field === field)) return;
  accepted.push({ field, value, sourceQuote });
  fallbacks.push(fallback);
}

function numericLevels(message: string): { values: string[]; sourceQuote: string } | null {
  const levelContext = /(?:水平|组别|各组|四组|三组|两组|档|梯度|时长|温度|浓度|剂量)/.test(message);
  const mostlyNumeric = message.replace(/[\d.\s、,，;；/|小时分钟秒天厘米毫米米克毫升升℃°C%组档个种]/g, '').length <= 4;
  if (!levelContext && !mostlyNumeric) return null;
  const matches = [...message.matchAll(/-?\d+(?:\.\d+)?\s*(?:小时|分钟|秒|天|厘米|毫米|米|克|毫升|升|℃|°C|%)?/g)]
    .map((match) => match[0].replace(/\s+/g, '').trim())
    .filter(Boolean);
  const values = [...new Set(matches)];
  if (values.length < 2 || values.length > 12) return null;
  const sharedUnit = values.map((value) => value.match(/[^\d.\-]+$/)?.[0]).find(Boolean);
  return {
    values: sharedUnit ? values.map((value) => /[^\d.\-]+$/.test(value) ? value : `${value}${sharedUnit}`) : values,
    sourceQuote: message.trim(),
  };
}

function repeatCount(message: string): { value: number; sourceQuote: string } | null {
  const patterns = [
    /每(?:组|个水平|种条件)[^\d]{0,8}(\d+)\s*(?:个|颗|株|份|次|轮)/,
    /(?:各|每种)[^\d]{0,8}(\d+)\s*(?:个|颗|株|份|次|轮)/,
    /重复\s*(\d+)\s*次/,
    /(\d+)\s*(?:个|颗|株|份|次)\s*(?:取|求|算)平均/,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    const value = Number(match?.[1]);
    if (match && Number.isInteger(value) && value >= 1 && value <= 20) {
      return { value, sourceQuote: match[0].trim() };
    }
  }
  return null;
}

export function applyDeterministicExtractionFallbacks(
  stage: number,
  acceptedInput: ExtractedFact[],
  currentStudentMessage: string,
  context: { expectedFocusId?: string } = {},
): { accepted: ExtractedFact[]; fallbacks: string[] } {
  const accepted = [...acceptedInput];
  const fallbacks: string[] = [];
  if (stage === 1) {
    const confirmed = ensureExplicitConfirmationFact(stage, accepted, currentStudentMessage);
    return {
      accepted: confirmed.accepted,
      fallbacks: confirmed.applied ? ['explicit_confirmation'] : [],
    };
  }
  if (stage !== 2) return { accepted, fallbacks };

  const levels = numericLevels(currentStudentMessage);
  if (levels) appendFallback(accepted, 'stage2.independentVariable.levels', levels.values, levels.sourceQuote, 'numeric_levels', fallbacks);
  const repeats = repeatCount(currentStudentMessage);
  if (repeats) appendFallback(accepted, 'stage2.repeatCount', repeats.value, repeats.sourceQuote, 'repeat_count', fallbacks);
  const controls = currentStudentMessage.match(/其他(?:的|条件)?(?:都|均|全部)?(?:一样|相同|保持不变)/)?.[0];
  if (controls) appendFallback(accepted, 'stage2.controlledVariables', ['其他条件保持一致'], controls, 'generic_controls', fallbacks);
  if (context.expectedFocusId === 'dependent_variable') {
    const explicitResult = currentStudentMessage.match(/((?:豆苗|幼苗|植株|茎|豆)(?:的)?[^，。；\n]{0,6}(?:高度|长度))/)?.[1]
      ?? currentStudentMessage.match(/(?:测量|记录|观察)[^，。；\n]{0,10}?((?:高度|长度))/)?.[1];
    const endpoints = currentStudentMessage.match(/从\s*([^，。；\s]{1,10})\s*(?:量)?到\s*([^，。；\s]{1,10})/);
    if (endpoints) {
      appendFallback(
        accepted,
        'stage2.dependentVariable.name',
        `${endpoints[1]}到${endpoints[2]}的长度`,
        endpoints[0],
        'dependent_endpoint_length',
        fallbacks,
      );
    } else if (explicitResult) {
      appendFallback(accepted, 'stage2.dependentVariable.name', explicitResult, explicitResult, 'dependent_result_phrase', fallbacks);
    }
  }
  return { accepted, fallbacks };
}

export async function callStudentFactExtractor(input: {
  stage: number;
  studentMessages: string[];
  expectedFocusId?: string;
  existingFacts?: StageData['extractedFacts'];
  runtimeModel?: LLMRuntimeOverride;
}): Promise<ExtractorCallResult> {
  if (![1, 2].includes(input.stage)) {
    return {
      accepted: [], rejected: [], rawOutput: '{"facts":[]}', prompt: '', promptSha256: '',
      provider: '', model: '', modelFamily: '', generationParams: {}, deterministicFallbacks: [],
    };
  }
  const providerName = input.runtimeModel?.provider ?? process.env.EXTRACTOR_LLM_PROVIDER ?? process.env.LLM_PROVIDER ?? 'deepseek';
  const model = input.runtimeModel?.model ?? process.env.EXTRACTOR_LLM_MODEL ?? process.env.LLM_MODEL ?? (providerName === 'openai' ? 'gpt-4o-mini' : 'deepseek-v4-pro');
  const prompt = buildExtractorPrompt(input.stage);
  const provider = createLLMProvider({ provider: providerName, model, role: 'EVALUATOR' });
  const completion = await provider.complete([
    { role: 'system', content: prompt },
    { role: 'user', content: JSON.stringify({
      currentStudentMessage: input.studentMessages.at(-1) ?? '',
      expectedFocusId: input.expectedFocusId,
      existingFacts: input.existingFacts ?? {},
    }) },
  ], { useJsonFormat: true, maxTokens: 1400 });
  const validated = validateExtractedFacts(input.stage, parseFacts(completion.content), input.studentMessages);
  const deterministic = applyDeterministicExtractionFallbacks(
    input.stage,
    validated.accepted,
    input.studentMessages.at(-1) ?? '',
    { expectedFocusId: input.expectedFocusId },
  );
  return {
    ...validated,
    accepted: deterministic.accepted,
    rawOutput: completion.content,
    prompt,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
    provider: providerName,
    model,
    modelFamily: modelFamily(providerName, model),
    generationParams: {
      ...completion.request,
      finishReason: completion.finishReason,
      usage: completion.usage,
      expectedFocusId: input.expectedFocusId,
      deterministicFallbacks: deterministic.fallbacks,
    },
    deterministicFallbacks: deterministic.fallbacks,
  };
}

const CORE_FIELD_FOCUS: Record<string, string> = {
  'stage2.hypothesis': 'hypothesis',
  'stage2.independentVariable.name': 'independent_variable',
  'stage2.independentVariable.levels': 'levels',
  'stage2.dependentVariable.name': 'dependent_variable',
  'stage2.dependentVariable.measurement': 'measurement',
  'stage2.dependentVariable.unit': 'measurement',
  'stage2.controlledVariables': 'controls',
  'stage2.repeatCount': 'repeats',
};

function factMap(
  prev: StageData,
  accepted: ExtractedFact[],
  context: { currentStudentMessage?: string; expectedFocusId?: string },
) {
  const facts = { ...(prev.extractedFacts ?? {}) };
  const explicitRevision = /(?:改成|改为|调整为|换成|重新|修改|更正|不是.{0,12}而是)/.test(context.currentStudentMessage ?? '');
  for (const fact of accepted) {
    const focus = CORE_FIELD_FOCUS[fact.field];
    const locked = focus && Object.hasOwn(facts, fact.field) && focus !== context.expectedFocusId && !explicitRevision;
    if (!locked) facts[fact.field] = { value: fact.value, sourceQuote: fact.sourceQuote };
  }
  return facts;
}

function factValue<T>(facts: NonNullable<StageData['extractedFacts']>, field: string): T | undefined {
  return facts[field]?.value as T | undefined;
}

export function buildServerExperimentPlan(stageData: StageData): Stage2ExperimentPlan | null {
  return composeStage2Plan(stageData)?.plan ?? null;
}

export function mergeExtractedFacts(
  stage: number,
  prev: StageData,
  accepted: ExtractedFact[],
  context: { currentStudentMessage?: string; messageId?: string; expectedFocusId?: string } = {},
): { stageData: StageData } {
  const stageData: StageData = { ...prev, extractedFacts: factMap(prev, accepted, context) };
  const facts = stageData.extractedFacts ?? {};
  if (stage === 1) {
    const researchQuestion = factValue<string>(facts, 'stage1.researchQuestion')?.trim();
    if (researchQuestion) {
      const questionHash = researchQuestionHash(researchQuestion);
      const previousQuestion = canonicalResearchQuestion(prev);
      const questionChanged = Boolean(previousQuestion) && researchQuestionHash(previousQuestion) !== questionHash;
      const confirmationFact = accepted.find((item) => item.field === 'stage1.confirmed' && item.value === true);
      const explicitConfirmation = Boolean(confirmationFact) && (
        context.currentStudentMessage === undefined
        || context.currentStudentMessage.includes(confirmationFact!.sourceQuote)
      );
      const previousConfirmationStillValid = prev.stage1?.confirmed === true
        && prev.stage1.confirmedQuestionHash === questionHash
        && !questionChanged;
      const confirmed = explicitConfirmation || previousConfirmationStillValid;
      if (questionChanged && !explicitConfirmation) delete stageData.extractedFacts?.['stage1.confirmed'];
      const originalInterest = factValue<string>(facts, 'stage1.originalInterest')?.trim();
      const retainedFeature = factValue<string>(facts, 'stage1.retainedFeature')?.trim();
      const classroomProxy = factValue<string>(facts, 'stage1.classroomProxy')?.trim();
      const themeMapping = originalInterest && retainedFeature && classroomProxy
        ? { originalInterest, retainedFeature, classroomProxy, researchQuestion }
        : prev.stage1?.themeMapping;
      const snapshot = confirmed
        ? ['《探究问题确认书》', `研究问题：${researchQuestion}`].join('\n')
        : '';
      stageData.stage1 = {
        confirmed,
        snapshot,
        researchQuestion,
        confirmedQuestionHash: confirmed ? questionHash : undefined,
        confirmationSource: confirmed ? {
          type: 'student_explicit',
          sourceQuote: confirmationFact?.sourceQuote ?? prev.stage1?.confirmationSource?.sourceQuote ?? '',
          messageId: explicitConfirmation ? context.messageId : prev.stage1?.confirmationSource?.messageId,
        } : undefined,
        themeMapping,
        factorDirection: prev.stage1?.factorDirection,
        phenomenonDirection: prev.stage1?.phenomenonDirection,
        variables: prev.stage1?.variables,
      };
      return { stageData };
    }
  }
  if (stage === 2) {
    const readiness = evaluateStage2Readiness(stageData);
    const composed = composeStage2Plan(stageData);
    if (composed) {
      const { plan, provenance } = composed;
      const draftHash = stage2DraftHash(plan);
      const unchangedConfirmation = prev.stage2?.confirmedPlanHash === draftHash;
      stageData.stage2 = {
        submitted: prev.stage2?.submitted ?? false,
        approved: prev.stage2?.approved ?? null,
        teacherFeedback: prev.stage2?.teacherFeedback,
        planDraft: plan,
        readiness,
        planProvenance: provenance,
        draftHash,
        confirmedPlanHash: unchangedConfirmation ? prev.stage2?.confirmedPlanHash : undefined,
        confirmationSource: unchangedConfirmation ? prev.stage2?.confirmationSource : undefined,
        experimentPlan: unchangedConfirmation ? prev.stage2?.experimentPlan : undefined,
        schema: unchangedConfirmation && prev.stage2?.schema
          ? prev.stage2.schema
          : { columns: [], minRows: Math.max(3, plan.repeatCount), maxRows: 200 },
        aiRiskAnnotations: unchangedConfirmation ? prev.stage2?.aiRiskAnnotations : undefined,
        factsConfirmed: unchangedConfirmation,
      };
    } else {
      stageData.stage2 = {
        ...(prev.stage2 ?? {}),
        submitted: false,
        approved: null,
        teacherFeedback: prev.stage2?.teacherFeedback,
        planDraft: undefined,
        readiness,
        planProvenance: undefined,
        draftHash: undefined,
        confirmedPlanHash: undefined,
        confirmationSource: undefined,
        experimentPlan: undefined,
        schema: { columns: [], minRows: 3, maxRows: 200 },
        aiRiskAnnotations: undefined,
        factsConfirmed: false,
      };
    }
  }
  return { stageData };
}

export function extractorAllowedFields(stage: number): string[] {
  return Object.keys(ALLOWED_FIELDS[stage] ?? {});
}

export function inferModelFamily(provider: string, model: string): string {
  return modelFamily(provider, model);
}
