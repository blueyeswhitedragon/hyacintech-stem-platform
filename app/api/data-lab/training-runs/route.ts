import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { createTrainingRun, listTrainingRuns } from '@/app/lib/dataLab/service';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ runs: await listTrainingRuns() });
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as {
      name?: string;
      releaseId?: string;
      baseModel?: string;
      externalTaskId?: string;
      parameters?: unknown;
      status?: string;
      modelTag?: string;
      notes?: string;
      parentModelVersionId?: string;
    };
    if (!body.name?.trim() || !body.releaseId || !body.baseModel?.trim()) return NextResponse.json({ error: 'name、releaseId、baseModel 必填' }, { status: 400 });
    const run = await createTrainingRun({ ...body, name: body.name.trim(), releaseId: body.releaseId, baseModel: body.baseModel.trim(), user: auth.user });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
