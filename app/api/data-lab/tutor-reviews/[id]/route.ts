import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { renewTutorReviewLease, submitConfirmReview, submitEditReview } from '@/app/lib/dataLab/bootstrap/service';

export async function PATCH(_request: Request, ctx: RouteContext<'/api/data-lab/tutor-reviews/[id]'>) {
  const auth = await requireAnyRole(['admin', 'annotator', 'reviewer']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await renewTutorReviewLease(id, auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/tutor-reviews/[id]'>) {
  const auth = await requireAnyRole(['admin', 'annotator', 'reviewer']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.type === 'EDIT') {
      const result = await submitEditReview({
        taskId: id,
        decision: body.decision as Parameters<typeof submitEditReview>[0]['decision'],
        selectedCandidateId: typeof body.selectedCandidateId === 'string' ? body.selectedCandidateId : undefined,
        finalOutput: typeof body.finalOutput === 'string' ? body.finalOutput : undefined,
        reason: String(body.reason ?? ''),
        preferenceRejectedCandidateId: typeof body.preferenceRejectedCandidateId === 'string' ? body.preferenceRejectedCandidateId : undefined,
        preferenceReason: typeof body.preferenceReason === 'string' ? body.preferenceReason : undefined,
        submissionMode: typeof body.submissionMode === 'string' ? body.submissionMode as Parameters<typeof submitEditReview>[0]['submissionMode'] : undefined,
        caseIssue: body.caseIssue,
        user: auth.user,
      });
      return NextResponse.json(result);
    }
    if (body.type === 'CONFIRM') {
      const result = await submitConfirmReview({
        taskId: id,
        decision: body.decision as Parameters<typeof submitConfirmReview>[0]['decision'],
        reason: String(body.reason ?? ''),
        warningClosures: body.warningClosures,
        finalOutput: typeof body.finalOutput === 'string' ? body.finalOutput : undefined,
        caseIssue: body.caseIssue,
        user: auth.user,
      });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: 'type 无效' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
