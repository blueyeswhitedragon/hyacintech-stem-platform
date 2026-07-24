import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import { deterministicSafetyQuiz } from '@/app/lib/serverTutorState';
import { finalizeStageData, studentVisibleStageData } from '@/app/lib/stageState';

// POST /api/conversations/[id]/safety-quiz —— 服务端核验安全问答
// body: { answer: number }。不能信任客户端直接声明 passed。
export async function POST(req: Request, ctx: RouteContext<'/api/conversations/[id]/safety-quiz'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;

  let body: { answer?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  if (!Number.isInteger(body.answer)) {
    return NextResponse.json({ error: 'answer 必须为选项序号' }, { status: 400 });
  }

  // 归属校验
  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) {
    return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  }
  if (conv.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: '当前作业已提交或完成，不能修改' }, { status: 409 });
  }
  if (conv.currentStage !== 3) {
    return NextResponse.json({ error: '当前不在过程执行阶段' }, { status: 400 });
  }
  const quiz = conv.stageData.stage3?.safetyQuiz;
  if (!quiz) {
    return NextResponse.json({ error: '尚未生成可核验的安全问答' }, { status: 400 });
  }
  const deterministic = deterministicSafetyQuiz(conv.stageData);
  const expectedAnswer = Number.isInteger(quiz.correct) ? quiz.correct : deterministic.correct;
  if (body.answer !== expectedAnswer) {
    return NextResponse.json({ error: '回答不正确，请重新选择' }, { status: 400 });
  }

  const next = {
    ...conv.stageData,
    stage3: {
      ...(conv.stageData.stage3 ?? { rows: [] }),
      safetyQuiz: {
        question: quiz.question,
        options: quiz.options,
        selected: body.answer,
        passed: true,
      },
    },
  };
  const stageData = finalizeStageData(conv.stageData, next, { mutation: 'STAGE3_SAFETY_PASSED' });

  await db.conversation.update({
    where: { id: conversationId },
    data: { safetyQuizCompleted: true, stageData: JSON.stringify(stageData) },
  });

  return NextResponse.json({ ok: true, stageData: studentVisibleStageData(stageData) });
}
