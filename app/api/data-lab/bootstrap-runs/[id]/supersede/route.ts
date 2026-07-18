import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { supersedeTutorCaseRun } from '@/app/lib/dataLab/bootstrap/service';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/bootstrap-runs/[id]/supersede'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const body = await request.json() as { reason?: string };
    return NextResponse.json(await supersedeTutorCaseRun(id, String(body.reason ?? ''), auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
