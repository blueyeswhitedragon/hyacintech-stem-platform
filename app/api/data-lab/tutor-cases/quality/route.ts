import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { listTutorCaseQualityTasks, resolveTutorCaseQualityTask } from '@/app/lib/dataLab/bootstrap/service';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ tasks: await listTutorCaseQualityTasks() });
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.taskId !== 'string') return NextResponse.json({ error: 'taskId 必填' }, { status: 400 });
    const result = await resolveTutorCaseQualityTask({
      taskId: body.taskId,
      decision: body.decision as Parameters<typeof resolveTutorCaseQualityTask>[0]['decision'],
      studentMessage: typeof body.studentMessage === 'string' ? body.studentMessage : undefined,
      visibleFacts: body.visibleFacts,
      reason: String(body.reason ?? ''),
      user: auth.user,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
