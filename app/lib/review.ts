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
 * 纯函数：教师对阶段2/3/5 的审核动作 → 新的 stageData / currentStage / status。
 * 无副作用、不读 DB —— 便于单测。调用方负责落库。
 *
 * 第三阶段为「可选 / 非阻塞 / 有界回滚」：
 *  - approve：仅背书（approved=true），不改阶段（学生本就已自助推进）。
 *  - reject：按学生当前阶段 fromStage 有界回滚——
 *      fromStage===3 → 留 3 写反馈；
 *      fromStage===4 → 回退到 3，并清零 stage4.analysisCount（旧分析失效）；
 *      fromStage>=5  → 拒绝打回（交由第五阶段审核处理）。
 */
export function applyReview(
  action: ReviewAction,
  stage: 2 | 3 | 5,
  fromStage: number,
  prev: StageData,
  opts: ReviewOpts = {}
): ReviewResult {
  const stageData: StageData = { ...prev };

  if (stage === 3) {
    if (!prev.stage3) {
      return { ok: false, error: '该数据表尚未提交', stageData: prev, status: 'IN_PROGRESS' };
    }
    if (action === 'approve') {
      // 背书：不改阶段（currentStage 不返回 → 调用方不更新）
      stageData.stage3 = {
        ...prev.stage3,
        approved: true,
        teacherFeedback: opts.feedback,
      };
      return { ok: true, stageData, status: 'IN_PROGRESS' };
    }
    // reject：有界回滚
    if (fromStage >= 5) {
      return {
        ok: false,
        error: '学生已进入报告阶段，请改用报告（第五阶段）审核处理',
        stageData: prev,
        status: 'IN_PROGRESS',
      };
    }
    stageData.stage3 = {
      ...prev.stage3,
      approved: false,
      submitted: false,
      teacherFeedback: opts.feedback,
    };
    if (fromStage === 4) {
      // 回退到第三阶段：旧分析基于旧表已失效，清零分析轮次
      stageData.stage4 = { analysisCount: 0 };
    }
    return { ok: true, stageData, currentStage: 3, status: 'IN_PROGRESS' };
  }

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
    // 教师评分低于 6 分 → 需要学生重写报告，重新提交
    if (opts.score !== undefined && opts.score < 6) {
      stageData.stage5 = {
        ...prev.stage5,
        approved: false,
        submitted: false,
        teacherScore: opts.score,
        teacherFeedback: (opts.feedback || '') + '\n\n⚠️ 教师评分低于6分，请根据反馈修改报告后重新提交。',
      };
      return { ok: true, stageData, currentStage: fromStage, status: 'IN_PROGRESS' };
    }
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
