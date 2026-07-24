import type { Stage5Sections } from '../models/stageData';
import { limitationsDiscussion } from '@/app/lib/reportFields';

/**
 * 生成报告参考评分的系统提示词。要求 LLM 只输出 Stage5ReferenceScore 形状的 JSON。
 */
export function buildScoringPrompt(): string {
  return `你是一位资深的上海初中科学探究评审教师。学生提交了一份科学探究实验报告，请你给出一份"参考评分"，供指导教师参考。

评分要求（必须严格遵守）：
你的整个回复必须是一个合法的 JSON 对象，除此之外不能包含任何文字、解释或代码块标记。
JSON 结构如下：
{
  "overall": 整数1-10（综合评分）,
  "dimensions": {
    "completeness": 整数1-10（完整性：报告各部分是否齐全）,
    "logic": 整数1-10（逻辑性：推理是否严密）,
    "dataUsage": 整数1-10（数据运用：是否基于数据得出结论）,
    "innovation": 整数1-10（创新性）,
    "expression": 整数1-10（表达：科学性与清晰度）
  },
  "highlights": ["亮点1", "亮点2"],
  "suggestions": [ { "text": "具体改进建议", "targetSection": "purpose|hypothesis|materials|procedure|dataSummary|analysis|conclusion|limitationsDiscussion" } ],
  "safetyCompliance": true 或 false（实验是否安全合规）
}

注意：
- 改进建议必须锚定到具体的报告章节（targetSection 取上述枚举之一）。
- 评分要客观，结论的科学性比文采更重要。
- 只输出 JSON，不要任何额外文字。`;
}

export function buildReportText(sections: Stage5Sections): string {
  return [
    `【研究目的】${sections.purpose}`,
    `【假设】${sections.hypothesis}`,
    `【实验材料】${sections.materials}`,
    `【实验步骤】${sections.procedure}`,
    `【数据概述】${sections.dataSummary}`,
    `【数据分析】${sections.analysis}`,
    `【结论】${sections.conclusion}`,
    `【局限与讨论】${limitationsDiscussion(sections)}`,
  ].join('\n');
}
