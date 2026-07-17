import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { approveTrialExpansion, trialQualityReport } from '@/app/lib/dataLab/bootstrap/service';

export async function GET(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const runId = new URL(request.url).searchParams.get('runId') ?? undefined;
  return NextResponse.json(await trialQualityReport(runId));
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as { note?: string; runId?: string };
    return NextResponse.json({ run: await approveTrialExpansion(body.note ?? '', auth.user, body.runId) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
