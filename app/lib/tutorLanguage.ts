import { createHash } from 'crypto';
import type { ChatResponse, Message } from '@/app/models/types';
import type { StageData } from '@/app/models/stageData';
import { repairJson } from '@/app/lib/llm/jsonRepair';
import { createLLMProvider } from '@/app/lib/llm/provider';
import type { LLMCompletion, LLMRuntimeOverride } from '@/app/lib/llm/types';

export const TUTOR_LANGUAGE_CONTRACT_VERSION = 'tutor-language-v1';
export const TUTOR_LANGUAGE_PROMPT_V1 = 'tutor-language-prompt-v1';
export const TUTOR_LANGUAGE_PROMPT_V2 = 'tutor-language-prompt-v2';
export const TUTOR_LANGUAGE_PROMPT_V2_1 = 'tutor-language-prompt-v2.1';
/** Production remains on v1 until Data Lab smoke/calibration gates pass. */
export const TUTOR_LANGUAGE_PROMPT_VERSION = TUTOR_LANGUAGE_PROMPT_V1;
export const DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION = TUTOR_LANGUAGE_PROMPT_V2_1;
export const TUTOR_LANGUAGE_PROMPT_VERSIONS = [TUTOR_LANGUAGE_PROMPT_V1, TUTOR_LANGUAGE_PROMPT_V2, TUTOR_LANGUAGE_PROMPT_V2_1] as const;
export type TutorLanguagePromptVersion = (typeof TUTOR_LANGUAGE_PROMPT_VERSIONS)[number];

export const TUTOR_INTERACTION_TYPES = [
  'open_question',
  'clarification',
  'explanation',
  'checkpoint',
  'information',
] as const;

export type TutorInteractionType = (typeof TUTOR_INTERACTION_TYPES)[number];

export interface TutorLanguageResponse {
  dialogue: string;
  interactionType: TutorInteractionType;
  focus: string;
  hints: string[];
}

export interface TutorVisibleContext {
  phase: number;
  triggerType: string;
  currentStudentMessage: string;
  priorStudentMessages: string[];
  tutorHistory: string[];
  visibleFacts: unknown;
  allowedFocusIds: string[];
  focusDescriptions?: Record<string, string>;
}

export interface TutorLanguageTrace {
  response: TutorLanguageResponse;
  rawOutput: string;
  promptSha256: string;
  generationParams: Record<string, unknown>;
  attempts: Array<{ attempt: number; failure: string; finishReason: string | null }>;
}

export interface TutorServerEnvelope {
  nextActionType?: ChatResponse['next_action_type'];
  phaseComplete?: boolean;
  artifacts?: Omit<Partial<ChatResponse>, 'dialogue' | 'hints' | 'next_action_type' | 'phase_complete'>;
}

const PRIVATE_KEYS = new Set([
  'internalArchetype',
  'acceptableDirections',
  'acceptableDirectionsJson',
  'forbiddenDirections',
  'forbiddenDirectionsJson',
  'forbiddenMoves',
  'privateReviewSpec',
  'privateReviewSpecJson',
  'rubricTargets',
  'goldAnswer',
  'modelIdentity',
]);

function repairTutorContractFieldGlue(raw: string): string {
  const interactionTypes = TUTOR_INTERACTION_TYPES.join('|');
  return raw.replace(
    new RegExp(`("interactionType"\\s*:\\s*")(${interactionTypes})focus("\\s*:)`, 'g'),
    '$1$2","focus$3',
  );
}

function parseObject(raw: string): Record<string, unknown> | null {
  const candidates = [raw.trim()];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fence) candidates.push(fence);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of candidates) {
    const contractRepaired = repairTutorContractFieldGlue(candidate);
    for (const value of [...new Set([candidate, repairJson(candidate), contractRepaired, repairJson(contractRepaired)])]) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch {
        // Try the next representation.
      }
    }
  }
  return null;
}

export function parseTutorLanguageResponse(raw: string, allowedFocusIds: string[]): TutorLanguageResponse | null {
  const parsed = parseObject(raw);
  if (!parsed) return null;
  const dialogue = typeof parsed.dialogue === 'string' ? parsed.dialogue.trim() : '';
  const interactionType = typeof parsed.interactionType === 'string' ? parsed.interactionType : '';
  const focus = typeof parsed.focus === 'string' ? parsed.focus.trim() : '';
  const hints = Array.isArray(parsed.hints)
    ? parsed.hints.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
  if (!dialogue || dialogue.length > 1600) return null;
  if (!TUTOR_INTERACTION_TYPES.includes(interactionType as TutorInteractionType)) return null;
  if (!allowedFocusIds.includes(focus)) return null;
  if (hints.length > 1) return null;
  if (hints.some((hint) => dialogue.includes(hint) || hint.includes(dialogue))) return null;
  return { dialogue, interactionType: interactionType as TutorInteractionType, focus, hints };
}

export function sanitizeTutorVisibleFacts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeTutorVisibleFacts);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_KEYS.has(key)) continue;
    result[key] = sanitizeTutorVisibleFacts(child);
  }
  return result;
}

export const TUTOR_BEHAVIOR_SPEC = [
  '回应学生刚刚说的具体内容，不要套用固定开场或表扬语。',
  '每轮只承担一个核心教学任务，并保留学生选择权。',
  '学生卡住时逐级增加支架；信息不足时明确澄清，不猜测。',
  '不要使用后台术语、阶段编号、字段名、rubric、archetype 或训练标签。',
  'dialogue 与 hints 不得重复；hints 最多一条，且不能变成隐藏答案菜单。',
  '达到本轮最低要求时及时收敛，不强迫固定轮数或固定确认台词。',
].join('\n- ');

export const TUTOR_BEHAVIOR_SPEC_V2 = [
  '回应学生本轮的具体表达，不使用固定表扬或复述式开场。',
  '本轮只完成所选 focus 对应的一个教学任务；dialogue 原则上最多一个问句。',
  'dialogue 与 hints 合计最多给一个具体例子；hints 默认输出空数组，只有学生明显卡住时才给一条。',
  '材料、变量、数值、单位、异常和实验条件只能来自学生消息或可见事实；题目名称和私有审核规范不能作为事实来源。',
  '信息不足时只澄清当前缺口，不猜测、不补全后续方案，也不替学生完成核心判断。',
  '不要使用后台术语、阶段编号、字段名、rubric、archetype、训练标签或内部 schema key。',
  '达到本轮最低要求后立即收敛；自然、简洁、适龄，通常不超过 220 个中文字符。',
].join('\n- ');

export const TUTOR_BEHAVIOR_SPEC_V2_1 = [
  ...TUTOR_BEHAVIOR_SPEC_V2.split('\n- '),
  '不得用“比如 A 还是 B”或并列多个观察指标让学生从答案菜单中选择；若必须示范，只给一个例子，并立即把判断权交还学生。',
  '学生自己列出的多个条件可以被概括复述，以解释公平比较、因果或安全问题；不要把这种回应误当成导师提供多个选项。',
].join('\n- ');

function buildTutorLanguagePromptV1(input: Omit<TutorVisibleContext, 'tutorHistory' | 'priorStudentMessages' | 'currentStudentMessage'>): string {
  const focusLines = input.allowedFocusIds.map((id) => `- ${id}: ${input.focusDescriptions?.[id] ?? '围绕当前缺失信息开展教学语言回应'}`).join('\n');
  const facts = sanitizeTutorVisibleFacts(input.visibleFacts);
  return `你是一名中学 STEM 探究导师。你只负责本回合的教学语言，不负责写入状态、推进阶段、生成确认书、表格、安全题、分析进度或报告框架。

【行为规范】
- ${TUTOR_BEHAVIOR_SPEC}

【本回合】
阶段：${input.phase}
触发类型：${input.triggerType}
可见事实：${JSON.stringify(facts)}
允许 focus（必须精确选择一个）：
${focusLines}

【输出合同 ${TUTOR_LANGUAGE_CONTRACT_VERSION}】
只输出一个 JSON 对象，不要 Markdown，不要附加字段：
{"dialogue":"自然、具体、面向学生的中文","interactionType":"open_question|clarification|explanation|checkpoint|information","focus":"allowed focus id","hints":["可选的一条非重复提示"]}

hints 最多 1 条；没有必要时输出空数组。不要输出 phase_complete、next_action_type、变量表、确认书、实验表、安全题、分析进度或报告内容。`;
}

function buildTutorLanguagePromptV2(input: Omit<TutorVisibleContext, 'tutorHistory' | 'priorStudentMessages' | 'currentStudentMessage'>): string {
  const focusLines = input.allowedFocusIds.map((id) => `- ${id}: ${input.focusDescriptions?.[id] ?? '只处理当前 focus 对应的一个缺口'}`).join('\n');
  const facts = sanitizeTutorVisibleFacts(input.visibleFacts);
  return `你是一名中学 STEM 探究导师。你只生成本回合对学生说的话；状态写入、阶段推进、确认书、表格、安全题、分析进度和报告框架全部由服务器负责。

【Prompt 版本 ${TUTOR_LANGUAGE_PROMPT_V2}】
【行为规范】
- ${TUTOR_BEHAVIOR_SPEC_V2}

【唯一事实来源】
学生本轮消息与下列可见事实。没有出现在这里的具体材料、变量、数值、单位、异常或实验条件都不得自行补充。
可见事实：${JSON.stringify(facts)}

【本回合】
阶段：${input.phase}
触发类型：${input.triggerType}
只允许选择一个 focus：
${focusLines}

【输出前自检】
- 是否只推进一个任务、最多一个问句？
- 是否没有列出三个以上候选方向，且具体例子总数不超过一个？
- 是否所有具体事实都有学生消息或可见事实依据？
- hints 是否确有必要；否则是否为 []？

【输出合同 ${TUTOR_LANGUAGE_CONTRACT_VERSION}】
只输出一个 JSON 对象，不要 Markdown，不要附加字段：
{"dialogue":"自然、简洁、具体、面向学生的中文","interactionType":"open_question|clarification|explanation|checkpoint|information","focus":"allowed focus id","hints":[]}

不得输出 phase_complete、next_action_type、变量表、确认书、实验表、安全题、分析进度或报告内容。`;
}

function buildTutorLanguagePromptV2_1(input: Omit<TutorVisibleContext, 'tutorHistory' | 'priorStudentMessages' | 'currentStudentMessage'>): string {
  const focusLines = input.allowedFocusIds.map((id) => `- ${id}: ${input.focusDescriptions?.[id] ?? '只处理当前 focus 对应的一个缺口'}`).join('\n');
  const facts = sanitizeTutorVisibleFacts(input.visibleFacts);
  return `你是一名中学 STEM 探究导师。你只生成本回合对学生说的话；状态写入、阶段推进、确认书、表格、安全题、分析进度和报告框架全部由服务器负责。

【Prompt 版本 ${TUTOR_LANGUAGE_PROMPT_V2_1}】
【行为规范】
- ${TUTOR_BEHAVIOR_SPEC_V2_1}

【唯一事实来源】
学生本轮消息与下列可见事实。没有出现在这里的具体材料、变量、数值、单位、异常或实验条件都不得自行补充。
可见事实：${JSON.stringify(facts)}

【本回合】
阶段：${input.phase}
触发类型：${input.triggerType}
只允许选择一个 focus：
${focusLines}

【输出前自检】
- 是否只推进一个任务、最多一个问句？
- 是否避免了“A 还是 B”式答案菜单，并且至多给了一个具体例子？
- 如果复述学生列出的多个条件，是否只为解释当前误解，而没有追加新的候选项？
- 是否所有具体事实都有学生消息或可见事实依据？
- hints 是否确有必要；否则是否为 []？

【输出合同 ${TUTOR_LANGUAGE_CONTRACT_VERSION}】
只输出一个 JSON 对象，不要 Markdown，不要附加字段：
{"dialogue":"自然、简洁、具体、面向学生的中文","interactionType":"open_question|clarification|explanation|checkpoint|information","focus":"allowed focus id","hints":[]}

不得输出 phase_complete、next_action_type、变量表、确认书、实验表、安全题、分析进度或报告内容。`;
}

export function buildTutorLanguagePrompt(
  input: Omit<TutorVisibleContext, 'tutorHistory' | 'priorStudentMessages' | 'currentStudentMessage'>,
  promptVersion: TutorLanguagePromptVersion = TUTOR_LANGUAGE_PROMPT_VERSION,
): string {
  if (promptVersion === TUTOR_LANGUAGE_PROMPT_V2_1) return buildTutorLanguagePromptV2_1(input);
  if (promptVersion === TUTOR_LANGUAGE_PROMPT_V2) return buildTutorLanguagePromptV2(input);
  return buildTutorLanguagePromptV1(input);
}

function interactionToAction(type: TutorInteractionType): ChatResponse['next_action_type'] {
  if (type === 'checkpoint') return 'confirmation';
  if (type === 'information' || type === 'explanation') return 'info';
  return 'text_input';
}

export function toCompatibleChatResponse(
  language: TutorLanguageResponse,
  envelope: TutorServerEnvelope = {},
): ChatResponse {
  return {
    dialogue: language.dialogue,
    next_action_type: envelope.nextActionType ?? interactionToAction(language.interactionType),
    hints: language.hints,
    phase_complete: envelope.phaseComplete === true,
    tutor_language: language,
    ...(envelope.artifacts ?? {}),
  };
}

function messagesForTutor(systemPrompt: string, input: TutorVisibleContext, repair?: string) {
  const history: Message[] = [];
  for (const item of input.priorStudentMessages) history.push({ id: '', role: 'user', content: item });
  for (const item of input.tutorHistory) history.push({ id: '', role: 'assistant', content: item });
  return [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((message) => ({ role: message.role, content: message.content })),
    {
      role: 'user' as const,
      content: `${input.triggerType === 'SYSTEM_TRIGGER' ? '这是系统触发，不是学生发言。' : `学生本轮说：${input.currentStudentMessage}`}${repair ? `\n\n${repair}` : ''}`,
    },
  ];
}

export async function callTutorLanguageWithTrace(
  input: TutorVisibleContext,
  runtimeModel: LLMRuntimeOverride,
): Promise<TutorLanguageTrace> {
  const systemPrompt = buildTutorLanguagePrompt(input);
  const promptSha256 = createHash('sha256').update(systemPrompt).digest('hex');
  const provider = createLLMProvider({ ...runtimeModel, role: 'TUTOR' });
  const attempts: TutorLanguageTrace['attempts'] = [];
  let repair: string | undefined;
  let completion: LLMCompletion | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    completion = await provider.complete(messagesForTutor(systemPrompt, input, repair), {
      useJsonFormat: attempt < 3,
      maxTokens: 1200,
    });
    const parsed = parseTutorLanguageResponse(completion.content, input.allowedFocusIds);
    if (parsed && completion.finishReason !== 'length') {
      return {
        response: parsed,
        rawOutput: completion.content,
        promptSha256,
        generationParams: {
          ...completion.request,
          finishReason: completion.finishReason,
          usage: completion.usage,
          successfulAttempt: attempt,
        },
        attempts,
      };
    }
    const failure = completion.finishReason === 'length' ? 'OUTPUT_TRUNCATED' : 'INVALID_TUTOR_LANGUAGE_JSON';
    attempts.push({ attempt, failure, finishReason: completion.finishReason });
    repair = `上一次输出未通过 ${TUTOR_LANGUAGE_CONTRACT_VERSION} 校验（${failure}）。只输出合法 JSON；focus 必须是 ${input.allowedFocusIds.join('、')} 之一；hints 最多一条且不得重复 dialogue。`;
  }
  throw new Error(`Tutor 语言输出连续失败：${attempts.at(-1)?.failure ?? 'UNKNOWN'}`);
}

export function tutorSftTarget(response: ChatResponse | TutorLanguageResponse): TutorLanguageResponse | null {
  if ('interactionType' in response) return response;
  const interactionType: TutorInteractionType = response.next_action_type === 'confirmation'
    ? 'checkpoint'
    : response.next_action_type === 'info'
      ? 'information'
      : 'open_question';
  const focus = typeof (response as ChatResponse & { focus?: unknown }).focus === 'string'
    ? String((response as ChatResponse & { focus?: unknown }).focus)
    : 'legacy_unspecified';
  return {
    dialogue: response.dialogue,
    interactionType,
    focus,
    hints: (response.hints ?? []).slice(0, 1),
  };
}

export function buildTutorVisibleState(stage: number, stageData: StageData, extra: Record<string, unknown> = {}) {
  const ledger = stageData.extractedFacts ?? {};
  const planForTutor = stageData.stage2?.experimentPlan ? {
    研究问题: stageData.stage2.experimentPlan.researchQuestion,
    假设: stageData.stage2.experimentPlan.hypothesis,
    要改变的因素: stageData.stage2.experimentPlan.independentVariable.name,
    因素水平: stageData.stage2.experimentPlan.independentVariable.levels,
    要观察的结果: stageData.stage2.experimentPlan.dependentVariable.name,
    测量方法: stageData.stage2.experimentPlan.dependentVariable.measurement,
    单位: stageData.stage2.experimentPlan.dependentVariable.unit,
    保持一致的条件: stageData.stage2.experimentPlan.controlledVariables,
    材料: stageData.stage2.experimentPlan.materials,
    步骤: stageData.stage2.experimentPlan.procedure,
    每个水平重复次数: stageData.stage2.experimentPlan.repeatCount,
    安全注意: stageData.stage2.experimentPlan.safetyNotes,
  } : undefined;
  const value = (field: string) => ledger[field]?.value;
  const source = (field: string) => ledger[field] ? { 内容: ledger[field].value, 学生原文: ledger[field].sourceQuote } : undefined;
  let visible: Record<string, unknown>;
  if (stage === 1) {
    visible = {
      学生原始兴趣: source('stage1.originalInterest'),
      想保留的机制或约束: source('stage1.retainedFeature'),
      可在课堂观察的代理: source('stage1.classroomProxy'),
      学生提出的研究问题: source('stage1.researchQuestion'),
      拟改变因素方向: source('stage1.factorDirection'),
      关注现象方向: source('stage1.phenomenonDirection'),
      是否已明确确认: value('stage1.confirmed') === true,
    };
  } else if (stage === 2) {
    visible = {
      阶段一已确认: stageData.stage1 ? {
        研究问题: stageData.stage1.themeMapping?.researchQuestion,
        拟改变因素方向: stageData.stage1.factorDirection,
        关注现象方向: stageData.stage1.phenomenonDirection,
      } : undefined,
      学生已说明的方案事实: {
        假设: source('stage2.hypothesis'),
        要改变的因素: source('stage2.independentVariable.name'),
        因素水平: source('stage2.independentVariable.levels'),
        要观察的结果: source('stage2.dependentVariable.name'),
        测量方法: source('stage2.dependentVariable.measurement'),
        单位: source('stage2.dependentVariable.unit'),
        保持一致的条件: source('stage2.controlledVariables'),
        材料: source('stage2.materials'),
        步骤: source('stage2.procedure'),
        重复次数: source('stage2.repeatCount'),
        安全注意: source('stage2.safetyNotes'),
      },
      服务器是否已组装方案: Boolean(stageData.stage2?.experimentPlan),
    };
  } else if (stage === 3) {
    visible = { 已批准实验方案: planForTutor, 已审核风险: stageData.stage2?.aiRiskAnnotations, 安全检查是否通过: stageData.stage3?.safetyQuiz?.passed === true };
  } else if (stage === 5) {
    visible = { 已确认研究方向: stageData.stage1?.snapshot, 已批准实验方案: planForTutor, 数据记录行数: stageData.stage3?.rows.length ?? 0, 已接受分析: stageData.stage4?.evidenceRounds, 报告框架是否已由服务器生成: Boolean(stageData.stage5?.sections) };
  } else if (stage === 6) {
    visible = { 研究问题: stageData.stage1?.themeMapping?.researchQuestion, 已接受分析: stageData.stage4?.evidenceRounds, 报告摘要: stageData.stage5?.sections ? { 目的: stageData.stage5.sections.purpose, 假设: stageData.stage5.sections.hypothesis, 材料: stageData.stage5.sections.materials, 步骤: stageData.stage5.sections.procedure, 数据摘要: stageData.stage5.sections.dataSummary, 分析: stageData.stage5.sections.analysis, 结论: stageData.stage5.sections.conclusion, 反思: stageData.stage5.sections.reflection } : undefined, 学生最终反思是否已保存: Boolean(stageData.stage6?.studentResponse) };
  } else {
    visible = { 当前阶段: stage };
  }
  return sanitizeTutorVisibleFacts({ ...visible, ...extra });
}
