import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import type { StageData } from '@/app/models/stageData';

// POST /api/conversations/[id]/stage6-respond —— 学生提交反思，完成探究（COMPLETED）
export async function POST(req: Request, ctx: RouteContext<'/api/conversations/[id]/stage6-respond'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;

  let body: { response?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  const response = body.response?.trim();
  if (!response) {
    return NextResponse.json({ error: '请填写你的反思' }, { status: 400 });
  }

  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  if (conv.currentStage !== 6) {
    return NextResponse.json({ error: '当前不在结果反思阶段' }, { status: 400 });
  }
  if (conv.status === 'COMPLETED' || conv.stageData.stage6?.finalReadonly) {
    return NextResponse.json({ error: '探究已完成，不能再次提交' }, { status: 400 });
  }

  const stageData: StageData = {
    ...conv.stageData,
    stage6: { studentResponse: response, finalReadonly: true },
  };

  await db.$transaction([
    db.conversation.update({ where: { id: conversationId }, data: { stageData: JSON.stringify(stageData) } }),
    db.studentAssignment.update({ where: { id: conv.studentAssignmentId }, data: { status: 'COMPLETED' } }),
  ]);

  return NextResponse.json({ stageData, status: 'COMPLETED' });
}
