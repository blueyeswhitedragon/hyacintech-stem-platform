import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import { canAdvance } from '@/app/lib/stageAdvance';

// POST /api/conversations/[id]/advance —— 学生点按钮推进阶段（带 gating）
// body: { to: number }
export async function POST(req: Request, ctx: RouteContext<'/api/conversations/[id]/advance'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;

  let body: { to?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  if (typeof body.to !== 'number') {
    return NextResponse.json({ error: '缺少目标阶段 to' }, { status: 400 });
  }

  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) {
    return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  }

  const check = canAdvance(conv.currentStage, body.to, conv.stageData);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  // 3→4：标记数据表已就绪，进入教师「数据表待过目（可选）」清单（非阻塞）
  let stageData = conv.stageData;
  if (conv.currentStage === 3 && body.to === 4 && conv.stageData.stage3) {
    stageData = {
      ...conv.stageData,
      stage3: { ...conv.stageData.stage3, submitted: true, approved: conv.stageData.stage3.approved ?? null },
    };
  }

  await db.$transaction([
    db.studentAssignment.update({
      where: { id: conv.studentAssignmentId },
      data: { currentStage: body.to },
    }),
    ...(stageData !== conv.stageData
      ? [db.conversation.update({ where: { id: conversationId }, data: { stageData: JSON.stringify(stageData) } })]
      : []),
  ]);

  return NextResponse.json({ currentStage: body.to, stageData });
}
