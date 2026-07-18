import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { deleteGenerationRun } from '@/app/lib/dataLab/bootstrap/service';

export async function DELETE(request: Request, ctx: RouteContext<'/api/data-lab/bootstrap-runs/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await deleteGenerationRun(id, auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
