import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { submitAnnotationTask } from '@/app/lib/dataLab/service';
import type { RevisionInput } from '@/app/lib/dataLab/types';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/tasks/[id]/submit'>) {
  const auth = await requireAnyRole(['annotator', 'reviewer', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as RevisionInput;
    return NextResponse.json(await submitAnnotationTask(id, body, auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
