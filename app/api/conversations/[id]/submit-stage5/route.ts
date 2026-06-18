import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import { generateReferenceScore } from '@/app/lib/llm/scoring';
import type { StageData } from '@/app/models/stageData';

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
  const sections = conv.stageData.stage5?.sections;
  if (!sections) {
    return NextResponse.json({ error: '请先生成报告框架' }, { status: 400 });
  }
  if (!sections.conclusion.trim() || !sections.reflection.trim()) {
    return NextResponse.json({ error: '请先填写结论与反思后再提交' }, { status: 400 });
  }

  // 1) 先标记提交 + 待审，落库
  let stageData: StageData = {
    ...conv.stageData,
    stage5: { ...conv.stageData.stage5!, submitted: true, approved: null },
  };
  await db.$transaction([
    db.conversation.update({ where: { id: conversationId }, data: { stageData: JSON.stringify(stageData) } }),
    db.studentAssignment.update({ where: { id: conv.studentAssignmentId }, data: { status: 'PENDING_STAGE5' } }),
  ]);

  // 2) AI 参考评分（失败不阻断）
  const score = await generateReferenceScore(sections);
  if (score) {
    stageData = { ...stageData, stage5: { ...stageData.stage5!, aiReferenceScore: score } };
    await db.conversation.update({
      where: { id: conversationId },
      data: { stageData: JSON.stringify(stageData) },
    });
  }

  return NextResponse.json({ stageData, status: 'PENDING_STAGE5' });
}
