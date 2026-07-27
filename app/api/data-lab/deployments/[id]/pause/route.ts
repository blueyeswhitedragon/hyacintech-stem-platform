import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { setDeploymentPromotionPaused } from '@/app/lib/deployment';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/deployments/[id]/pause'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { paused?: boolean };
    if (typeof body.paused !== 'boolean') return NextResponse.json({ error: 'paused 必须是布尔值' }, { status: 400 });
    const deployment = await setDeploymentPromotionPaused({ deploymentId: id, paused: body.paused, adminId: auth.user.id });
    return NextResponse.json({ deployment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
