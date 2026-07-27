import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import {
  createRuntimeBundle,
  listRuntimeRolesAndBundles,
} from '@/app/lib/dataLab/runtimeRegistry';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  return NextResponse.json(await listRuntimeRolesAndBundles());
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const body = await request.json() as {
      name?: string;
      roleKey?: string;
      modelVersionId?: string;
      endpointId?: string;
      promptPolicyVersionId?: string;
      generationParams?: unknown;
    };
    const result = await createRuntimeBundle({
      name: body.name ?? '',
      roleKey: body.roleKey ?? '',
      modelVersionId: body.modelVersionId ?? '',
      endpointId: body.endpointId ?? '',
      promptPolicyVersionId: body.promptPolicyVersionId ?? '',
      generationParams: body.generationParams,
      user: auth.user,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
