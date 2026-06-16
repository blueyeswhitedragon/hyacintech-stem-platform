import type { StageData } from '@/app/models/stageData';

export interface AdvanceCheck {
  ok: boolean;
  error?: string;
}

/**
 * 纯函数：判断学生能否从 from 阶段推进到 to 阶段（带数据 gating）。
 * 仅处理由「学生点按钮」驱动的推进：3→4、4→5。
 * 1→2、2→3 由 chat 的 phase_complete/advanceTo 驱动，不走这里。
 */
export function canAdvance(from: number, to: number, stageData: StageData): AdvanceCheck {
  if (to !== from + 1) {
    return { ok: false, error: '只能逐阶段推进' };
  }

  if (from === 3 && to === 4) {
    const rows = stageData.stage3?.rows ?? [];
    if (rows.length === 0) {
      return { ok: false, error: '请先录入至少一行实验数据' };
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
    return { ok: true };
  }

  return { ok: false, error: '该阶段的推进不通过此操作' };
}
