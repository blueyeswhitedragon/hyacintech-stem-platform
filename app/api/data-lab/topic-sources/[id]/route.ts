import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { updateTopicSource } from '@/app/lib/dataLab/bootstrap/topicSources';

export async function PATCH(request: Request, ctx: RouteContext<'/api/data-lab/topic-sources/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const body = await request.json() as Parameters<typeof updateTopicSource>[1];
    return NextResponse.json({ source: await updateTopicSource(id, body, auth.user) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
