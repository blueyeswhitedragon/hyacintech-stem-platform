import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { compileTutorTurnCases, listTutorCases, type TutorCaseProfile, type TutorReviewPolicy } from '@/app/lib/dataLab/bootstrap/service';
import type { TutorCaseSplit } from '@/app/lib/dataLab/bootstrap/contracts';
import type { TutorLanguagePromptVersion } from '@/app/lib/tutorLanguage';

export async function GET() {
  const auth = await requireAnyRole(['admin', 'annotator', 'reviewer']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ cases: await listTutorCases() });
}

export async function POST(request: Request) {
  const auth = await requireAnyRole(['admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as { profile?: TutorCaseProfile; counts?: Record<number, number>; split?: TutorCaseSplit; topicCardIds?: string[]; promptVersion?: TutorLanguagePromptVersion; reviewPolicy?: TutorReviewPolicy };
    return NextResponse.json(await compileTutorTurnCases({ profile: body.profile ?? 'TRIAL_36', counts: body.counts, split: body.split ?? 'PILOT', topicCardIds: body.topicCardIds, promptVersion: body.promptVersion, reviewPolicy: body.reviewPolicy, user: auth.user }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
