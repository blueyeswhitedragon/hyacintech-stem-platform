import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { createModelEndpoint } from '@/app/lib/dataLab/runtimeRegistry';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/ai-services/[id]/endpoints'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const { id } = await ctx.params;
    const body = await request.json() as {
      displayName?: string;
      remoteModelId?: string;
      modelVersionId?: string;
      capabilities?: unknown;
    };
    const endpoint = await createModelEndpoint({
      connectionId: id,
      displayName: body.displayName ?? '',
      remoteModelId: body.remoteModelId ?? '',
      modelVersionId: body.modelVersionId,
      capabilities: body.capabilities,
      user: auth.user,
    });
    return NextResponse.json({ endpoint }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
