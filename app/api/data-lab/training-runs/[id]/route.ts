import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { updateTrainingRunStatus } from '@/app/lib/dataLab/service';

export async function PATCH(request: Request, ctx: RouteContext<'/api/data-lab/training-runs/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { status?: string; externalTaskId?: string; notes?: string };
    const allowed = ['DRAFT', 'SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
    if (!body.status || !allowed.includes(body.status as (typeof allowed)[number])) {
      return NextResponse.json({ error: '训练状态无效' }, { status: 400 });
    }
    const run = await updateTrainingRunStatus({
      id,
      status: body.status as (typeof allowed)[number],
      externalTaskId: body.externalTaskId,
      notes: body.notes,
      user: auth.user,
    });
    return NextResponse.json({ run });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
