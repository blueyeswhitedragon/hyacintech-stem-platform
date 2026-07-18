import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { createTopicCardRevision, decideTopicCard, deleteTopicCard, updateTopicCard } from '@/app/lib/dataLab/bootstrap/service';
import type { TopicCardInput } from '@/app/lib/dataLab/bootstrap/contracts';

export async function PATCH(request: Request, ctx: RouteContext<'/api/data-lab/topic-cards/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const body = await request.json() as { action?: 'UPDATE' | 'APPROVE' | 'REJECT' | 'CREATE_REVISION'; card?: TopicCardInput; reason?: string };
    if (body.action === 'UPDATE' && body.card) return NextResponse.json({ card: await updateTopicCard(id, body.card, auth.user) });
    if (body.action === 'CREATE_REVISION') return NextResponse.json({ card: await createTopicCardRevision(id, auth.user) }, { status: 201 });
    if (body.action === 'APPROVE' || body.action === 'REJECT') return NextResponse.json({ card: await decideTopicCard(id, body.action, body.reason ?? '', auth.user) });
    return NextResponse.json({ error: 'action 无效' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request, ctx: RouteContext<'/api/data-lab/topic-cards/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    await deleteTopicCard(id, auth.user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
