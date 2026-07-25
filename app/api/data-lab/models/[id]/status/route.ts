import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { disableModelVersion } from '@/app/lib/modelRegistry';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/models/[id]/status'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { action?: string };
    if (body.action !== 'DISABLE') return NextResponse.json({ error: '未知模型状态操作' }, { status: 400 });
    return NextResponse.json({ model: await disableModelVersion({ id, actorId: auth.user.id }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
