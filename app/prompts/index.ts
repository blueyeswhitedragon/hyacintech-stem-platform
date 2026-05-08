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
 * 获取特定阶段的提示词
 * @param phase 阶段枚举值
 * @returns 包含安全约束的完整提示词
 */
export function getPromptForPhase(phase: PhaseEnum): string {
  const basePrompt = promptTemplates[phase];
  return injectSafetyConstraints(basePrompt);
}