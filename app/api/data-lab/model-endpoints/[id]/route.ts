import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { linkModelEndpoint } from '@/app/lib/dataLab/runtimeRegistry';

export async function PATCH(request: Request, ctx: RouteContext<'/api/data-lab/model-endpoints/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { modelVersionId?: string };
    const endpoint = await linkModelEndpoint({
      endpointId: id,
      modelVersionId: body.modelVersionId ?? '',
      user: auth.user,
    });
    return NextResponse.json({ endpoint });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
