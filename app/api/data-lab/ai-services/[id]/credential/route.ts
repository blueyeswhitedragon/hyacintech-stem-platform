import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { updateProviderCredential } from '@/app/lib/dataLab/runtimeRegistry';

export async function PUT(request: Request, ctx: RouteContext<'/api/data-lab/ai-services/[id]/credential'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const { id } = await ctx.params;
    const body = await request.json() as {
      credentialSource?: string;
      envVarName?: string;
      apiKey?: string;
    };
    await updateProviderCredential({
      connectionId: id,
      credentialSource: body.credentialSource ?? 'ENV',
      envVarName: body.envVarName,
      apiKey: body.apiKey,
      user: auth.user,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
