import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { setRuntimeRoleDefault } from '@/app/lib/dataLab/runtimeRegistry';

export async function PUT(request: Request, ctx: RouteContext<'/api/data-lab/runtime-roles/[roleKey]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { roleKey } = await ctx.params;
    const body = await request.json() as { bundleId?: string };
    const role = await setRuntimeRoleDefault({
      roleKey,
      bundleId: body.bundleId ?? '',
      user: auth.user,
    });
    return NextResponse.json({ role });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
