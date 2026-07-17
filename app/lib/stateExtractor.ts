import { createHash } from 'crypto';
import { createLLMProvider } from '@/app/lib/llm/provider';
import type { LLMRuntimeOverride } from '@/app/lib/llm/types';
import type { StageData, Stage2ExperimentPlan } from '@/app/models/stageData';
import { repairJson } from '@/app/lib/llm/jsonRepair';

export const EXTRACTOR_VERSION = 'student-fact-extractor-v1';
export const EXTRACTOR_PROMPT_VERSION = 'student-fact-extractor-prompt-v1';

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
}

const ALLOWED_FIELDS: Record<number, Record<string, 'string' | 'string[]' | 'number' | 'boolean'>> = {
  1: {
    'stage1.originalInterest': 'string',
    'stage1.retainedFeature': 'string',
    'stage1.classroomProxy': 'string',
    'stage1.researchQuestion': 'string',
    'stage1.factorDirection': 'string',
    'stage1.phenomenonDirection': 'string',
    'stage1.confirmed': 'boolean',
  },
  2: {
    'stage2.researchQuestion': 'string',
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
    'stage2.confirmed': 'boolean',
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
  if (type === 'string[]') return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim());
  return false;
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
    else if (fact.field.endsWith('.confirmed') && fact.value === true && !/(确认|确定|就这样|没问题|可以|同意|按这个)/.test(sourceQuote)) reason = 'CONFIRMATION_NOT_EXPLICIT';
    if (reason) rejected.push({ ...fact, reason });
    else accepted.push({ ...fact, sourceQuote });
  }
  return { accepted, rejected };
}

export function buildExtractorPrompt(stage: number): string {
  const allowed = ALLOWED_FIELDS[stage] ?? {};
  return `你是版本化的学生事实提取器 ${EXTRACTOR_VERSION}。你不是导师，不生成教学语言。
只能从提供的学生消息逐字提取事实；导师历史不会提供给你，也绝不能当作事实来源。
只允许当前阶段字段：${JSON.stringify(allowed)}
每条事实必须包含能在学生消息中逐字定位的非空 sourceQuote。信息不足就不输出，不得推测、补全常识或改写引文。
只有学生明确表达确认时，confirmed 才能为 true。
只输出 JSON：{"facts":[{"field":"...","value":...,"sourceQuote":"学生原文"}]}`;
}

export async function callStudentFactExtractor(input: {
  stage: number;
  studentMessages: string[];
  runtimeModel?: LLMRuntimeOverride;
}): Promise<ExtractorCallResult> {
  if (![1, 2].includes(input.stage)) {
    return {
      accepted: [], rejected: [], rawOutput: '{"facts":[]}', prompt: '', promptSha256: '',
      provider: '', model: '', modelFamily: '', generationParams: {},
    };
  }
  const providerName = input.runtimeModel?.provider ?? process.env.EXTRACTOR_LLM_PROVIDER ?? process.env.LLM_PROVIDER ?? 'deepseek';
  const model = input.runtimeModel?.model ?? process.env.EXTRACTOR_LLM_MODEL ?? process.env.LLM_MODEL ?? (providerName === 'openai' ? 'gpt-4o-mini' : 'deepseek-v4-pro');
  const prompt = buildExtractorPrompt(input.stage);
  const provider = createLLMProvider({ provider: providerName, model, role: 'EVALUATOR' });
  const completion = await provider.complete([
    { role: 'system', content: prompt },
    { role: 'user', content: JSON.stringify({ studentMessages: input.studentMessages }) },
  ], { useJsonFormat: true, maxTokens: 1400 });
  const validated = validateExtractedFacts(input.stage, parseFacts(completion.content), input.studentMessages);
  return {
    ...validated,
    rawOutput: completion.content,
    prompt,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
    provider: providerName,
    model,
    modelFamily: modelFamily(providerName, model),
    generationParams: { ...completion.request, finishReason: completion.finishReason, usage: completion.usage },
  };
}

function factMap(prev: StageData, accepted: ExtractedFact[]) {
  const facts = { ...(prev.extractedFacts ?? {}) };
  for (const fact of accepted) facts[fact.field] = { value: fact.value, sourceQuote: fact.sourceQuote };
  return facts;
}

function factValue<T>(facts: NonNullable<StageData['extractedFacts']>, field: string): T | undefined {
  return facts[field]?.value as T | undefined;
}

function nonEmptyStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [];
}

export function buildServerExperimentPlan(stageData: StageData): Stage2ExperimentPlan | null {
  const facts = stageData.extractedFacts ?? {};
  const independentName = factValue<string>(facts, 'stage2.independentVariable.name')?.trim();
  const levels = nonEmptyStrings(factValue(facts, 'stage2.independentVariable.levels'));
  const dependentName = factValue<string>(facts, 'stage2.dependentVariable.name')?.trim();
  const measurement = factValue<string>(facts, 'stage2.dependentVariable.measurement')?.trim();
  const repeatCount = factValue<number>(facts, 'stage2.repeatCount');
  if (!independentName || levels.length < 2 || !dependentName || !measurement || !repeatCount || repeatCount < 1) return null;
  return {
    researchQuestion: factValue<string>(facts, 'stage2.researchQuestion')?.trim()
      || stageData.stage1?.themeMapping?.researchQuestion,
    hypothesis: factValue<string>(facts, 'stage2.hypothesis')?.trim(),
    independentVariable: { name: independentName, levels },
    dependentVariable: {
      name: dependentName,
      measurement,
      unit: factValue<string>(facts, 'stage2.dependentVariable.unit')?.trim() || undefined,
    },
    controlledVariables: nonEmptyStrings(factValue(facts, 'stage2.controlledVariables')),
    materials: nonEmptyStrings(factValue(facts, 'stage2.materials')),
    procedure: nonEmptyStrings(factValue(facts, 'stage2.procedure')),
    repeatCount: Math.max(1, Math.min(20, Math.round(repeatCount))),
    safetyNotes: nonEmptyStrings(factValue(facts, 'stage2.safetyNotes')),
  };
}

export function mergeExtractedFacts(stage: number, prev: StageData, accepted: ExtractedFact[]): { stageData: StageData; advanceTo?: number } {
  const stageData: StageData = { ...prev, extractedFacts: factMap(prev, accepted) };
  const facts = stageData.extractedFacts ?? {};
  if (stage === 1) {
    const researchQuestion = factValue<string>(facts, 'stage1.researchQuestion')?.trim();
    const factor = factValue<string>(facts, 'stage1.factorDirection')?.trim();
    const phenomenon = factValue<string>(facts, 'stage1.phenomenonDirection')?.trim();
    const confirmed = factValue<boolean>(facts, 'stage1.confirmed') === true;
    if (confirmed && researchQuestion && factor && phenomenon) {
      const originalInterest = factValue<string>(facts, 'stage1.originalInterest')?.trim() || researchQuestion;
      const retainedFeature = factValue<string>(facts, 'stage1.retainedFeature')?.trim() || phenomenon;
      const classroomProxy = factValue<string>(facts, 'stage1.classroomProxy')?.trim() || factor;
      const snapshot = [
        '《探究问题确认书》',
        `研究问题：${researchQuestion}`,
        `拟改变的因素方向：${factor}`,
        `关注的现象方向：${phenomenon}`,
      ].join('\n');
      stageData.stage1 = {
        confirmed: true,
        snapshot,
        themeMapping: { originalInterest, retainedFeature, classroomProxy, researchQuestion },
        factorDirection: factor,
        phenomenonDirection: phenomenon,
        variables: { independent: factor },
      };
      return { stageData, advanceTo: 2 };
    }
  }
  if (stage === 2) {
    const plan = buildServerExperimentPlan(stageData);
    const confirmed = factValue<boolean>(facts, 'stage2.confirmed') === true;
    if (plan && confirmed) {
      stageData.stage2 = {
        submitted: prev.stage2?.submitted ?? false,
        approved: prev.stage2?.approved ?? null,
        teacherFeedback: prev.stage2?.teacherFeedback,
        experimentPlan: plan,
        schema: prev.stage2?.schema ?? { columns: [], minRows: Math.max(3, plan.repeatCount), maxRows: 200 },
        aiRiskAnnotations: prev.stage2?.aiRiskAnnotations,
        factsConfirmed: true,
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
