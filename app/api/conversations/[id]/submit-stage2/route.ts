import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import type { StageData } from '@/app/models/stageData';

// POST /api/conversations/[id]/submit-stage2 —— 学生提交方案，进入教师审核
export async function POST(_req: Request, ctx: RouteContext<'/api/conversations/[id]/submit-stage2'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;
  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });

  if (conv.currentStage !== 2) {
    return NextResponse.json({ error: '当前不在方案设计阶段' }, { status: 400 });
  }
  if (!conv.stageData.stage2?.schema) {
    return NextResponse.json({ error: '请先与 AI 确定方案并生成数据表结构' }, { status: 400 });
  }

  const stageData: StageData = {
    ...conv.stageData,
    stage2: { ...conv.stageData.stage2, submitted: true, approved: null },
  };

  await db.$transaction([
    db.conversation.update({ where: { id: conversationId }, data: { stageData: JSON.stringify(stageData) } }),
    db.studentAssignment.update({ where: { id: conv.studentAssignmentId }, data: { status: 'PENDING_STAGE2' } }),
  ]);

  return NextResponse.json({ stageData, status: 'PENDING_STAGE2' });
}
