import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { backfillRejectedTutorCases } from '@/app/lib/dataLab/bootstrap/service';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/bootstrap-runs/[id]/backfill'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await backfillRejectedTutorCases(id, auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
