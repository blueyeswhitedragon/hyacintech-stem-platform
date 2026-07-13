/**
 * 提示词管理中心
 * 包含各阶段的提示词和安全约束
 */

import phaseOnePrompt from './phase1-topic-selection';
import phaseTwoPrompt from './phase2-plan-design';
import phaseThreePrompt from './phase3-execution';
import phaseFourPrompt from './phase4-data-analysis';
import phaseFivePrompt from './phase5-results-formation';
import phaseSixPrompt from './phase6-reflection';
import { PhaseEnum } from '../models/types';
import type { Stage2Data } from '../models/stageData';
import { buildStageContractInstruction, type StageTriggerType } from '../lib/stageContract';
import { pickTopicExamples, renderTopicExamples } from '../lib/topicLibrary';
import {
  buildStyleInstruction,
  DEFAULT_STYLE_FAMILY,
  DEFAULT_STYLE_POLICY_VERSION,
  type StyleFamily,
} from '../lib/stylePolicy';

// 创建提示词映射表
export const promptTemplates = {
  [PhaseEnum.TopicSelection]: phaseOnePrompt,
  [PhaseEnum.PlanDesign]: phaseTwoPrompt,
  [PhaseEnum.Execution]: phaseThreePrompt,
  [PhaseEnum.DataAnalysis]: phaseFourPrompt,
  [PhaseEnum.ResultsFormation]: phaseFivePrompt,
  [PhaseEnum.Reflection]: phaseSixPrompt,
};

// 安全敏感关键词黑名单
export const BLACKLIST_KEYWORDS = [
  "浓硫酸", "硫酸", "盐酸", "王水", 
  "220V", "高压电", "市电", 
  "解剖", "活体", "脊椎动物", 
  "细菌培养", "病毒", "病原体", 
  "爆炸", "爆破", "炸药", 
  "放射性", "辐射源",
  // 可根据需要扩展
];

/**
 * 注入安全约束到提示词
 * @param basePrompt 基础提示词
 * @returns 注入安全约束后的提示词
 */
export function injectSafetyConstraints(basePrompt: string): string {
  const safetyConstraints = `
作为上海STEM教育指导教师，你必须严格遵守以下安全原则：

1. 如果学生的方案涉及强酸、强碱、有毒化学品，必须立即禁止并解释安全原则，引导至安全替代方案
2. 如果学生的提案涉及220V市电、高压电等，必须阻止并提供使用电池等低压替代方案
3. 严禁任何涉及活体脊椎动物解剖的实验，应引导使用模型或视频资料
4. 禁止任何可能产生有害气体、粉尘或危险反应的实验
5. 对于任何有安全隐患的提议，不要简单拒绝，而应该解释风险并引导到安全的替代方案

记住：你的首要职责是确保学生安全，同时鼓励他们的科学探索精神。
`;

  return `${basePrompt}\n\n${safetyConstraints}`;
}

/**
 * 检查消息中是否包含黑名单关键词
 * @param message 用户输入的消息
 * @returns 包含的黑名单关键词，如果没有则返回null
 */
export function checkBlacklistedKeywords(message: string): string | null {
  const lowercaseMessage = message.toLowerCase();
  for (const keyword of BLACKLIST_KEYWORDS) {
    if (lowercaseMessage.includes(keyword.toLowerCase())) {
      return keyword;
    }
  }
  return null;
}

/**
 * 动态上下文：在静态提示词后注入作业/阶段相关数据。
 */
export interface PromptContext {
  styleFamily?: StyleFamily;
  stylePolicyVersion?: string;
  topicDirection?: string; // 阶段1：作业限定的研究方向
  topicExamples?: string; // 阶段1：动态选题案例库（由 topicLibrary 渲染）
  dataRows?: Record<string, unknown>[]; // 阶段4：stage3 收集的数据
  dataSchema?: Stage2Data['schema']; // 阶段4：列标题和类型
  priorSummary?: string; // 阶段5/6：前序结构化摘要
  needSafetyQuiz?: boolean; // 阶段3：是否首次进入需出安全问答
  nudgeConverge?: boolean; // 任意阶段：轮次过多，提示模型尽快收敛放行
  triggerType?: StageTriggerType;
}

/**
 * 注入统一的对话节奏总则（降低过度追问）+ 排版与字段分工规则。所有阶段都加。
 */
export function injectPacingGuidance(basePrompt: string): string {
  const pacing = `
【对话节奏总则（务必遵守）】
- 每轮最多 1 个核心问题 + 至多 1 个追问，不要连续追问同一个点。
- 学生给出合理（即使不完美）的回答时，顺势推进并补充思维提示，不必追求完美。
- 若连续多轮停留在同一问题上，主动给出思考框架并推进，不要让追问变得没有意义。

【排版规则（务必遵守）】
- dialogue 中优先不用 Markdown。若确实需要强调，只允许用 **……** 加粗 1-2 个关键术语（如 **自变量**、**因变量**），每条消息最多 2 处加粗；不要把长句、整段或多个变量名都加粗。
- 严禁使用其他任何 Markdown 语法：不要用 # 标题、不要用 - 或 * 开头的列表符号、不要用代码块和表格。需要分条陈述时，用 \\n 换行配合"1. 2. 3."或"①②③"编号。
- 特别注意：dialogue 的每一行都不能以 "- " 或 "* " 开头；列举示例请写成 "① 冰箱冷藏：约4℃\\n② 室内常温：约20℃"。

【options 与 hints 的分工（务必遵守）】
- options 仅在 next_action_type 为 "ask_choice" 时使用，且每个选项必须是学生可直接选择的简短答案（不超过15字），例如 ["光照时长", "水量", "温度"]。
- 思维引导、提示语、开放式启发一律放在 hints 中，严禁放入 options。
- 如果你想引导学生思考而非让其选择，就用 "text_input" + hints，不要用 "ask_choice"。
- 阶段1（选题定向）禁止使用 ask_choice 和非空 options；不要用选项式课题方向替代学生自己的课题转化。`;
  return `${basePrompt}\n${pacing}`;
}

function renderRowsAsTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '（学生尚未录入数据）';
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const header = ['行号', ...keys].join(' | ');
  const body = rows
    .map((r, index) => [String(index + 1), ...keys.map((k) => String(r[k] ?? ''))].join(' | '))
    .join('\n');
  return `${header}\n${body}`;
}

/**
 * 获取特定阶段的提示词（含安全约束 + 可选动态上下文）。
 */
export function getPromptForPhase(phase: PhaseEnum, context?: PromptContext): string {
  const basePrompt = promptTemplates[phase];
  let prompt = injectSafetyConstraints(basePrompt);
  prompt = injectPacingGuidance(prompt);
  prompt += `\n\n${buildStageContractInstruction(phase)}`;

  const ctx = context ?? {};
  prompt += `\n\n${buildStyleInstruction(
    ctx.styleFamily ?? DEFAULT_STYLE_FAMILY,
    ctx.stylePolicyVersion ?? DEFAULT_STYLE_POLICY_VERSION,
  )}`;

  if (ctx.nudgeConverge) {
    prompt += `\n\n【对话节奏提醒——该收敛了】\n本阶段对话轮次已较多。请在本轮尽快收敛：若学生已满足本阶段最低要求，就立即输出阶段完成信号（第一阶段输出 stage1_confirmed 与确认书；第二阶段输出 data_table_schema），不要再提出新的追问。`;
  }

  if (phase === PhaseEnum.TopicSelection) {
    if (ctx.topicDirection) {
      prompt += `\n\n【本作业限定研究方向】\n本次作业要求围绕「${ctx.topicDirection}」展开。请在选题引导中自然地把学生引向这个方向，但仍让学生自己提出具体问题与变量。`;
    }

    const topicExamples = ctx.topicExamples ?? renderTopicExamples(
      pickTopicExamples({ topicDirection: ctx.topicDirection, count: 8 })
    );
    prompt += `\n\n【动态转化模式库（来自国家智慧教育平台公开资源，供内部启发，勿照搬）】\n${topicExamples}\n\n【工程/跨学科主题转化规则】\n当学生想做“装置/模型/机器人/系统/作品”时，不要否定它不够像实验，也不要直接给作品方案；请把它转化为可探究问题：\n1. 保留原作品里的关键约束或机制，例如自动判断、材料保护、能量转换、资源限制。\n2. 找一个课堂可改变的代理参数（材料、尺寸、角度、结构、程序阈值、传感器位置等），作为自变量方向。\n3. 再找一个可观察的表现方向（距离、承重、净化效果、成功率、响应时间、稳定性等）。具体测量方式、步骤、数据表与控制变量留到阶段2。`;
  }

  if (phase === PhaseEnum.PlanDesign && ctx.priorSummary) {
    prompt += `\n\n【阶段1已确认方向】\n以下内容是学生已确认的研究问题与方向。本阶段只能在此基础上操作化变量和设计方案，不得重新换题：\n${ctx.priorSummary}`;
  }

  if (phase === PhaseEnum.Execution && ctx.priorSummary) {
    prompt += `\n\n【当前已审核方案】\n只能依据以下真实方案提供安全问答、操作提醒和记录指导；不得新增未出现的参数、条件或材料：\n${ctx.priorSummary}`;
  }

  if (phase === PhaseEnum.Execution && ctx.needSafetyQuiz) {
    prompt += `\n\n【首次进入本阶段】\n这是学生首次进入过程执行阶段。请在本次回复的 JSON 中额外输出 safety_quiz 字段（一道与本实验相关的安全单选题），格式见下方结构化字段说明。`;
  }

  if (phase === PhaseEnum.DataAnalysis && ctx.dataRows) {
    const schemaSummary = ctx.dataSchema?.columns.map((column) => `${column.key}=${column.title}(${column.type})`).join('、') ?? '未提供列定义';
    prompt += `\n\n【学生收集的实验数据】\n列定义：${schemaSummary}\n以下是学生实际录入的数据。只能引用这里出现的值；不得补写、猜测或套用通用 A/B/C 数据：\n${renderRowsAsTable(ctx.dataRows)}`;
  }

  if (phase === PhaseEnum.DataAnalysis && ctx.triggerType === 'STAGE_TRANSITION') {
    prompt += `\n\n【阶段3→4系统主动过渡】\n这是系统在学生完成数据收集后触发的助手开场，不是真实学生消息。请简短说明已经读取数据表，但不要替学生分析结论。只选择一个首个分析动作，要求学生引用至少两个具体数值或两条明确观察作答。next_action_type 必须为 text_input，不输出 analysis_progress，不使用 confirmation。`;
  }

  if (phase === PhaseEnum.ResultsFormation && ctx.priorSummary) {
    prompt += `\n\n【前序阶段摘要】\n已自动注入前序阶段的结构化数据。你必须在本次回复中自动生成 report_sections 字段。只能使用摘要中明确存在的内容；缺失信息写明“待学生补充”，不得使用通用 A/B/C 数据。conclusion 和 reflection 留给学生自己填写。\n\n${ctx.priorSummary}`;
  }

  if (phase === PhaseEnum.Reflection && ctx.priorSummary) {
    prompt += `\n\n【本次探究摘要】\n只能围绕以下真实探究内容提出一个反思问题，不得引入无关的新实验：\n${ctx.priorSummary}`;
  }

  return prompt;
}
