import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/app/lib/guestRateLimit';
import type { StageData } from '@/app/models/stageData';
import { buildDataTableSchema } from '@/app/lib/stageArtifacts';
import { deterministicRisks, deterministicSafetyQuiz } from '@/app/lib/serverTutorState';
import { finalizeStageData, stage2DraftHash } from '@/app/lib/stageState';

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}

export async function POST(req: Request) {
  const rateLimit = checkRateLimit(clientIp(req));
  if (!rateLimit.ok) return NextResponse.json({ error: 'rate_limited', message: rateLimit.error }, { status: 429 });

  let body: { stageData?: StageData; draftHash?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  const previous = body.stageData ?? {};
  const draft = previous.stage2?.planDraft;
  if (!draft || !previous.stage2?.draftHash || !body.draftHash) {
    return NextResponse.json({ error: '方案草案尚未完整生成' }, { status: 400 });
  }
  const expectedHash = stage2DraftHash(draft);
  if (body.draftHash !== expectedHash || previous.stage2.draftHash !== expectedHash) {
    return NextResponse.json({ error: '方案内容已经变化，请查看最新预览后重新确认' }, { status: 409 });
  }
  const frozen: StageData = {
    ...previous,
    stage2: {
      ...previous.stage2,
      submitted: false,
      approved: true,
      confirmedPlanHash: expectedHash,
      confirmationSource: { type: 'student_checkpoint', confirmedAt: new Date().toISOString() },
      experimentPlan: draft,
      schema: buildDataTableSchema(draft),
      aiRiskAnnotations: deterministicRisks({ ...previous, stage2: { ...previous.stage2, experimentPlan: draft } }),
      factsConfirmed: true,
    },
  };
  const quiz = deterministicSafetyQuiz(frozen);
  const next = finalizeStageData(previous, {
    ...frozen,
    stage3: {
      ...(previous.stage3 ?? { rows: [] }),
      safetyQuiz: {
        question: quiz.question,
        options: quiz.options,
        passed: false,
      },
    },
  }, {
    mutation: 'GUEST_STAGE2_CONFIRMED_AND_ADVANCED',
    serverArtifactTypes: ['experiment_plan', 'data_table_schema', 'risks', 'safety_quiz'],
  });
  return NextResponse.json({
    stageData: next,
    currentStage: 3,
    safetyQuiz: { question: quiz.question, options: quiz.options },
  });
}
