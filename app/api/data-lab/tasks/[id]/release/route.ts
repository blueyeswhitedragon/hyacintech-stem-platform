import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { releaseExpiredAnnotationTask } from '@/app/lib/dataLab/service';

export async function POST(_request: Request, ctx: RouteContext<'/api/data-lab/tasks/[id]/release'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    return NextResponse.json(await releaseExpiredAnnotationTask(id, auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
