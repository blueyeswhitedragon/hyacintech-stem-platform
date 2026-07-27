import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { rollbackDeployment, rollbackRuntimeDeployment } from '@/app/lib/deployment';
import { db } from '@/app/lib/db';

export async function POST(_request: Request, ctx: RouteContext<'/api/data-lab/deployments/[id]/rollback'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  const { id } = await ctx.params;
  try {
    const current = await db.modelDeployment.findUnique({ where: { id }, select: { runtimeBundleId: true } });
    return NextResponse.json({
      deployment: current?.runtimeBundleId
        ? await rollbackRuntimeDeployment({ deploymentId: id, adminId: auth.user.id })
        : await rollbackDeployment({ deploymentId: id, adminId: auth.user.id }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
