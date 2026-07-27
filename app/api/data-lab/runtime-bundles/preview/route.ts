import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { previewRuntimeBundleConsistency } from '@/app/lib/dataLab/runtimeRegistry';

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const body = await request.json() as {
      roleKey?: string;
      modelVersionId?: string;
      endpointId?: string;
      promptPolicyVersionId?: string;
    };
    return NextResponse.json(await previewRuntimeBundleConsistency({
      roleKey: body.roleKey ?? '',
      modelVersionId: body.modelVersionId ?? '',
      endpointId: body.endpointId ?? '',
      promptPolicyVersionId: body.promptPolicyVersionId ?? '',
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
