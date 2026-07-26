import { createHash } from 'crypto';
import { createLLMProvider } from '@/app/lib/llm/provider';
import type { LLMRuntimeOverride } from '@/app/lib/llm/types';
import type { StageData, Stage2ExperimentPlan } from '@/app/models/stageData';
import { repairJson } from '@/app/lib/llm/jsonRepair';
import { locateSourceQuoteIn } from '@/app/lib/sourceQuote';
import {
  STUDENT_FACT_EXTRACTOR_PROMPT_VERSION,
  STUDENT_FACT_EXTRACTOR_VERSION,
} from '@/app/lib/contractVersions';
import {
  canonicalResearchQuestion,
  researchQuestionHash,
  stage2DraftHash,
} from '@/app/lib/stageState';
import {
  composeStage2Plan,
  distinctExperimentLevels,
  evaluateStage2Readiness,
  inferMeasurementTiming,
  inferMeasurementTool,
} from '@/app/lib/stage2Readiness';

export const EXTRACTOR_VERSION = STUDENT_FACT_EXTRACTOR_VERSION;
export const EXTRACTOR_PROMPT_VERSION = STUDENT_FACT_EXTRACTOR_PROMPT_VERSION;

export interface ExtractedFact {
  field: string;
  value: unknown;
  sourceQuote: string;
  origin?: 'tutor_dialogue' | 'student_form';
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
  attempts: Array<{ attempt: number; failure: string; finishReason: string | null }>;
  truncated: boolean;
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
    'stage2.measurement.tool': 'string',
    'stage2.measurement.timing': 'string',
    'stage2.recordedFields': 'string[]',
    'stage2.controlledVariables': 'string[]',
    'stage2.materials': 'string[]',
    'stage2.procedure': 'string[]',
    'stage2.sampleSizePerLevel': 'number',
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

function parseFacts(raw: string): ExtractedFact[] | null {
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
            : null;
        if (!facts) continue;
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
  return null;
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
    // 定位成功时用学生原文里的那一段覆盖模型引文（模型常吞掉 Markdown 强调标记）。
    const sourceQuote = locateSourceQuoteIn(studentMessages, fact.sourceQuote) ?? fact.sourceQuote.trim();
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
阶段2按四个环节提取：变量设计、数据记录、实验过程、结果趋势。同一条消息中明确出现的多个字段都应提取，expectedFocusId 只表示导师当前关注环节，不限制其他明确事实。
必须区分：自变量水平、读数时间点、每组样本数和独立重复轮数。不得把“第7天”识别成实验水平，不得把“每组5株”识别成重复5次。
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

const LEVEL_UNIT_PATTERN = '(?:小时|分钟|秒|天|周|℃|°C|摄氏度|%|毫克\\/升|mg\\/L|毫升|升|克|千克|厘米|毫米|米)';

function numericLevels(message: string): { values: string[]; sourceQuote: string } | null {
  const clauses = message
    .replace(/(第\s*\d+\s*(?:天|小时|分钟|周)(?:后)?(?:测量|读数|记录|观察))/g, '，$1')
    .split(/[，,。；;\n]/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const hasLevelContext = /(?:自变量|水平|梯度|设置|分为|分成|组别|(?:两|三|四|五|六|七|八|九|\d+)?组|光照|温度|浓度|剂量|酸碱|pH|时长|速度|距离)/i.test(clause);
    const isReadingTiming = /第\s*\d+\s*(?:天|小时|分钟|周)(?:后)?.{0,8}(?:测量|读数|记录|观察)/.test(clause);
    if (!hasLevelContext || isReadingTiming) continue;

    const matches = [...clause.matchAll(new RegExp(`-?\\d+(?:\\.\\d+)?\\s*${LEVEL_UNIT_PATTERN}?`, 'gi'))]
      .map((match) => match[0].replace(/\s+/g, '').trim())
      .filter(Boolean);
    if (matches.length < 2 || matches.length > 12) continue;

    const explicitUnits = matches
      .map((value) => value.match(/[^\d.\-]+$/)?.[0])
      .filter((unit): unit is string => Boolean(unit));
    const sharedUnit = explicitUnits[0];
    if (!sharedUnit || explicitUnits.some((unit) => unit.toLowerCase() !== sharedUnit.toLowerCase())) continue;

    const values = distinctExperimentLevels(
      matches.map((value) => /[^\d.\-]+$/.test(value) ? value : `${value}${sharedUnit}`),
    );
    if (values.length >= 2) return { values, sourceQuote: clause };
  }
  return null;
}

function cleanCategoricalLevel(value: string): string {
  return value
    .replace(/^(?:我觉得可能是|我觉得|可能是|是)\s*/, '')
    .replace(/^(?:(?:我想|我要|我们)?(?:比较|对比|相比)|将|把|用|一个是|另一?个是)\s*/, '')
    .replace(/(?:这)?(?:两种|两组|两类)$/g, '')
    .trim();
}

function categoricalLevels(message: string): { values: string[]; sourceQuote: string } | null {
  const hasComparisonContext = /两种|两组|两类|对比|相比|比较|差异/.test(message);
  if (!hasComparisonContext) return null;
  const patterns = [
    /([^，。；;\n]{1,18}?)\s*(?:和|与|及|、|\/)\s*([^，。；;\n]{1,18}?)(?=(?:这)?(?:两种|两组|两类)|(?:进行)?(?:对比|比较)|的差异|相比|，|。|；|;|$)/,
    /一个是\s*([^，。；;\n]{1,16}?)\s*(?:，|,|\s)*(?:另)?一个是\s*([^，。；;\n]{1,16}?)(?=，|,|。|；|;|\n|$)/,
    /([^，。；;\n]{1,12}?形(?:截面)?)\s*[^，。；;\n]{0,18}[，,]\s*([^，。；;\n]{1,12}?形(?:截面)?)\s*[^。；;\n]{0,28}(?:对比|相比|比较|差异)/,
    /([^，。；;\n]{1,16}?形(?:截面)?)[^，。；;\n]{0,18}[，,]\s*([^，。；;\n]{1,16}?形(?:截面)?)/,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;
    const values = distinctExperimentLevels([cleanCategoricalLevel(match[1]), cleanCategoricalLevel(match[2])]);
    if (values.length >= 2 && values.every((value) => value.length <= 20 && !/\d/.test(value))) {
      return { values, sourceQuote: match[0].trim() };
    }
  }
  return null;
}

function repeatCount(message: string): { value: number; sourceQuote: string } | null {
  const patterns = [
    /(?:整个实验|实验|每组|每个水平|各组)?[^，。；\n]{0,10}?重复\s*(\d+)\s*(?:次|轮)/,
    /(?:独立\s*)?(?:做|进行)\s*(\d+)\s*(?:次|轮)(?:\s*重复)?/,
    /(\d+)\s*(?:次|轮)\s*(?:独立)?重复/,
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

function sampleSizePerLevel(message: string): { value: number; sourceQuote: string } | null {
  const match = message.match(/每(?:组|个水平|种条件)[^\d]{0,8}(\d+)\s*(?:个|颗|株|份)(?!\s*(?:次|轮))/);
  const value = Number(match?.[1]);
  return match && Number.isInteger(value) && value >= 1 && value <= 200
    ? { value, sourceQuote: match[0].trim() }
    : null;
}

function dependentResult(message: string): { value: string; sourceQuote: string } | null {
  const incrementUntilFailure = message.match(
    /(?:逐个|不断|每次|依次)加\s*(?:\d+(?:\.\d+)?\s*(?:g|克|kg|千克)\s*(?:的)?)?\s*([\p{Script=Han}A-Za-z]{1,10}?)(?=直到)/iu,
  );
  if (incrementUntilFailure?.[1]) {
    return {
      value: `${incrementUntilFailure[1].replace(/的$/, '')}数量`,
      sourceQuote: incrementUntilFailure[0].trim(),
    };
  }
  const counted = message.match(/(?:直到[^，。；\n]{1,20}时(?:的)?|[^，。；\n]{0,12}时的|测量|记录|观察|统计)\s*([\p{Script=Han}A-Za-z]{1,10}(?:的)?(?:数量|个数|次数|质量|时间))/u)?.[1];
  const explicit = counted
    ?? message.match(/((?:豆苗|幼苗|植株|茎|根|叶片|豆)(?:的)?[^，。；\n]{0,8}(?:高度|长度|数量|质量))/)?.[1]
    ?? message.match(/(?:测量|记录|观察)(?:第\s*\d+\s*天)?[^，。；\n]{0,8}?((?:豆苗|幼苗|植株|茎|根|叶片|豆)?(?:的)?(?:高度|长度|数量|质量|温度|浊度|萌发率|生长量))/)?.[1]
    ?? message.match(/(?:测量|记录|观察|统计)[^，。；\n]{0,12}?((?:高度|长度|数量|个数|次数|质量|时间|温度|浊度|萌发率|生长量))/)?.[1]
    ?? message.match(/([\p{Script=Han}A-Za-z]{1,10}(?:的)?(?:数量|个数|次数|质量|时间))/u)?.[1]
    ?? message.match(/直到[^，。；\n]{1,20}时(?:的|记录)?\s*([^，。；\n]{1,16}?(?:数量|个数|次数|质量|时间))/)?.[1];
  return explicit ? { value: explicit, sourceQuote: explicit } : null;
}

function independentVariable(
  message: string,
  categorical?: { values: string[]; sourceQuote: string } | null,
): { value: string; sourceQuote: string } | null {
  const explicitPatterns = [
    /(?:我)?只(?:改变|调整|控制)\s*([^，。；\n]{1,24}?)(?=，|。|；|设置|并|$)/,
    /(?:唯一(?:改变|调整|控制)的变量|自变量)(?:是|为|：|:)\s*([^，。；\n]{1,24})/,
    /(?:改变|换成|采用)\s*([^，。；\n\d]{1,18}?)(?=，|。|；|进行|比较|对比|$)/,
    /不同的\s*([^，。；\n\d]{1,18}?)(?=，|。|；|进行|比较|对比|$)/,
  ];
  for (const pattern of explicitPatterns) {
    const match = message.match(pattern);
    const value = match?.[1]?.trim().replace(/^不同的\s*/, '');
    if (match && value) return { value, sourceQuote: match[0].trim() };
  }

  const contextual = message.match(/((?:每天)?(?:光照时长|光照|温度|浓度|剂量|酸碱度|pH值|水量|盐度|湿度))[^，。；\n]{0,12}?\d/iu);
  const value = contextual?.[1]?.trim();
  if (contextual && value) return { value, sourceQuote: contextual[0].trim() };

  if (categorical && /截面/.test(categorical.sourceQuote) && categorical.values.every((level) => /形/.test(level))) {
    return { value: '截面形状', sourceQuote: categorical.sourceQuote };
  }
  return null;
}

function controlledVariables(message: string): { values: string[]; sourceQuote: string } | null {
  const clauses = message.split(/[。；;\n]/).map((item) => item.trim()).filter(Boolean);
  for (const clause of clauses) {
    const match = clause.match(/(.{1,80}?)(?:保持不变|保持一致|维持不变|均相同|都相同|一样)(?=，|,|$)/);
    if (!match) continue;
    const raw = match[1]
      .replace(/^(?:并|同时|确保|让|使|将)\s*/, '')
      .replace(/^(?:其他(?:的)?条件)(?:都|均|全部)?\s*/, '')
      .trim();
    if (!raw || /^(?:其他|其余)$/.test(raw)) {
      return { values: ['其他条件保持一致'], sourceQuote: match[0].trim() };
    }
    const values = raw
      .split(/[、，,]|和|与|及/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (values.length > 0) return { values, sourceQuote: match[0].trim() };
  }
  const generic = message.match(/其他(?:的|条件)?(?:都|均|全部)?(?:一样|相同|保持不变|保持一致)/)?.[0];
  return generic ? { values: ['其他条件保持一致'], sourceQuote: generic } : null;
}

function statedProcedure(message: string): { values: string[]; sourceQuote: string } | null {
  const explicit = message.match(/(?:具体)?步骤(?:是|为|如下|：|:)\s*([^。；\n]{2,160})/);
  const sequence = explicit
    ?? message.match(/((?:先|首先)[^。；\n]{2,160}(?:然后|接着|再|最后)[^。；\n]{1,120})/);
  if (!sequence) return null;
  const sourceQuote = sequence[0].trim();
  const body = (sequence[1] ?? sourceQuote).trim();
  const values = body
    .split(/，|,|(?:然后|接着|随后|最后|再)/)
    .map((item) => item.replace(/^(?:先|首先)\s*/, '').trim())
    .filter(Boolean);
  return values.length > 0 ? { values, sourceQuote } : null;
}

function statedHypothesis(message: string): { value: string; sourceQuote: string } | null {
  const match = message.match(/((?:我)?(?:推测|预测|预计|假设|认为)[^。；\n]{2,120})/);
  if (!match) return null;
  const sourceQuote = match[1].trim();
  if (/(?:环节|完成|确认|通过|系统|平台)|已经.{0,4}(?:好|完|齐)/.test(sourceQuote)) return null;
  if (!/(?:越|更|比|高于|低于|多|少|大|小|快|慢)/.test(sourceQuote)) return null;
  const value = sourceQuote.replace(/^(?:我)?(?:推测|预测|预计|假设|认为)(?:是|为|：|:)?\s*/, '').trim();
  return value ? { value, sourceQuote } : null;
}

function validHypothesisSource(sourceQuote: string): boolean {
  return !/(?:环节|完成|确认|通过|系统|平台)|已经.{0,4}(?:好|完|齐)/.test(sourceQuote)
    && /(?:越|更|比|高于|低于|多|少|大|小|快|慢)/.test(sourceQuote);
}

function measurementPhrase(message: string): string {
  return message.match(/(?:使用|用)[^，。；\n]{0,30}(?:测量|记录|观察|读数)[^，。；\n]{0,24}/)?.[0]?.trim()
    ?? message.match(/(?:第\s*\d+\s*(?:天|小时|分钟|周)|\d+\s*(?:天|小时|分钟|周)后|每天(?:固定|同一)?时间)[^，。；\n]{0,30}(?:测量|记录|观察|读数)[^，。；\n]{0,20}/)?.[0]?.trim()
    ?? '';
}

export function applyDeterministicExtractionFallbacks(
  stage: number,
  acceptedInput: ExtractedFact[],
  currentStudentMessage: string,
  context: { expectedFocusId?: string } = {},
): { accepted: ExtractedFact[]; fallbacks: string[] } {
  void context;
  let accepted = [...acceptedInput];
  const fallbacks: string[] = [];
  if (stage === 1) {
    const confirmed = ensureExplicitConfirmationFact(stage, accepted, currentStudentMessage);
    return {
      accepted: confirmed.accepted,
      fallbacks: confirmed.applied ? ['explicit_confirmation'] : [],
    };
  }
  if (stage !== 2) return { accepted, fallbacks };

  accepted = accepted.filter((fact) => fact.field !== 'stage2.hypothesis' || validHypothesisSource(fact.sourceQuote));

  const categorical = categoricalLevels(currentStudentMessage);
  const levels = numericLevels(currentStudentMessage) ?? categorical;
  if (levels) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.independentVariable.levels');
    appendFallback(
      accepted,
      'stage2.independentVariable.levels',
      levels.values,
      levels.sourceQuote,
      categorical && levels === categorical ? 'categorical_levels' : 'semantic_numeric_levels',
      fallbacks,
    );
  }
  const independent = independentVariable(currentStudentMessage, categorical);
  if (independent) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.independentVariable.name');
    appendFallback(accepted, 'stage2.independentVariable.name', independent.value, independent.sourceQuote, 'independent_variable_name', fallbacks);
  }
  const repeats = repeatCount(currentStudentMessage);
  if (repeats) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.repeatCount');
    appendFallback(accepted, 'stage2.repeatCount', repeats.value, repeats.sourceQuote, 'independent_repeat_count', fallbacks);
  } else {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.repeatCount'
      || !/(?:个|颗|株|份)/.test(fact.sourceQuote)
      || /重复/.test(fact.sourceQuote));
  }
  const sampleSize = sampleSizePerLevel(currentStudentMessage);
  if (sampleSize) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.sampleSizePerLevel');
    appendFallback(accepted, 'stage2.sampleSizePerLevel', sampleSize.value, sampleSize.sourceQuote, 'sample_size_per_level', fallbacks);
  }
  const controls = controlledVariables(currentStudentMessage);
  if (controls) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.controlledVariables');
    appendFallback(accepted, 'stage2.controlledVariables', controls.values, controls.sourceQuote, 'controlled_variables', fallbacks);
  }
  const explicitResult = dependentResult(currentStudentMessage);
  const endpoints = currentStudentMessage.match(/从\s*([^，。；\s]{1,10})\s*(?:量|测量|测)\s*到\s*([^，。；\s]{1,10})/);
  if (endpoints) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.dependentVariable.name');
    appendFallback(
      accepted,
      'stage2.dependentVariable.name',
      `${endpoints[1]}到${endpoints[2]}的长度`,
      endpoints[0],
      'dependent_endpoint_length',
      fallbacks,
    );
  } else if (explicitResult) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.dependentVariable.name');
    appendFallback(accepted, 'stage2.dependentVariable.name', explicitResult.value, explicitResult.sourceQuote, 'dependent_result_phrase', fallbacks);
  }

  const phrase = measurementPhrase(currentStudentMessage)
    || accepted.find((fact) => fact.field === 'stage2.dependentVariable.measurement')?.sourceQuote
    || '';
  const tool = inferMeasurementTool(currentStudentMessage) || inferMeasurementTool(phrase);
  const timing = inferMeasurementTiming(currentStudentMessage) || inferMeasurementTiming(phrase);
  if (tool) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.measurement.tool');
    appendFallback(accepted, 'stage2.measurement.tool', tool, tool, 'measurement_tool', fallbacks);
  }
  if (timing) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.measurement.timing');
    appendFallback(accepted, 'stage2.measurement.timing', timing, timing, 'measurement_timing', fallbacks);
  }
  if (explicitResult) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.recordedFields');
    appendFallback(accepted, 'stage2.recordedFields', [explicitResult.value], explicitResult.sourceQuote, 'recorded_fields', fallbacks);
  }
  if (phrase) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.dependentVariable.measurement');
    appendFallback(accepted, 'stage2.dependentVariable.measurement', phrase, phrase, 'measurement_phrase', fallbacks);
  }
  const procedure = statedProcedure(currentStudentMessage);
  if (procedure) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.procedure');
    appendFallback(accepted, 'stage2.procedure', procedure.values, procedure.sourceQuote, 'procedure_sequence', fallbacks);
  }
  const hypothesis = statedHypothesis(currentStudentMessage);
  if (hypothesis) {
    accepted = accepted.filter((fact) => fact.field !== 'stage2.hypothesis');
    appendFallback(accepted, 'stage2.hypothesis', hypothesis.value, hypothesis.sourceQuote, 'hypothesis_trend', fallbacks);
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
      attempts: [], truncated: false,
    };
  }
  const providerName = input.runtimeModel?.provider ?? process.env.EXTRACTOR_LLM_PROVIDER ?? process.env.LLM_PROVIDER ?? 'deepseek';
  const model = input.runtimeModel?.model ?? process.env.EXTRACTOR_LLM_MODEL ?? process.env.LLM_MODEL ?? (providerName === 'openai' ? 'gpt-4o-mini' : 'deepseek-v4-pro');
  const prompt = buildExtractorPrompt(input.stage);
  const provider = createLLMProvider({ provider: providerName, model, role: 'EVALUATOR' });
  const attempts: ExtractorCallResult['attempts'] = [];
  const baseMessages = [
    { role: 'system' as const, content: prompt },
    { role: 'user' as const, content: JSON.stringify({
      currentStudentMessage: input.studentMessages.at(-1) ?? '',
      expectedFocusId: input.expectedFocusId,
      existingFacts: input.existingFacts ?? {},
    }) },
  ];
  let completion: Awaited<ReturnType<typeof provider.complete>> | null = null;
  let parsed: ExtractedFact[] | null = null;
  let successfulAttempt: number | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    completion = await provider.complete(
      attempt === 1
        ? baseMessages
        : [...baseMessages, { role: 'system' as const, content: '上一次输出未完成或不是合法 JSON。只输出 JSON，不要解释。' }],
      { useJsonFormat: true },
    );
    parsed = parseFacts(completion.content);
    if (parsed && completion.finishReason !== 'length') {
      successfulAttempt = attempt;
      break;
    }
    attempts.push({
      attempt,
      failure: completion.finishReason === 'length' ? 'OUTPUT_TRUNCATED' : 'INVALID_EXTRACTOR_JSON',
      finishReason: completion.finishReason,
    });
  }
  const truncated = completion?.finishReason === 'length';
  const validated = validateExtractedFacts(input.stage, parsed ?? [], input.studentMessages);
  const deterministic = applyDeterministicExtractionFallbacks(
    input.stage,
    validated.accepted,
    input.studentMessages.at(-1) ?? '',
    { expectedFocusId: input.expectedFocusId },
  );
  return {
    ...validated,
    accepted: deterministic.accepted,
    rawOutput: completion?.content ?? '',
    prompt,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
    provider: providerName,
    model,
    modelFamily: modelFamily(providerName, model),
    generationParams: {
      ...(completion?.request ?? {}),
      finishReason: completion?.finishReason ?? null,
      usage: completion?.usage,
      successfulAttempt,
      expectedFocusId: input.expectedFocusId,
      deterministicFallbacks: deterministic.fallbacks,
    },
    deterministicFallbacks: deterministic.fallbacks,
    attempts,
    truncated,
  };
}

const MERGEABLE_LIST_FIELDS = new Set([
  'stage2.independentVariable.levels',
  'stage2.recordedFields',
  'stage2.controlledVariables',
  'stage2.materials',
  'stage2.procedure',
  'stage2.safetyNotes',
]);

function factMap(
  prev: StageData,
  accepted: ExtractedFact[],
  context: { currentStudentMessage?: string; expectedFocusId?: string },
) {
  const facts = { ...(prev.extractedFacts ?? {}) };
  const explicitRevision = /(?:改成|改为|调整为|换成|重新|修改|更正|不是.{0,12}而是)/.test(context.currentStudentMessage ?? '');
  for (const fact of accepted) {
    const previous = facts[fact.field];
    if (!previous || explicitRevision || fact.origin === 'student_form') {
      facts[fact.field] = { value: fact.value, sourceQuote: fact.sourceQuote, origin: fact.origin };
      continue;
    }
    if (MERGEABLE_LIST_FIELDS.has(fact.field) && Array.isArray(previous.value) && Array.isArray(fact.value)) {
      facts[fact.field] = {
        value: [...new Set([...previous.value, ...fact.value].map(String).map((item) => item.trim()).filter(Boolean))],
        sourceQuote: `${previous.sourceQuote}；${fact.sourceQuote}`,
        origin: previous.origin,
      };
    }
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
