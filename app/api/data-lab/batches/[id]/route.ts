import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { batchDetail } from '@/app/lib/dataLab/service';

export async function GET(_request: Request, ctx: RouteContext<'/api/data-lab/batches/[id]'>) {
  const auth = await requireAnyRole(['annotator', 'reviewer', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  const batch = await batchDetail(id);
  if (!batch) return NextResponse.json({ error: '批次不存在' }, { status: 404 });
  return NextResponse.json({ batch });
}
