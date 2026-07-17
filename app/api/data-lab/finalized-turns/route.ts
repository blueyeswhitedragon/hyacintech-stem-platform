import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { listFinalizedTutorTurns } from '@/app/lib/dataLab/bootstrap/service';

export async function GET() {
  const auth = await requireAnyRole(['admin', 'reviewer']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ turns: await listFinalizedTutorTurns() });
}
