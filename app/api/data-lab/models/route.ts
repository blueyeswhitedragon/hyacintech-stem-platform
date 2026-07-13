import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import {
  listModelVersions,
  registerModelVersion,
} from '@/app/lib/modelRegistry';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ models: await listModelVersions() });
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as {
      tag?: string;
      provider?: string;
      externalModelId?: string;
      parentModelVersionId?: string;
      trainingRunId?: string;
      status?: string;
    };
    const model = await registerModelVersion({
      tag: body.tag ?? '',
      provider: body.provider ?? '',
      externalModelId: body.externalModelId ?? '',
      parentModelVersionId: body.parentModelVersionId,
      trainingRunId: body.trainingRunId,
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
