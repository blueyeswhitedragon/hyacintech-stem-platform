import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { updateDeploymentObservation } from '@/app/lib/deployment';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/deployments/[id]/observation'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const body = await request.json() as Record<string, unknown>;
    const number = (key: string) => typeof body[key] === 'number' ? body[key] as number : Number.NaN;
    const deployment = await updateDeploymentObservation({ deploymentId: id, adminId: auth.user.id, observation: {
      sessions: number('sessions'), criticalErrors: number('criticalErrors'), structureFailureRate: number('structureFailureRate'), baselineStructureFailureRate: number('baselineStructureFailureRate'), teacherRejectRate: number('teacherRejectRate'), baselineTeacherRejectRate: number('baselineTeacherRejectRate'), earlyTerminationRate: number('earlyTerminationRate'), baselineEarlyTerminationRate: number('baselineEarlyTerminationRate'),
    } });
    return NextResponse.json({ deployment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
