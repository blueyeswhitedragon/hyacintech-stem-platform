import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import type { StageData } from '@/app/models/stageData';
import { parseStageData } from '@/app/lib/conversation';
import { recoverStageDataV3, finalizeStageData, studentVisibleStageData } from '@/app/lib/stageState';
import { recordLateEvent } from '@/app/lib/deadline';

// POST /api/conversations/[id]/stage6-respond —— 学生提交反思，完成探究（COMPLETED）
export async function POST(req: Request, ctx: RouteContext<'/api/conversations/[id]/stage6-respond'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;

  let body: { response?: string; responseToTeacherFeedback?: string; learningReflection?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  const legacyResponse = body.response?.trim();
  const responseToTeacherFeedback = body.responseToTeacherFeedback?.trim() || legacyResponse;
  const learningReflection = body.learningReflection?.trim() || legacyResponse;
  if (!responseToTeacherFeedback || !learningReflection) {
    return NextResponse.json({ error: '请分别填写对教师评价的回应和学习反思' }, { status: 400 });
  }

  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  if (conv.currentStage !== 6) {
    return NextResponse.json({ error: '当前不在结果反思阶段' }, { status: 400 });
  }
  if (conv.status === 'COMPLETED' || conv.stageData.stage6?.finalReadonly) {
    return NextResponse.json({ error: '探究已完成，不能再次提交' }, { status: 400 });
  }
  if (conv.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: '作业当前不可提交' }, { status: 409 });
  }
  const score = conv.stageData.stage5?.teacherScore;
  if (conv.stageData.stage5?.approved !== true || !Number.isFinite(score) || score! < 0 || score! > 10) {
    return NextResponse.json({ error: '报告尚未完成有效的教师评分与审核' }, { status: 409 });
  }

  const completed = await db.$transaction(async (tx) => {
    const latest = await tx.studentAssignment.findUnique({
      where: { id: conv.studentAssignmentId },
      select: { status: true, currentStage: true, conversation: { select: { stageData: true } } },
    });
    if (!latest?.conversation || latest.status !== 'IN_PROGRESS' || latest.currentStage !== 6) {
      return { ok: false as const };
    }
    const previous = recoverStageDataV3(parseStageData(latest.conversation.stageData)).stageData;
    const latestScore = previous.stage5?.teacherScore;
    if (previous.stage6?.finalReadonly || previous.stage5?.approved !== true
      || !Number.isFinite(latestScore) || latestScore! < 0 || latestScore! > 10) {
      return { ok: false as const };
    }
    const studentResponse = [
      `回应教师评价：${responseToTeacherFeedback}`,
      `学习反思：${learningReflection}`,
    ].join('\n\n');
    let next: StageData = {
      ...previous,
      stage6: {
        studentResponse,
        responseToTeacherFeedback,
        learningReflection,
        finalReadonly: true,
      },
    };
    next = recordLateEvent(next, conv.dueDate, 'FINAL_SUBMITTED', 6);
    next = finalizeStageData(previous, next, { mutation: 'FINAL_SUBMITTED' });
    await tx.conversation.update({ where: { id: conversationId }, data: { stageData: JSON.stringify(next) } });
    await tx.studentAssignment.update({ where: { id: conv.studentAssignmentId }, data: { status: 'COMPLETED' } });
    return { ok: true as const, stageData: next };
  });
  if (!completed.ok) {
    return NextResponse.json({ error: '作业状态已变化，请刷新后重试' }, { status: 409 });
  }

  return NextResponse.json({ stageData: studentVisibleStageData(completed.stageData), status: 'COMPLETED' });
}
