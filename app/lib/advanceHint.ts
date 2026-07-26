import type { StageData } from '@/app/models/stageData';
import { canAdvance } from '@/app/lib/stageAdvance';

export interface AdvanceHint {
  to: number;
  ok: boolean;
  reason?: string;
}

/** Student-facing readiness derived from the same server gate used by /advance. */
export function advanceHint(input: {
  currentStage: number;
  stageData: StageData;
  safetyQuizCompleted?: boolean;
}): AdvanceHint {
  const to = input.currentStage + 1;
  const check = canAdvance(input.currentStage, to, input.stageData, {
    safetyQuizCompleted: input.safetyQuizCompleted,
  });
  return check.ok
    ? { to, ok: true }
    : { to, ok: false, reason: check.error };
}
