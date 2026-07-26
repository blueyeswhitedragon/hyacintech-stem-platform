import type { StageData } from '@/app/models/stageData';

export const RELEASED_TRACE_BLOCK_REASON = '该阶段存在教师放行记录，不能进入正向训练候选池';

export function hasStageRelease(stageData: StageData, stage: number): boolean {
  return stageData.timeline?.releases?.some((release) => release.stage === stage) ?? false;
}

export function releasedTraceBlockReason(stageData: StageData, stage: number): string | null {
  return hasStageRelease(stageData, stage)
    ? RELEASED_TRACE_BLOCK_REASON
    : null;
}
