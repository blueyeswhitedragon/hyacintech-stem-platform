import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { nominateProductionCandidate } from '@/app/lib/productionCandidates';

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/teacher/review/[studentAssignmentId]/candidates'>
) {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { studentAssignmentId } = await ctx.params;
  try {
    const body = (await request.json()) as {
      assistantMessageId?: string;
      triggerType?: string;
      triggerNote?: string;
    };
    if (!body.assistantMessageId) return NextResponse.json({ error: '请选择导师回复' }, { status: 400 });
    const candidate = await nominateProductionCandidate({
      studentAssignmentId,
      assistantMessageId: body.assistantMessageId,
      teacherId: auth.user.id,
      triggerType: body.triggerType ?? 'TEACHER_NOMINATION',
      triggerNote: body.triggerNote,
    });
    return NextResponse.json({ candidate }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
