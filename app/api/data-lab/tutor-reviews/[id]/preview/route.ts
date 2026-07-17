import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { previewTutorConfirmFinal } from '@/app/lib/dataLab/bootstrap/service';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/tutor-reviews/[id]/preview'>) {
  const auth = await requireAnyRole(['reviewer', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const body = await request.json() as { finalOutput?: string };
    if (typeof body.finalOutput !== 'string') return NextResponse.json({ error: 'finalOutput 必填' }, { status: 400 });
    return NextResponse.json(await previewTutorConfirmFinal({ taskId: id, finalOutput: body.finalOutput, user: auth.user }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
