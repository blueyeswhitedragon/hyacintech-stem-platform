import { createHash } from 'crypto';
import type { ChatResponse, Message } from '@/app/models/types';
import type { StageData } from '@/app/models/stageData';
import { repairJson } from '@/app/lib/llm/jsonRepair';
import { createLLMProvider } from '@/app/lib/llm/provider';
import type { LLMCompletion, LLMRuntimeOverride } from '@/app/lib/llm/types';

export const TUTOR_LANGUAGE_CONTRACT_VERSION = 'tutor-language-v1';
export const TUTOR_SEMANTIC_VALIDATOR_VERSION = 'tutor-semantic-validator-v2';
export const TUTOR_LANGUAGE_PROMPT_V1 = 'tutor-language-prompt-v1';
export const TUTOR_LANGUAGE_PROMPT_V2 = 'tutor-language-prompt-v2';
export const TUTOR_LANGUAGE_PROMPT_V2_1 = 'tutor-language-prompt-v2.1';
export const TUTOR_LANGUAGE_PROMPT_V2_2 = 'tutor-language-prompt-v2.2';
export const TUTOR_LANGUAGE_PROMPT_V2_3 = 'tutor-language-prompt-v2.3';
/** Production remains on v1 until Data Lab smoke/calibration gates pass. */
export const TUTOR_LANGUAGE_PROMPT_VERSION = TUTOR_LANGUAGE_PROMPT_V1;
export const DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION = TUTOR_LANGUAGE_PROMPT_V2_3;
export const TUTOR_LANGUAGE_PROMPT_VERSIONS = [TUTOR_LANGUAGE_PROMPT_V1, TUTOR_LANGUAGE_PROMPT_V2, TUTOR_LANGUAGE_PROMPT_V2_1, TUTOR_LANGUAGE_PROMPT_V2_2, TUTOR_LANGUAGE_PROMPT_V2_3] as const;
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
  completedFocusIds?: string[];
  planReady?: boolean;
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

function questionTargets(text: string): string[] {
  const questionClauses = text.split(/[。！!；;\n]/).filter((clause) => /[？?]|(?:吗|呢)\s*$/.test(clause));
  const patterns: Record<string, RegExp> = {
    hypothesis: /(?:你觉得|你认为|预测|假设).{0,18}(?:会|怎样|如何|影响|变化)/,
    independent_variable: /(?:改变|控制|自变量).{0,10}(?:什么|哪个|哪种|因素|条件)/,
    levels: /(?:哪些|哪几|几个|多少|设置|选择|为什么选择).{0,12}(?:水平|组别|实验组|时间点|时长|温度|浓度|剂量)|(?:这些|这|上述|当前).{0,8}(?:组|水平|条件).{0,16}(?:最终|全部|调整|增加|确定)|(?:水平|组别|实验组|条件设置).{0,16}(?:调整|增加|最终|全部)/,
    dependent_variable: /(?:观察|关注|记录).{0,8}(?:什么|哪个|哪种)(?:结果|现象|指标)?|因变量是什么/,
    measurement: /(?:怎么|怎样|如何|用什么).{0,12}(?:测量|记录|观察)|(?:测量|记录).{0,8}(?:方法|工具|起点)/,
    controls: /(?:哪些|什么|怎样).{0,10}(?:保持一致|保持不变|控制条件)|控制变量/,
    repeats: /(?:每组|每个水平|每种条件|重复).{0,10}(?:多少|几个|几次|数量)|多少(?:颗|个|次).{0,6}(?:平均|重复)/,
  };
  return Object.entries(patterns).flatMap(([focus, pattern]) => (
    questionClauses.some((clause) => pattern.test(clause)) ? [focus] : []
  ));
}

function violatesTutorSemanticContract(
  response: TutorLanguageResponse,
  phase?: number,
  context: { completedFocusIds?: string[]; planReady?: boolean } = {},
): boolean {
  if (['direction_confirmation', 'plan_confirmation'].includes(response.focus) && response.interactionType !== 'checkpoint') {
    return true;
  }
  if (phase === 1) {
    const text = [response.dialogue, ...response.hints].join('\n');
    const overreach = [
      /(?:自变量|因变量|控制变量|因素方向|现象方向)/,
      /(?:几个|哪些|哪几种|具体).{0,10}(?:水平|梯度|组别|实验组)/,
      /(?:怎么|如何|用什么).{0,10}(?:测量|记录|观察结果)/,
      /(?:准备|需要|选择).{0,8}(?:材料|器材)/,
      /(?:实验|操作).{0,6}(?:步骤|流程)/,
      /(?:重复|测量).{0,6}(?:几次|次数)/,
      /(?:保持不变|控制条件|安全注意)/,
    ];
    if (overreach.some((pattern) => pattern.test(text))) return true;
  }
  if (phase === 2) {
    const text = [response.dialogue, ...response.hints].join('\n');
    if (context.planReady === false && /(?:可以|就能|现在|正式)?(?:开始实验|进入实验|进入过程执行)/.test(text)) return true;
    const targets = questionTargets(text);
    if (targets.some((target) => target !== response.focus)) return true;
    if (targets.some((target) => context.completedFocusIds?.includes(target) && target !== response.focus)) return true;
    if (response.focus === 'plan_confirmation' && /(?:水平|测量|材料|步骤|重复|控制|安全)[^。！\n]*[？?]/.test(text)) return true;
  }
  return false;
}

export function parseTutorLanguageResponse(
  raw: string,
  allowedFocusIds: string[],
  phase?: number,
  semanticContext: { completedFocusIds?: string[]; planReady?: boolean } = {},
): TutorLanguageResponse | null {
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
  const response = { dialogue, interactionType: interactionType as TutorInteractionType, focus, hints };
  return violatesTutorSemanticContract(response, phase, semanticContext) ? null : response;
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

export const TUTOR_BEHAVIOR_SPEC_V2_2 = [
  ...TUTOR_BEHAVIOR_SPEC_V2_1.split('\n- '),
  '阶段边界是硬合同：阶段1只形成并确认研究问题；变量、水平、测量、控制、材料、步骤、重复和安全全部留到阶段2。',
  'focus 为 direction_confirmation 或 plan_confirmation 时 interactionType 必须是 checkpoint；只引导核对服务器预览和页面按钮，不再追问新字段。',
].join('\n- ');

export const TUTOR_BEHAVIOR_SPEC_V2_3 = [
  ...TUTOR_BEHAVIOR_SPEC_V2_2.split('\n- '),
  '阶段2以服务器给出的唯一 focus 为准；已经满足的字段不得重新追问，也不得要求学生增加已经足以形成比较的实验组。',
  '学生明确科学核心后，材料、步骤和低风险安全基线由服务器组装；Tutor 只引导核对预览，不要求学生逐项复述。',
  '方案预览尚未生成时不得声称可以开始实验或进入过程执行。',
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

function buildTutorLanguagePromptV2_2(input: Omit<TutorVisibleContext, 'tutorHistory' | 'priorStudentMessages' | 'currentStudentMessage'>): string {
  const focusLines = input.allowedFocusIds.map((id) => `- ${id}: ${input.focusDescriptions?.[id] ?? '只处理当前 focus 对应的一个缺口'}`).join('\n');
  const facts = sanitizeTutorVisibleFacts(input.visibleFacts);
  return `你是一名中学 STEM 探究导师。你只生成本回合对学生说的话；状态、确认哈希、方案预览、表格、安全题、证据进度和报告框架全部由服务器负责。

【Prompt 版本 ${TUTOR_LANGUAGE_PROMPT_V2_2}】
【行为规范】
- ${TUTOR_BEHAVIOR_SPEC_V2_2}

【唯一事实来源】
学生本轮消息与下列可见事实。没有出现的材料、变量、数值、单位、异常或条件不得补充。
可见事实：${JSON.stringify(facts)}

【本回合】
阶段：${input.phase}
触发类型：${input.triggerType}
只允许选择一个 focus：
${focusLines}

【输出前硬检查】
- 阶段1是否只围绕研究问题，没有追问任何阶段2细节？
- direction_confirmation/plan_confirmation 是否使用 checkpoint，并只让学生核对服务器预览？
- 是否最多一个问句、没有答案菜单、没有无来源事实？
- hints 是否确有必要；否则是否为 []？

【输出合同 ${TUTOR_LANGUAGE_CONTRACT_VERSION}】
只输出一个 JSON 对象，不要 Markdown，不要附加字段：
{"dialogue":"自然、简洁、具体、面向学生的中文","interactionType":"open_question|clarification|explanation|checkpoint|information","focus":"allowed focus id","hints":[]}`;
}

function buildTutorLanguagePromptV2_3(input: Omit<TutorVisibleContext, 'tutorHistory' | 'priorStudentMessages' | 'currentStudentMessage'>): string {
  const focusLines = input.allowedFocusIds.map((id) => `- ${id}: ${input.focusDescriptions?.[id] ?? '只处理当前 focus 对应的一个缺口'}`).join('\n');
  const facts = sanitizeTutorVisibleFacts(input.visibleFacts);
  return `你是一名中学 STEM 探究导师。你只生成本回合对学生说的话；状态、就绪判断、确认哈希、方案预览、表格、安全题和报告框架全部由服务器负责。

【Prompt 版本 ${TUTOR_LANGUAGE_PROMPT_V2_3}】
【行为规范】
- ${TUTOR_BEHAVIOR_SPEC_V2_3}

【唯一事实来源】
学生本轮消息与下列可见事实。没有出现的材料、变量、数值、单位、异常或条件不得补充。
可见事实：${JSON.stringify(facts)}

【本回合】
阶段：${input.phase}
触发类型：${input.triggerType}
只允许选择一个 focus：
${focusLines}

【输出前硬检查】
- 是否只处理唯一 focus，没有重新追问已满足内容？
- 方案未就绪时，是否避免声称可以开始实验？
- direction_confirmation/plan_confirmation 是否使用 checkpoint，并只引导核对页面状态或预览？
- 是否最多一个问句、没有答案菜单；hints 没必要时是否为 []？

【输出合同 ${TUTOR_LANGUAGE_CONTRACT_VERSION}】
只输出一个 JSON 对象，不要 Markdown，不要附加字段：
{"dialogue":"自然、简洁、具体、面向学生的中文","interactionType":"open_question|clarification|explanation|checkpoint|information","focus":"allowed focus id","hints":[]}`;
}

export function buildTutorLanguagePrompt(
  input: Omit<TutorVisibleContext, 'tutorHistory' | 'priorStudentMessages' | 'currentStudentMessage'>,
  promptVersion: TutorLanguagePromptVersion = TUTOR_LANGUAGE_PROMPT_VERSION,
): string {
  if (promptVersion === TUTOR_LANGUAGE_PROMPT_V2_3) return buildTutorLanguagePromptV2_3(input);
  if (promptVersion === TUTOR_LANGUAGE_PROMPT_V2_2) return buildTutorLanguagePromptV2_2(input);
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
  const systemTriggered = ['STAGE_ENTER', 'STAGE_TRANSITION', 'REPORT_BOOTSTRAP'].includes(input.triggerType);
  return [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((message) => ({ role: message.role, content: message.content })),
    {
      role: 'user' as const,
      content: `${systemTriggered ? '这是系统触发，不是学生发言。' : `学生本轮说：${input.currentStudentMessage}`}${repair ? `\n\n${repair}` : ''}`,
    },
  ];
}

function deterministicTutorFallback(input: TutorVisibleContext): TutorLanguageResponse {
  const focus = input.allowedFocusIds[0] ?? 'clarification';
  const dialogueByFocus: Record<string, string> = {
    research_question: '请先用一句话说清楚，你最想研究的具体问题是什么？',
    direction_confirmation: '研究问题已经整理好，请核对页面上的问题；确认无误后使用按钮进入方案设计。',
    hypothesis: '请先说出你的预测：改变研究条件后，你认为观察结果会怎样变化？',
    independent_variable: '为了形成可比较的方案，请说清楚你准备主动改变哪一个条件。',
    levels: '请列出你准备比较的至少两个具体水平。',
    dependent_variable: '请说清楚实验中要观察的结果是什么。',
    measurement: '请说明你准备怎样重复、客观地测量或记录这个结果。',
    controls: '为了公平比较，请说出实验各组需要保持一致的关键条件。',
    repeats: '请说明每个实验水平准备安排多少次重复。',
    plan_confirmation: '方案已经整理完成，请核对页面预览；确认内容无误后使用按钮继续。',
    safety_checkpoint: '请先完成页面上的安全问答，再开始记录实验数据。',
    execution_support: '请按已确认方案如实记录本次实验情况；遇到异常时先停止并告知教师。',
    cite_evidence: '请从数据表中引用两项具体数值，完成一次明确比较。',
    interpret_evidence: '请根据刚才引用的数据，说说它们支持什么判断。',
    report_handoff: '报告框架已经生成，请查看页面中仍需你完成的部分。',
    report_gap: '请先补充页面中当前缺失的一项报告内容。',
    reflection_coaching: '请结合这次探究，说出一项你下次最想改进的地方。',
  };
  const checkpoint = ['direction_confirmation', 'plan_confirmation'].includes(focus);
  return {
    dialogue: dialogueByFocus[focus] ?? '请围绕当前问题补充一项具体信息。',
    interactionType: checkpoint ? 'checkpoint' : 'clarification',
    focus,
    hints: [],
  };
}

export async function callTutorLanguageWithTrace(
  input: TutorVisibleContext,
  runtimeModel: LLMRuntimeOverride,
  promptVersion: TutorLanguagePromptVersion = TUTOR_LANGUAGE_PROMPT_VERSION,
): Promise<TutorLanguageTrace> {
  if (!TUTOR_LANGUAGE_PROMPT_VERSIONS.includes(promptVersion)) {
    throw new Error(`不支持的 Tutor Prompt 版本：${promptVersion}`);
  }
  const systemPrompt = buildTutorLanguagePrompt(input, promptVersion);
  const promptSha256 = createHash('sha256').update(systemPrompt).digest('hex');
  const provider = createLLMProvider({ ...runtimeModel, role: 'TUTOR' });
  const attempts: TutorLanguageTrace['attempts'] = [];
  let repair: string | undefined;
  let completion: LLMCompletion | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    completion = await provider.complete(messagesForTutor(systemPrompt, input, repair), {
      useJsonFormat: true,
      maxTokens: 1200,
    });
    const parsed = parseTutorLanguageResponse(completion.content, input.allowedFocusIds, input.phase, {
      completedFocusIds: input.completedFocusIds,
      planReady: input.planReady,
    });
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
          promptVersion,
          validatorPolicyVersion: TUTOR_SEMANTIC_VALIDATOR_VERSION,
        },
        attempts,
      };
    }
    const failure = completion.finishReason === 'length' ? 'OUTPUT_TRUNCATED' : 'INVALID_TUTOR_LANGUAGE_JSON';
    attempts.push({ attempt, failure, finishReason: completion.finishReason });
    repair = `上一次输出未通过 ${TUTOR_LANGUAGE_CONTRACT_VERSION} 与阶段语义校验（${failure}）。只输出合法 JSON；focus 必须是 ${input.allowedFocusIds.join('、')} 之一；确认 focus 必须使用 checkpoint；不得跨阶段追问；hints 最多一条且不得重复 dialogue。`;
  }
  const response = deterministicTutorFallback(input);
  return {
    response,
    rawOutput: completion?.content ?? '',
    promptSha256,
    generationParams: {
      ...(completion?.request ?? {}),
      finishReason: completion?.finishReason ?? null,
      usage: completion?.usage,
      successfulAttempt: null,
      promptVersion,
      validatorPolicyVersion: TUTOR_SEMANTIC_VALIDATOR_VERSION,
      deterministicTutorFallback: true,
    },
    attempts,
  };
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
      可选兴趣背景: source('stage1.originalInterest'),
      学生提出的研究问题: source('stage1.researchQuestion'),
      是否已明确确认: value('stage1.confirmed') === true,
    };
  } else if (stage === 2) {
    visible = {
      阶段一已确认: stageData.stage1 ? {
        研究问题: stageData.stage1.researchQuestion ?? stageData.stage1.themeMapping?.researchQuestion,
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
      服务器方案预览: stageData.stage2?.planDraft ? {
        方案: stageData.stage2.planDraft,
        草案哈希: stageData.stage2.draftHash,
        是否已确认当前版本: stageData.stage2.confirmedPlanHash === stageData.stage2.draftHash,
        字段来源: stageData.stage2.planProvenance,
      } : undefined,
      方案核心就绪状态: stageData.stage2?.readiness,
    };
  } else if (stage === 3) {
    visible = { 已批准实验方案: planForTutor, 已审核风险: stageData.stage2?.aiRiskAnnotations, 安全检查是否通过: stageData.stage3?.safetyQuiz?.passed === true };
  } else if (stage === 5) {
    visible = { 已确认研究方向: stageData.stage1?.snapshot, 已批准实验方案: planForTutor, 数据记录行数: stageData.stage3?.rows.length ?? 0, 已接受分析: stageData.stage4?.evidenceRounds, 报告框架是否已由服务器生成: Boolean(stageData.stage5?.sections) };
  } else if (stage === 6) {
    visible = {
      研究问题: stageData.stage1?.researchQuestion ?? stageData.stage1?.themeMapping?.researchQuestion,
      已接受分析: stageData.stage4?.evidenceRounds,
      报告摘要: stageData.stage5?.sections ? {
        目的: stageData.stage5.sections.purpose,
        假设: stageData.stage5.sections.hypothesis,
        材料: stageData.stage5.sections.materials,
        步骤: stageData.stage5.sections.procedure,
        数据摘要: stageData.stage5.sections.dataSummary,
        分析: stageData.stage5.sections.analysis,
        结论: stageData.stage5.sections.conclusion,
        局限与讨论: stageData.stage5.sections.limitationsDiscussion ?? stageData.stage5.sections.reflection,
      } : undefined,
      教师评价: stageData.stage5 ? {
        评分: stageData.stage5.teacherScore,
        反馈: stageData.stage5.teacherFeedback,
      } : undefined,
      学生是否已回应教师评价: Boolean(stageData.stage6?.responseToTeacherFeedback),
      学生是否已完成学习反思: Boolean(stageData.stage6?.learningReflection),
    };
  } else {
    visible = { 当前阶段: stage };
  }
  return sanitizeTutorVisibleFacts({ ...visible, ...extra });
}
