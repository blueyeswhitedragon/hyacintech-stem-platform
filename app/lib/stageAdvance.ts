import type { StageData } from '@/app/models/stageData';

export interface AdvanceCheck {
  ok: boolean;
  error?: string;
}

/**
 * 纯函数：判断学生能否从 from 阶段推进到 to 阶段（带数据 gating）。
 * 处理由「学生点按钮」驱动的推进：1→2、3→4、4→5。
 * 2→3 由教师审核驱动，不走这里。
 */
export function canAdvance(
  from: number,
  to: number,
  stageData: StageData,
  context: { safetyQuizCompleted?: boolean } = {},
): AdvanceCheck {
  if (to !== from + 1) {
    return { ok: false, error: '只能逐阶段推进' };
  }

  if (from === 1 && to === 2) {
    if (!stageData.stage1?.confirmed) {
      return { ok: false, error: '请先确认探究问题' };
    }
    const factor = stageData.stage1.factorDirection?.trim() || stageData.stage1.variables?.independent?.trim();
    const phenomenon = stageData.stage1.phenomenonDirection?.trim() || stageData.stage1.themeMapping?.researchQuestion?.trim();
    if (!factor || !phenomenon) {
      return { ok: false, error: '请先明确拟改变因素和关注现象方向' };
    }
    return { ok: true };
  }

  if (from === 3 && to === 4) {
    if (context.safetyQuizCompleted !== true && stageData.stage3?.safetyQuiz?.passed !== true) {
      return { ok: false, error: '请先完成并通过本实验的安全问答' };
    }
    const rows = stageData.stage3?.rows ?? [];
    const minRows = stageData.stage2?.schema?.minRows ?? 1;
    if (rows.length < minRows) {
      return { ok: false, error: `请先录入至少 ${minRows} 行实验数据` };
    }
    const requiredKeys = (stageData.stage2?.schema?.columns ?? [])
      .filter((c) => c.required)
      .map((c) => c.key);
    for (const row of rows) {
      for (const key of requiredKeys) {
        const v = row[key];
        if (v === undefined || v === null || String(v).trim() === '') {
          return { ok: false, error: `有必填列「${key}」未填写完整` };
        }
      }
    }
    return { ok: true };
  }

  if (from === 4 && to === 5) {
    const count = stageData.stage4?.analysisCount ?? 0;
    if (count < 2) {
      return { ok: false, error: '请先与AI导师进行至少两轮数据分析讨论，再进入报告成型阶段' };
    }
    return { ok: true };
  }

  return { ok: false, error: '该阶段的推进不通过此操作' };
}
