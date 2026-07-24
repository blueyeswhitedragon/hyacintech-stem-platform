import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import { generateReferenceScore } from '@/app/lib/llm/scoring';
import type { StageData } from '@/app/models/stageData';
import { parseStageData } from '@/app/lib/conversation';
import { recoverStageDataV3, finalizeStageData, studentVisibleStageData } from '@/app/lib/stageState';
import { isCurrentStage5Submission, stage5SubmissionHash, limitationsDiscussion } from '@/app/lib/reportFields';
import { recordLateEvent } from '@/app/lib/deadline';

// POST /api/conversations/[id]/submit-stage5 —— 学生提交报告，进入教师审核 + 自动 AI 评分
export async function POST(_req: Request, ctx: RouteContext<'/api/conversations/[id]/submit-stage5'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;
  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });

  if (conv.currentStage !== 5) {
    return NextResponse.json({ error: '当前不在报告成型阶段' }, { status: 400 });
  }
  if (conv.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: '报告已提交或作业已完成，不能重复提交' }, { status: 409 });
  }
  const sections = conv.stageData.stage5?.sections;
  if (!sections) {
    return NextResponse.json({ error: '请先生成报告框架' }, { status: 400 });
  }
  if (!sections.conclusion.trim() || !limitationsDiscussion(sections).trim()) {
    return NextResponse.json({ error: '请先填写结论与局限讨论后再提交' }, { status: 400 });
  }

  // 先在事务内重新检查写锁，再冻结本次平台字段的哈希。
  const submitted = await db.$transaction(async (tx) => {
    const latest = await tx.studentAssignment.findUnique({
      where: { id: conv.studentAssignmentId },
      select: {
        status: true,
        currentStage: true,
        conversation: { select: { stageData: true } },
      },
    });
    if (!latest?.conversation || latest.status !== 'IN_PROGRESS' || latest.currentStage !== 5) {
      return { ok: false as const, error: '报告已提交、阶段已变化或作业已完成' };
    }
    const previous = recoverStageDataV3(parseStageData(latest.conversation.stageData)).stageData;
    const currentSections = previous.stage5?.sections;
    if (!currentSections || !currentSections.conclusion.trim() || !limitationsDiscussion(currentSections).trim()) {
      return { ok: false as const, error: '报告内容已变化，请检查结论与局限讨论后重试' };
    }
    const submissionHash = stage5SubmissionHash(currentSections);
    let next: StageData = {
      ...previous,
      stage5: {
        ...previous.stage5!,
        submitted: true,
        approved: null,
        aiReferenceScore: undefined,
        submittedSectionsHash: submissionHash,
        aiScoreSectionsHash: undefined,
      },
    };
    next = recordLateEvent(next, conv.dueDate, 'STAGE5_SUBMITTED', 5);
    next = finalizeStageData(previous, next, { mutation: 'STAGE5_SUBMITTED' });
    await tx.conversation.update({ where: { id: conversationId }, data: { stageData: JSON.stringify(next) } });
    await tx.studentAssignment.update({ where: { id: conv.studentAssignmentId }, data: { status: 'PENDING_STAGE5' } });
    return { ok: true as const, stageData: next, sections: currentSections, submissionHash };
  });
  if (!submitted.ok) return NextResponse.json({ error: submitted.error }, { status: 409 });

  // AI 只评平台八个报告字段，不读取 uploadedText。失败不阻断教师审核。
  const score = await generateReferenceScore(submitted.sections);
  if (score) {
    const scored = await db.$transaction(async (tx) => {
      const latest = await tx.studentAssignment.findUnique({
        where: { id: conv.studentAssignmentId },
        select: { status: true, currentStage: true, conversation: { select: { stageData: true } } },
      });
      if (!latest?.conversation) return { stageData: submitted.stageData, status: 'PENDING_STAGE5', currentStage: 5 };
      const previous = recoverStageDataV3(parseStageData(latest.conversation.stageData)).stageData;
      const current = previous.stage5;
      const sameSubmission = isCurrentStage5Submission(current, submitted.submissionHash);
      if (!sameSubmission) return { stageData: previous, status: latest.status, currentStage: latest.currentStage };
      const next = finalizeStageData(previous, {
        ...previous,
        stage5: {
          ...current,
          aiReferenceScore: score,
          aiScoreSectionsHash: submitted.submissionHash,
        },
      }, { mutation: 'STAGE5_AI_SCORE_RECORDED' });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { stageData: JSON.stringify(next) },
      });
      return { stageData: next, status: latest.status, currentStage: latest.currentStage };
    });
    return NextResponse.json({ ...scored, stageData: studentVisibleStageData(scored.stageData) });
  }

  const latest = await getConversationForUser(conversationId, auth.user.id);
  return NextResponse.json({
    stageData: studentVisibleStageData(latest?.stageData ?? submitted.stageData),
    status: latest?.status ?? 'PENDING_STAGE5',
    currentStage: latest?.currentStage ?? 5,
  });
}
