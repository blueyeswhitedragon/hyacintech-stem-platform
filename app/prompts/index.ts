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
  topicDirection?: string; // 阶段1：作业限定的研究方向
  dataRows?: Record<string, unknown>[]; // 阶段4：stage3 收集的数据
  priorSummary?: string; // 阶段5：stage1-4 摘要，供预填报告
  needSafetyQuiz?: boolean; // 阶段3：是否首次进入需出安全问答
}

function renderRowsAsTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '（学生尚未录入数据）';
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const header = keys.join(' | ');
  const body = rows
    .map((r) => keys.map((k) => String(r[k] ?? '')).join(' | '))
    .join('\n');
  return `${header}\n${body}`;
}

/**
 * 获取特定阶段的提示词（含安全约束 + 可选动态上下文）。
 */
export function getPromptForPhase(phase: PhaseEnum, context?: PromptContext): string {
  const basePrompt = promptTemplates[phase];
  let prompt = injectSafetyConstraints(basePrompt);

  if (!context) return prompt;

  if (phase === PhaseEnum.TopicSelection && context.topicDirection) {
    prompt += `\n\n【本作业限定研究方向】\n本次作业要求围绕「${context.topicDirection}」展开。请在选题引导中自然地把学生引向这个方向，但仍让学生自己提出具体问题与变量。`;
  }

  if (phase === PhaseEnum.Execution && context.needSafetyQuiz) {
    prompt += `\n\n【首次进入本阶段】\n这是学生首次进入过程执行阶段。请在本次回复的 JSON 中额外输出 safety_quiz 字段（一道与本实验相关的安全单选题），格式见下方结构化字段说明。`;
  }

  if (phase === PhaseEnum.DataAnalysis && context.dataRows) {
    prompt += `\n\n【学生收集的实验数据】\n以下是学生在过程执行阶段录入的数据表，请据此引导学生观察规律、发现关系（但不要替学生下结论）：\n${renderRowsAsTable(context.dataRows)}`;
  }

  if (phase === PhaseEnum.ResultsFormation && context.priorSummary) {
    prompt += `\n\n【前序阶段摘要】\n已自动注入前序阶段的结构化数据。你必须在本次回复中自动生成 report_sections 字段，预填以下各节（purpose/hypothesis/materials/procedure/dataSummary/analysis），无需等待学生开口要求。conclusion 和 reflection 留空给学生自己填写。\n\n${context.priorSummary}`;
  }

  return prompt;
}