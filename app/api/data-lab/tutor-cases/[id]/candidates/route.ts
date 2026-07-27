import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { generateTutorCandidates } from '@/app/lib/dataLab/bootstrap/service';
import type { CandidateModelSelection } from '@/app/lib/dataLab/bootstrap/contracts';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/tutor-cases/[id]/candidates'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  const { id } = await ctx.params;
  try {
    const body = await request.json() as { modelA?: CandidateModelSelection; modelB?: CandidateModelSelection };
    const result = await generateTutorCandidates({ caseId: id, modelA: body.modelA, modelB: body.modelB, user: auth.user });
    return NextResponse.json(result, { status: result.status === 'COMPLETED' ? 201 : 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
