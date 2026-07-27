import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { updateProviderConnection } from '@/app/lib/dataLab/runtimeRegistry';

export async function PATCH(request: Request, ctx: RouteContext<'/api/data-lab/ai-services/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const { id } = await ctx.params;
    const body = await request.json() as {
      name?: string;
      baseUrl?: string;
      capabilities?: unknown;
      action?: 'DISABLE' | 'ENABLE' | 'DELETE';
    };
    const connection = await updateProviderConnection({ id, ...body, user: auth.user });
    return NextResponse.json({ connection });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<'/api/data-lab/ai-services/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const { id } = await ctx.params;
    await updateProviderConnection({ id, action: 'DELETE', user: auth.user });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
