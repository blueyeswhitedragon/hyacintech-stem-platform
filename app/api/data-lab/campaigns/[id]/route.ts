import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { archiveCampaign, deleteDraftCampaign } from '@/app/lib/dataLab/service';

export async function PATCH(request: Request, ctx: RouteContext<'/api/data-lab/campaigns/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { action?: string; reason?: string };
    if (body.action !== 'archive') return NextResponse.json({ error: '不支持的活动操作' }, { status: 400 });
    return NextResponse.json({ summary: await archiveCampaign(id, body.reason ?? '', auth.user) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<'/api/data-lab/campaigns/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    return NextResponse.json(await deleteDraftCampaign(id, auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
