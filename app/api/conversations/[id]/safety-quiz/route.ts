import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';

// POST /api/conversations/[id]/safety-quiz —— 标记安全问答已通过
// body: { passed: true }。答对与否由前端依 safety_quiz.correct 判定（教育 MVP）。
export async function POST(req: Request, ctx: RouteContext<'/api/conversations/[id]/safety-quiz'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;

  let body: { passed?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  if (body.passed !== true) {
    return NextResponse.json({ error: 'passed 必须为 true' }, { status: 400 });
  }

  // 归属校验
  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) {
    return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  }

  await db.conversation.update({
    where: { id: conversationId },
    data: { safetyQuizCompleted: true },
  });

  return NextResponse.json({ ok: true });
}
