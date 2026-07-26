import type { StageData, AssignmentStatus } from '@/app/models/stageData';
import { composeReportSections, TEACHER_RELEASE_SCHEMA } from '@/app/lib/stageArtifacts';

export type ReviewAction = 'approve' | 'reject' | 'release';
export type ReviewStage = 2 | 3 | 5;
export type ReleaseStage = 2 | 3 | 4 | 5;

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
  reason?: string;
  teacherId?: string;
  occurredAt?: string;
}

function appendRelease(
  stageData: StageData,
  release: NonNullable<NonNullable<StageData['timeline']>['releases']>[number],
): StageData {
  const previous = stageData.timeline?.releases ?? [];
  const exists = previous.some((item) => (
    item.stage === release.stage
    && item.fromStage === release.fromStage
    && item.toStage === release.toStage
    && item.teacherId === release.teacherId
    && item.reason === release.reason
  ));
  if (exists) return stageData;
  return {
    ...stageData,
    timeline: {
      ...stageData.timeline,
      lateEvents: stageData.timeline?.lateEvents ?? [],
      releases: [...previous, release],
    },
  };
}

/** Audited bypass for a student who cannot satisfy the normal stage gate. */
export function applyRelease(
  stage: ReleaseStage,
  fromStage: number,
  prev: StageData,
  opts: ReviewOpts = {},
): ReviewResult {
  const reason = opts.reason?.trim() ?? '';
  if (reason.length < 10) {
    return { ok: false, error: '放行理由至少需要 10 个字', stageData: prev, status: 'IN_PROGRESS' };
  }
  if (!opts.teacherId) {
    return { ok: false, error: '放行必须记录教师身份', stageData: prev, status: 'IN_PROGRESS' };
  }
  if (fromStage !== stage) {
    return { ok: false, error: '只能放行学生当前所在阶段', stageData: prev, status: 'IN_PROGRESS' };
  }

  let stageData: StageData = { ...prev };
  if (stage === 2) {
    const previousStage2 = prev.stage2;
    const needsReleaseSchema = !previousStage2 || previousStage2.schema.columns.length === 0;
    stageData.stage2 = {
      ...(previousStage2 ?? {
        submitted: false,
        approved: null,
        schema: { columns: [], minRows: 3, maxRows: 200 },
      }),
      approved: true,
      teacherFeedback: opts.feedback ?? reason,
      ...(needsReleaseSchema ? {
        schema: {
          columns: TEACHER_RELEASE_SCHEMA.columns.map((column) => ({ ...column })),
          minRows: TEACHER_RELEASE_SCHEMA.minRows,
          maxRows: TEACHER_RELEASE_SCHEMA.maxRows,
          provenance: 'teacher_release' as const,
        },
        planProvenance: {
          ...previousStage2?.planProvenance,
          dataRecording: { source: 'teacher_release' as const, sourceFields: [] },
        },
      } : {}),
    };
  } else if (stage === 3) {
    stageData.stage3 = {
      ...(prev.stage3 ?? { rows: [] }),
      approved: true,
      teacherFeedback: opts.feedback ?? reason,
    };
  } else if (stage === 4 && !prev.stage5?.sections) {
    const sections = composeReportSections({ stageData });
    if (!sections) {
      return { ok: false, error: '无法生成报告框架', stageData: prev, status: 'IN_PROGRESS' };
    }
    stageData.stage5 = {
      submitted: false,
      approved: null,
      sections: {
        ...sections,
        conclusion: '',
        limitationsDiscussion: '',
        reflection: '',
      },
    };
  } else if (stage === 5) {
    if (!prev.stage5) {
      return { ok: false, error: '该报告尚不存在', stageData: prev, status: 'IN_PROGRESS' };
    }
    if (opts.score === undefined || !Number.isFinite(opts.score) || opts.score < 0 || opts.score > 10) {
      return { ok: false, error: '第五阶段放行必须记录 0–10 分的实际评分', stageData: prev, status: 'IN_PROGRESS' };
    }
    stageData.stage5 = {
      ...prev.stage5,
      approved: true,
      teacherScore: opts.score,
      teacherFeedback: opts.feedback ?? reason,
    };
  }

  stageData = appendRelease(stageData, {
    stage,
    fromStage,
    toStage: fromStage + 1,
    teacherId: opts.teacherId,
    reason,
    occurredAt: opts.occurredAt ?? new Date().toISOString(),
  });
  return { ok: true, stageData, currentStage: fromStage + 1, status: 'IN_PROGRESS' };
}

/**
 * 纯函数：教师对阶段2/3/5 的常规审核动作 → 新的 stageData / currentStage / status。
 * 无副作用、不读 DB —— 便于单测。调用方负责落库。
 *
 * 第三阶段为「可选 / 非阻塞」：
 *  - approve：仅背书（approved=true），不改阶段（学生本就已自助推进）。
 *  - reject：只记录反馈，不回滚阶段、不清空学生数据或分析。
 */
export function applyReview(
  action: Exclude<ReviewAction, 'release'>,
  stage: ReviewStage,
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
    if (fromStage >= 5) {
      return {
        ok: false,
        error: '学生已进入报告阶段，请改用报告（第五阶段）审核处理',
        stageData: prev,
        status: 'IN_PROGRESS',
      };
    }
    // reject：非阻塞反馈，不改变当前阶段或既有分析。
    stageData.stage3 = {
      ...prev.stage3,
      approved: false,
      teacherFeedback: opts.feedback,
    };
    return { ok: true, stageData, status: 'IN_PROGRESS' };
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
  if (opts.score !== undefined && (!Number.isFinite(opts.score) || opts.score < 0 || opts.score > 10)) {
    return { ok: false, error: '教师评分必须是 0–10 的有效数字', stageData: prev, status: 'PENDING_STAGE5' };
  }
  if (action === 'approve') {
    if (opts.score === undefined) {
      return { ok: false, error: '通过报告前必须填写 0–10 分的教师评分', stageData: prev, status: 'PENDING_STAGE5' };
    }
    // 教师评分低于 6 分 → 需要学生重写报告，重新提交
    if (opts.score < 6) {
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
