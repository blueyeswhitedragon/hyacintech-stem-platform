import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/app/lib/guestRateLimit';
import type { StageData } from '@/app/models/stageData';
import { deterministicSafetyQuiz } from '@/app/lib/serverTutorState';
import { finalizeStageData } from '@/app/lib/stageState';

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}

export async function POST(req: Request) {
  const rateLimit = checkRateLimit(clientIp(req));
  if (!rateLimit.ok) return NextResponse.json({ error: 'rate_limited', message: rateLimit.error }, { status: 429 });

  let body: { stageData?: StageData; answer?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  const previous = body.stageData ?? {};
  const stage2 = previous.stage2;
  if (!stage2?.experimentPlan || stage2.confirmedPlanHash !== stage2.draftHash) {
    return NextResponse.json({ error: '请先确认当前实验方案' }, { status: 409 });
  }
  const quiz = deterministicSafetyQuiz(previous);
  const answered = body.answer !== undefined;
  if (answered && (!Number.isInteger(body.answer) || body.answer !== quiz.correct)) {
    return NextResponse.json({ error: '答案不正确，请重新检查安全要求' }, { status: 400 });
  }
  const next = finalizeStageData(previous, {
    ...previous,
    stage3: {
      ...(previous.stage3 ?? { rows: [] }),
      safetyQuiz: {
        question: quiz.question,
        options: quiz.options,
        selected: answered ? body.answer : undefined,
        passed: answered,
      },
    },
  }, { mutation: answered ? 'GUEST_SAFETY_QUIZ_PASSED' : 'GUEST_SAFETY_QUIZ_CREATED', serverArtifactTypes: ['safety_quiz'] });
  return NextResponse.json({
    stageData: next,
    safetyQuiz: { question: quiz.question, options: quiz.options },
  });
}
