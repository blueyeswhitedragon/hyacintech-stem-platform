import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/app/lib/db';
import { requireRole } from '@/app/lib/auth';
import { getReviewItem } from '@/app/lib/queries';
import { applyReview, type ReviewAction } from '@/app/lib/review';
import { parseMessages, parseStageData } from '@/app/lib/conversation';
import { deterministicSafetyQuiz } from '@/app/lib/serverTutorState';
import { finalizeStageData } from '@/app/lib/stageState';

// GET /api/teacher/review/[studentAssignmentId] —— 审核详情
export async function GET(_req: Request, ctx: RouteContext<'/api/teacher/review/[studentAssignmentId]'>) {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { studentAssignmentId } = await ctx.params;
  const item = await getReviewItem(studentAssignmentId);
  if (!item) return NextResponse.json({ error: '不存在' }, { status: 404 });
  if (item.assignment.class.teacherId !== auth.user.id) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  return NextResponse.json({
    id: item.id,
    status: item.status,
    currentStage: item.currentStage,
    student: item.student,
    assignment: { title: item.assignment.title, topicDirection: item.assignment.topicDirection, className: item.assignment.class.name },
    messages: parseMessages(item.conversation?.messages ?? '[]'),
    stageData: parseStageData(item.conversation?.stageData ?? '{}'),
  });
}

// POST /api/teacher/review/[studentAssignmentId] —— 审核操作 approve/reject
export async function POST(req: Request, ctx: RouteContext<'/api/teacher/review/[studentAssignmentId]'>) {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { studentAssignmentId } = await ctx.params;

  let body: { action?: ReviewAction; stage?: number; score?: number; feedback?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action 必须为 approve 或 reject' }, { status: 400 });
  }
  if (body.stage !== 2 && body.stage !== 3 && body.stage !== 5) {
    return NextResponse.json({ error: 'stage 必须为 2、3 或 5' }, { status: 400 });
  }
  if (body.stage === 5 && body.score !== undefined
    && (typeof body.score !== 'number' || !Number.isFinite(body.score) || body.score < 0 || body.score > 10)) {
    return NextResponse.json({ error: '评分必须是 0–10 的有效数字' }, { status: 400 });
  }
  if (body.stage === 5 && body.action === 'approve' && body.score === undefined) {
    return NextResponse.json({ error: '通过报告前必须填写 0–10 分的教师评分' }, { status: 400 });
  }

  const item = await getReviewItem(studentAssignmentId);
  if (!item || !item.conversationId) return NextResponse.json({ error: '不存在' }, { status: 404 });
  if (item.assignment.class.teacherId !== auth.user.id) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  if (body.stage === 3) {
    // 第三阶段为非阻塞审核：不校验 PENDING 状态，改为有界窗口校验（学生未越过第四阶段）
    if (item.currentStage > 4) {
      return NextResponse.json({ error: '学生已进入报告阶段，请改用报告（第五阶段）审核处理' }, { status: 400 });
    }
  } else {
    // 状态须与待审阶段一致
    const expectedStatus = body.stage === 2 ? 'PENDING_STAGE2' : 'PENDING_STAGE5';
    if (item.status !== expectedStatus) {
      return NextResponse.json({ error: '该作业当前不在此审核阶段' }, { status: 400 });
    }
  }

  const persisted = await db.$transaction(async (tx) => {
    const latest = await tx.studentAssignment.findUnique({
      where: { id: item.id },
      select: {
        status: true,
        currentStage: true,
        conversation: { select: { stageData: true, messages: true } },
      },
    });
    if (!latest?.conversation) return { ok: false as const, error: '审核对象已不存在' };
    if (body.stage === 3) {
      if (latest.currentStage > 4) return { ok: false as const, error: '学生已进入报告阶段，请改用第五阶段审核' };
    } else {
      const expectedStatus = body.stage === 2 ? 'PENDING_STAGE2' : 'PENDING_STAGE5';
      if (latest.status !== expectedStatus) return { ok: false as const, error: '作业审核状态已经变化，请刷新后重试' };
    }

    const previous = parseStageData(latest.conversation.stageData);
    const result = applyReview(body.action!, body.stage as 2 | 3 | 5, latest.currentStage, previous, {
      score: body.score,
      feedback: body.feedback,
    });
    if (!result.ok) return { ok: false as const, error: result.error ?? '审核失败' };

    if (body.stage === 2 && body.action === 'approve' && result.currentStage === 3) {
      const quiz = deterministicSafetyQuiz(result.stageData);
      result.stageData.stage3 = {
        ...(result.stageData.stage3 ?? { rows: [] }),
        safetyQuiz: { question: quiz.question, options: quiz.options, passed: false },
      };
    }
    result.stageData = finalizeStageData(previous, result.stageData, {
      mutation: `TEACHER_STAGE${body.stage}_${body.action!.toUpperCase()}`,
      serverArtifactTypes: body.stage === 2 && body.action === 'approve' ? ['safety_quiz'] : undefined,
    });

    let messages: string | undefined;
    if (body.stage === 2 && body.action === 'approve' && result.currentStage === 3) {
      const previousMessages = parseMessages(latest.conversation.messages);
      previousMessages.push({
        id: randomUUID(),
        role: 'assistant',
        content: '老师已审核通过你的实验方案。现在进入「过程执行」阶段。请先完成安全问答，再按照冻结方案把真实观察记录到数据表中。',
        actionType: 'info',
      });
      messages = JSON.stringify(previousMessages);
    }
    await tx.conversation.update({
      where: { id: item.conversationId! },
      data: {
        stageData: JSON.stringify(result.stageData),
        ...(body.stage === 2 && body.action === 'approve' ? { safetyQuizCompleted: false } : {}),
        ...(messages ? { messages } : {}),
      },
    });
    await tx.studentAssignment.update({
      where: { id: item.id },
      data: {
        status: result.status,
        ...(result.currentStage !== undefined ? { currentStage: result.currentStage } : {}),
      },
    });
    return { ok: true as const, result };
  });

  if (!persisted.ok) return NextResponse.json({ error: persisted.error }, { status: 409 });
  return NextResponse.json({ ok: true, status: persisted.result.status, currentStage: persisted.result.currentStage });
}
