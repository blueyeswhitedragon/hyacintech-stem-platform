import type { StageData, AssignmentStatus } from '@/app/models/stageData';

export type ReviewAction = 'approve' | 'reject';

export interface ReviewResult {
  ok: boolean;
  error?: string;
  stageData: StageData;
  currentStage?: number; // 仅在需要改阶段时给出
  status: AssignmentStatus;
}

export interface ReviewOpts {
  score?: number;
  feedback?: string;
}

/**
 * 纯函数：教师对阶段2/5 的审核动作 → 新的 stageData / currentStage / status。
 * 无副作用、不读 DB —— 便于单测。调用方负责落库。
 */
export function applyReview(
  action: ReviewAction,
  stage: 2 | 5,
  fromStage: number,
  prev: StageData,
  opts: ReviewOpts = {}
): ReviewResult {
  const stageData: StageData = { ...prev };

  if (stage === 2) {
    if (!prev.stage2) {
      return { ok: false, error: '该方案尚未提交', stageData: prev, status: 'PENDING_STAGE2' };
    }
    if (action === 'approve') {
      stageData.stage2 = { ...prev.stage2, approved: true, teacherFeedback: opts.feedback };
      return { ok: true, stageData, currentStage: 3, status: 'IN_PROGRESS' };
    }
    // reject：保留数据，回到进行中，允许重提
    stageData.stage2 = {
      ...prev.stage2,
      approved: false,
      submitted: false,
      teacherFeedback: opts.feedback,
    };
    return { ok: true, stageData, currentStage: fromStage, status: 'IN_PROGRESS' };
  }

  // stage === 5
  if (!prev.stage5) {
    return { ok: false, error: '该报告尚未提交', stageData: prev, status: 'PENDING_STAGE5' };
  }
  if (action === 'approve') {
    stageData.stage5 = {
      ...prev.stage5,
      approved: true,
      teacherScore: opts.score,
      teacherFeedback: opts.feedback,
    };
    return { ok: true, stageData, currentStage: 6, status: 'IN_PROGRESS' };
  }
  stageData.stage5 = {
    ...prev.stage5,
    approved: false,
    submitted: false,
    teacherFeedback: opts.feedback,
  };
  return { ok: true, stageData, currentStage: fromStage, status: 'IN_PROGRESS' };
}
