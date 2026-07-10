import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/app/lib/db';
import { requireRole } from '@/app/lib/auth';
import { getReviewItem } from '@/app/lib/queries';
import { applyReview, type ReviewAction } from '@/app/lib/review';
import { parseMessages, parseStageData } from '@/app/lib/conversation';

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

  const prev = parseStageData(item.conversation?.stageData ?? '{}');
  const result = applyReview(body.action, body.stage, item.currentStage, prev, {
    score: body.score,
    feedback: body.feedback,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // 教师批准 2→3：向会话追加提醒消息（学生下次加载即可见），引导其到数据表面板录入数据
  let messagesUpdate: { messages: string } | undefined;
  if (body.stage === 2 && body.action === 'approve' && result.currentStage === 3) {
    const prevMessages = parseMessages(item.conversation?.messages ?? '[]');
    prevMessages.push({
      id: randomUUID(),
      role: 'assistant',
      content:
        '🎉 老师已审核通过你的实验方案！现在进入「过程执行」阶段。\n请按照方案开展实验，并把观察到的数据记录在右侧的数据表面板中（手机上数据表在聊天下方）。录入完成后点击「完成录入」即可进入数据分析阶段。实验中注意安全，有任何问题随时问我。',
      actionType: 'info',
    });
    messagesUpdate = { messages: JSON.stringify(prevMessages) };
  }

  await db.$transaction([
    db.conversation.update({
      where: { id: item.conversationId },
      data: { stageData: JSON.stringify(result.stageData), ...(messagesUpdate ?? {}) },
    }),
    db.studentAssignment.update({
      where: { id: item.id },
      data: {
        status: result.status,
        ...(result.currentStage !== undefined ? { currentStage: result.currentStage } : {}),
      },
    }),
  ]);

  return NextResponse.json({ ok: true, status: result.status, currentStage: result.currentStage });
}
