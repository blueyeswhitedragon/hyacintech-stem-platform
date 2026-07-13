import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { rollbackDeployment } from '@/app/lib/deployment';

export async function POST(_request: Request, ctx: RouteContext<'/api/data-lab/deployments/[id]/rollback'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ deployment: await rollbackDeployment({ deploymentId: id, adminId: auth.user.id }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
