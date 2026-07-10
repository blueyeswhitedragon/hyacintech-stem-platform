import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { saveTaskDraft } from '@/app/lib/dataLab/service';
import type { RevisionInput } from '@/app/lib/dataLab/types';

export async function PATCH(request: Request, ctx: RouteContext<'/api/data-lab/tasks/[id]/draft'>) {
  const auth = await requireAnyRole(['annotator', 'reviewer', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as RevisionInput;
    await saveTaskDraft(id, body, auth.user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
