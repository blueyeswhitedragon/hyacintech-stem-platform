import type { ChatResponse } from '@/app/models/types';
import type { StageData } from '@/app/models/stageData';

export interface ExtractionResult {
  stageData: StageData;
  /** 若需服务端权威推进阶段，给出目标阶段号（如阶段1确认后 → 2）。 */
  advanceTo?: number;
}

/**
 * 纯函数：根据当前阶段与 AI 的结构化产出，把数据合并进 stageData，
 * 并给出是否推进阶段。无副作用、不读 DB —— 便于 fixture 单测。
 */
export function extractStageData(
  currentStage: number,
  response: ChatResponse,
  prev: StageData
): ExtractionResult {
  const stageData: StageData = { ...prev };

  // 阶段1：学生确认研究问题 → 写《确认书》+ 变量，推进到阶段2
  if (currentStage === 1 && response.stage1_confirmed && response.variables) {
    stageData.stage1 = {
      confirmed: true,
      snapshot: response.snapshot ?? '',
      variables: {
        independent: response.variables.independent,
        dependent: response.variables.dependent,
      },
    };
    return { stageData, advanceTo: 2 };
  }

  // 阶段2：方案成型 → 写数据表结构 + AI 风险标注（保留既有审核态）
  if (currentStage === 2 && response.data_table_schema) {
    stageData.stage2 = {
      submitted: prev.stage2?.submitted ?? false,
      approved: prev.stage2?.approved ?? null,
      teacherFeedback: prev.stage2?.teacherFeedback,
      schema: response.data_table_schema,
      aiRiskAnnotations: response.risks ?? prev.stage2?.aiRiskAnnotations,
    };
    return { stageData };
  }

  // 阶段5：生成报告框架 → 预填各节（conclusion/reflection 留空给学生）
  if (currentStage === 5 && response.report_sections) {
    stageData.stage5 = {
      submitted: prev.stage5?.submitted ?? false,
      approved: prev.stage5?.approved ?? null,
      sections: {
        ...response.report_sections,
        conclusion: prev.stage5?.sections?.conclusion ?? '',
        reflection: prev.stage5?.sections?.reflection ?? '',
      },
      aiReferenceScore: prev.stage5?.aiReferenceScore,
      teacherScore: prev.stage5?.teacherScore,
      teacherFeedback: prev.stage5?.teacherFeedback,
    };
    return { stageData };
  }

  return { stageData };
}
