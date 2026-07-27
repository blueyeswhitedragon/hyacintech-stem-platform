import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import {
  listModelVersions,
  registerModelVersion,
} from '@/app/lib/modelRegistry';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  return NextResponse.json({ models: await listModelVersions() });
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);

  try {
    const body = (await request.json()) as {
      tag?: string;
      provider?: string;
      externalModelId?: string;
      parentModelVersionId?: string;
      trainingRunId?: string;
      artifactKind?: string;
      modelFamily?: string;
      checkpointId?: string;
      weightsSha256?: string;
      parameterScale?: string;
      architecture?: string;
      verificationStatus?: string;
      metadata?: unknown;
      status?: string;
    };
    const model = await registerModelVersion({
      tag: body.tag ?? '',
      provider: body.provider ?? '',
      externalModelId: body.externalModelId ?? '',
      parentModelVersionId: body.parentModelVersionId,
      trainingRunId: body.trainingRunId,
      artifactKind: body.artifactKind,
      modelFamily: body.modelFamily,
      checkpointId: body.checkpointId,
      weightsSha256: body.weightsSha256,
      parameterScale: body.parameterScale,
      architecture: body.architecture,
      verificationStatus: body.verificationStatus,
      metadata: body.metadata,
      status: body.status,
      createdById: auth.user.id,
    });
    return NextResponse.json({ model }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
