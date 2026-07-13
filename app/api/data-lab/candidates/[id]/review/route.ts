import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { reviewProductionCandidate } from '@/app/lib/productionCandidates';

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/data-lab/candidates/[id]/review'>
) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const body = (await request.json()) as { action?: 'APPROVE' | 'REJECT'; reason?: string };
    if (!body.action || !['APPROVE', 'REJECT'].includes(body.action)) return NextResponse.json({ error: '审核动作无效' }, { status: 400 });
    const candidate = await reviewProductionCandidate({ id, action: body.action, reason: body.reason, adminId: auth.user.id });
    return NextResponse.json({ candidate });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
