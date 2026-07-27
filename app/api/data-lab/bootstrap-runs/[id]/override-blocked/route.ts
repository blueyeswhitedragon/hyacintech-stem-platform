import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { overrideBlockedCases } from '@/app/lib/dataLab/bootstrap/service';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/bootstrap-runs/[id]/override-blocked'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  const { id } = await ctx.params;
  try {
    const body = await request.json() as { reason?: string };
    return NextResponse.json(await overrideBlockedCases(id, String(body.reason ?? ''), auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
