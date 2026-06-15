import { NextResponse } from 'next/server';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';

// GET /api/conversations/[id] —— 获取归属于当前用户的会话（恢复进度）
export async function GET(_req: Request, ctx: RouteContext<'/api/conversations/[id]'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  const conv = await getConversationForUser(id, auth.user.id);
  if (!conv) {
    return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  }

  return NextResponse.json({
    messages: conv.messages,
    currentStage: conv.currentStage,
    status: conv.status,
  });
}
