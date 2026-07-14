import type { ChatResponse } from '@/app/models/types';
import type { StageTriggerType } from '@/app/lib/stageContract';

export const STYLE_FAMILIES = [
  'socratic_concise',
  'warm_companion',
  'engineering_mentor',
  'evidence_analyst',
  'classroom_coach',
] as const;

export type StyleFamily = (typeof STYLE_FAMILIES)[number];
export type AssistantStyleSelection = StyleFamily | 'auto';

export const DEFAULT_STYLE_FAMILY: StyleFamily = 'classroom_coach';
export const DEFAULT_STYLE_POLICY_VERSION = 'style-v1';
export const AUTO_STYLE_STRATEGY_VERSION = 'balanced-static-v1';

export interface StylePolicy {
  family: StyleFamily;
  version: typeof DEFAULT_STYLE_POLICY_VERSION;
  label: string;
  summary: string;
  systemInstruction: string;
  annotationRubric: readonly string[];
  forbiddenPatterns: readonly string[];
}

export interface StyleAuthenticityResult {
  neutralSystemResponse: boolean;
  indicators: string[];
  issues: string[];
}

export const STYLE_LABELS: Record<StyleFamily, string> = {
  socratic_concise: '苏格拉底简洁型',
  warm_companion: '温和陪伴型',
  engineering_mentor: '工程导师型',
  evidence_analyst: '证据分析型',
  classroom_coach: '课堂教练型',
};

export const STYLE_POLICIES: Record<StyleFamily, StylePolicy> = {
  socratic_concise: {
    family: 'socratic_concise',
    version: DEFAULT_STYLE_POLICY_VERSION,
    label: STYLE_LABELS.socratic_concise,
    summary: '短句、单一核心问题，让学生通过回答自己推进推理。',
    systemInstruction: '保持简洁，优先用一个关键问题推动学生思考；必要说明控制在最少范围内，避免一次给出完整方案或结论。',
    annotationRubric: ['每轮至多一个核心问题', '说明简短且紧扣当前阶段', '保留学生作出判断和选择的空间'],
    forbiddenPatterns: ['连续堆叠多个追问', '替学生直接完成方案或结论', '用长篇背景知识压过当前任务'],
  },
  warm_companion: {
    family: 'warm_companion',
    version: DEFAULT_STYLE_POLICY_VERSION,
    label: STYLE_LABELS.warm_companion,
    summary: '先接住学生的想法和困难，再用温和而具体的提示推进。',
    systemInstruction: '先用一句自然、具体的话回应学生当前的想法或困难，再给出可执行的小步引导；语气温和但不空泛，不用夸张鼓励替代科学判断。',
    annotationRubric: ['回应学生刚刚提供的具体内容', '提示分成学生容易完成的小步', '温和表达不降低证据和安全要求'],
    forbiddenPatterns: ['模板化夸奖', '为了安慰而确认错误结论', '一次布置过多任务'],
  },
  engineering_mentor: {
    family: 'engineering_mentor',
    version: DEFAULT_STYLE_POLICY_VERSION,
    label: STYLE_LABELS.engineering_mentor,
    summary: '关注约束、变量、可实现性和迭代验证，保留工程问题的真实机制。',
    systemInstruction: '用工程导师视角关注目标、约束、可改变参数、可测表现和迭代验证；把宏大作品转化为可测试代理时必须保留关键机制，不要直接替学生给出成品方案。',
    annotationRubric: ['明确目标与现实约束', '把设计选择转成可比较和可测的参数', '建议先做小规模原型或对照验证'],
    forbiddenPatterns: ['直接给出完整成品方案', '忽略材料、资源或安全约束', '把工程制作强行改成无关实验'],
  },
  evidence_analyst: {
    family: 'evidence_analyst',
    version: DEFAULT_STYLE_POLICY_VERSION,
    label: STYLE_LABELS.evidence_analyst,
    summary: '区分观察、趋势、解释和结论，持续追问证据是否足够。',
    systemInstruction: '清楚区分观察到的数据、从数据看到的趋势、可能解释和最终结论；引导学生引用具体证据并处理异常与不确定性，但不要在证据不足时替学生下结论。',
    annotationRubric: ['要求观点对应具体数据或观察', '区分证据与推测', '主动注意异常值、误差和替代解释'],
    forbiddenPatterns: ['无数据时给出确定结论', '忽略异常和不确定性', '把相关性直接说成因果关系'],
  },
  classroom_coach: {
    family: 'classroom_coach',
    version: DEFAULT_STYLE_POLICY_VERSION,
    label: STYLE_LABELS.classroom_coach,
    summary: '像课堂教师一样给出清晰任务、适量示例和下一步检查点。',
    systemInstruction: '像课堂教师一样明确本轮目标、给出适量支架并说明下一步检查点；保持节奏清楚、要求可执行，同时避免把学生应完成的核心思考直接代写。',
    annotationRubric: ['本轮目标和下一步动作清楚', '示例或支架数量适中', '在关键节点检查学生是否理解'],
    forbiddenPatterns: ['任务要求含糊', '一次给出过多示例或步骤', '以标准答案取代学生表达'],
  },
};

export const ASSISTANT_STYLE_OPTIONS: ReadonlyArray<{
  value: AssistantStyleSelection;
  label: string;
  summary: string;
}> = [
  { value: 'auto', label: '自动适配', summary: '按作业和学生稳定分配一种风格，同一会话中保持不变。' },
  ...STYLE_FAMILIES.map((family) => ({ value: family, label: STYLE_POLICIES[family].label, summary: STYLE_POLICIES[family].summary })),
];

export function isStyleFamily(value: unknown): value is StyleFamily {
  return typeof value === 'string' && STYLE_FAMILIES.includes(value as StyleFamily);
}

export function isAssistantStyleSelection(value: unknown): value is AssistantStyleSelection {
  return value === 'auto' || isStyleFamily(value);
}

export function styleSelectionLabel(value: unknown): string {
  if (value === 'auto') return '自动适配';
  return isStyleFamily(value) ? STYLE_LABELS[value] : STYLE_LABELS[DEFAULT_STYLE_FAMILY];
}

/** FNV-1a 32-bit：只用于稳定分桶，不用于安全或身份用途。 */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function resolveStyleFamily(
  selection: AssistantStyleSelection,
  assignmentId: string,
  studentId: string,
): StyleFamily {
  if (selection !== 'auto') return selection;
  const bucket = stableHash(`${AUTO_STYLE_STRATEGY_VERSION}:${assignmentId}:${studentId}`) % STYLE_FAMILIES.length;
  return STYLE_FAMILIES[bucket];
}

export function getStylePolicy(
  family: StyleFamily,
  version = DEFAULT_STYLE_POLICY_VERSION,
): StylePolicy {
  if (version !== DEFAULT_STYLE_POLICY_VERSION) {
    throw new Error(`不支持的导师风格规范版本：${version}`);
  }
  return STYLE_POLICIES[family];
}

export function buildStyleInstruction(
  family: StyleFamily,
  version = DEFAULT_STYLE_POLICY_VERSION,
): string {
  const policy = getStylePolicy(family, version);
  return `【导师回复风格：${policy.label}（${policy.version}）】\n${policy.systemInstruction}\n风格只能改变表达和引导策略，不能覆盖当前实验阶段、结构化输出、安全要求或学生主导性规则。`;
}

/** Deterministic, observable style evidence. Metadata alone is never enough. */
export function evaluateStyleAuthenticity(
  family: StyleFamily,
  response: ChatResponse,
  context: { phase: number; triggerType?: StageTriggerType },
): StyleAuthenticityResult {
  const text = [response.dialogue, ...(response.hints ?? [])].join('\n');
  const questionCount = (response.dialogue.match(/[？?]/g) ?? []).length;
  const neutralSystemResponse = (
    context.triggerType === 'STAGE_ENTER' && !!response.safety_quiz
  ) || (
    context.triggerType === 'REPORT_BOOTSTRAP' && !!response.report_sections
  ) || (
    // 阶段收敛轮的首要职责是交付结构化确认物，不应为了证明“苏格拉底
    // 风格”而额外追问。风格真实性由同一记录中的引导轮证明。
    context.phase === 1
    && response.stage1_confirmed === true
    && response.next_action_type === 'confirmation'
  ) || (
    context.phase === 2
    && !!response.experiment_plan
    && !!response.data_table_schema
    && response.next_action_type === 'confirmation'
  );
  if (neutralSystemResponse) return { neutralSystemResponse: true, indicators: [], issues: [] };

  const indicators: string[] = [];
  const issues: string[] = [];
  if (family === 'socratic_concise') {
    if (questionCount === 1) indicators.push('single_open_question');
    if (response.dialogue.length <= 180) indicators.push('concise');
    if (questionCount !== 1) issues.push('缺少唯一的开放问题');
    if (response.dialogue.length > 180) issues.push('回复不够简洁');
  }
  if (family === 'warm_companion') {
    if (/我理解|听起来|你已经|别着急|可以先|我们先|这个想法|这个困难|你注意到/.test(text)) indicators.push('specific_emotional_bridge');
    if (/先|一步|从.{0,12}开始|试着/.test(text)) indicators.push('small_step');
    if (!indicators.includes('specific_emotional_bridge')) issues.push('缺少对学生当前想法或困难的具体承接');
  }
  if (family === 'engineering_mentor') {
    if (/约束|参数|可测|范围|验证|核对|一致|重复|原型|记录位置/.test(text)) indicators.push('engineering_constraint_or_validation');
    if (indicators.length === 0) issues.push('缺少工程约束、参数或验证视角');
  }
  if (family === 'evidence_analyst') {
    if (/证据|数据|数值|观察|异常|不确定|解释|相关|因果|误差/.test(text)) indicators.push('evidence_or_uncertainty');
    if (indicators.length === 0) issues.push('缺少证据位置或不确定性表达');
  }
  if (family === 'classroom_coach') {
    if (/本轮|先|下一步|请|完成|检查|核对|填写|指出/.test(text)) indicators.push('task_scaffold');
    if (/下一步|完成后|然后|检查点|核对后/.test(text)) indicators.push('checkpoint');
    if (indicators.length === 0) issues.push('缺少清晰任务、支架或检查点');
  }
  return { neutralSystemResponse: false, indicators, issues };
}
