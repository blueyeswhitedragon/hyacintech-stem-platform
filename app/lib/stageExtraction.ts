import type { ChatResponse } from '@/app/models/types';
import type { StageData } from '@/app/models/stageData';
import { normalizeSchema } from './schemaNormalize';

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

  // 阶段1：只固化研究问题、拟改变因素方向和关注现象方向。
  // variables 仅保留为旧会话兼容镜像，正式变量操作化在阶段2完成。
  if (currentStage === 1 && response.stage1_confirmed) {
    const factor = response.topic_direction?.factor?.trim() ?? response.variables?.independent?.trim() ?? '';
    const phenomenon = response.topic_direction?.phenomenon?.trim() ?? response.variables?.dependent?.trim() ?? '';
    stageData.stage1 = {
      confirmed: true,
      snapshot: response.snapshot ?? '',
      themeMapping: response.theme_mapping,
      factorDirection: factor,
      phenomenonDirection: phenomenon,
      variables: {
        independent: factor,
      },
    };
    return { stageData };
  }

  // 阶段2：方案成型 → 同时固化结构化实验方案、数据表和风险标注。
  if (currentStage === 2 && response.data_table_schema) {
    stageData.stage2 = {
      submitted: prev.stage2?.submitted ?? false,
      approved: prev.stage2?.approved ?? null,
      teacherFeedback: prev.stage2?.teacherFeedback,
      experimentPlan: response.experiment_plan ?? prev.stage2?.experimentPlan,
      // 落库前规整：key snake_case+去重、补 notes 列、minRows>=3、maxRows=200
      schema: normalizeSchema(response.data_table_schema),
      aiRiskAnnotations: response.risks ?? prev.stage2?.aiRiskAnnotations,
    };
    return { stageData };
  }

  // 阶段4：只在学生实际引用证据并完成比较时累计有效分析轮次。
  if (currentStage === 4 && response.analysis_progress) {
    const progress = response.analysis_progress;
    const previous = prev.stage4 ?? { analysisCount: 0 };
    stageData.stage4 = {
      analysisCount: previous.analysisCount + (progress.studentEvidenceAccepted ? 1 : 0),
      observations: progress.observation?.trim()
        ? [...(previous.observations ?? []), progress.observation.trim()]
        : previous.observations,
      evidenceCitations: progress.evidenceCitations?.length
        ? [...(previous.evidenceCitations ?? []), ...progress.evidenceCitations.map((item) => item.trim()).filter(Boolean)]
        : previous.evidenceCitations,
      anomalies: progress.anomalyNoted?.trim()
        ? [...(previous.anomalies ?? []), progress.anomalyNoted.trim()]
        : previous.anomalies,
      interpretations: progress.interpretation?.trim()
        ? [...(previous.interpretations ?? []), progress.interpretation.trim()]
        : previous.interpretations,
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
