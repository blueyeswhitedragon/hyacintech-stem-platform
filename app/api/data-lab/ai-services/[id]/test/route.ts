import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { testProviderConnection } from '@/app/lib/dataLab/runtimeRegistry';

export async function POST(_request: Request, ctx: RouteContext<'/api/data-lab/ai-services/[id]/test'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    return NextResponse.json(await testProviderConnection(id, auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
