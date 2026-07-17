import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { generateTutorCandidates } from '@/app/lib/dataLab/bootstrap/service';
import type { CandidateModelConfig } from '@/app/lib/dataLab/bootstrap/contracts';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/tutor-cases/[id]/candidates'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const body = await request.json() as { modelA?: CandidateModelConfig; modelB?: CandidateModelConfig };
    if (!body.modelA || !body.modelB) return NextResponse.json({ error: 'modelA 和 modelB 必填' }, { status: 400 });
    const result = await generateTutorCandidates({ caseId: id, modelA: body.modelA, modelB: body.modelB, user: auth.user });
    return NextResponse.json(result, { status: result.status === 'COMPLETED' ? 201 : 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
