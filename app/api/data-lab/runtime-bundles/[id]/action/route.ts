import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import {
  checkRuntimeBundle,
  runRuntimeCompatibility,
  testRuntimeBundle,
  updateRuntimeBundleStatus,
} from '@/app/lib/dataLab/runtimeRegistry';
import { refreshRuntimeBundleDeploymentGate } from '@/app/lib/deployment';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/runtime-bundles/[id]/action'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as {
      action?: 'CHECK' | 'TEST' | 'EVALUATE_COMPATIBILITY' | 'DEPLOYMENT_GATE' | 'MARK_AVAILABLE' | 'DISABLE';
    };
    if (body.action === 'CHECK') return NextResponse.json(await checkRuntimeBundle(id));
    if (body.action === 'TEST') return NextResponse.json(await testRuntimeBundle(id, auth.user));
    if (body.action === 'EVALUATE_COMPATIBILITY') return NextResponse.json(await runRuntimeCompatibility(id, auth.user));
    if (body.action === 'DEPLOYMENT_GATE') return NextResponse.json(await refreshRuntimeBundleDeploymentGate(id));
    if (body.action === 'MARK_AVAILABLE' || body.action === 'DISABLE') {
      const bundle = await updateRuntimeBundleStatus({ id, action: body.action, user: auth.user });
      return NextResponse.json({ bundle });
    }
    throw new Error('未知运行组合操作');
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
