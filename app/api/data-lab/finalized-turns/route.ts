import { NextResponse } from 'next/server';
import { authFailureResponse, requireAnyRole } from '@/app/lib/auth';
import { listFinalizedTutorTurns } from '@/app/lib/dataLab/bootstrap/service';

export async function GET() {
  const auth = await requireAnyRole(['admin', 'reviewer']);
  if (!auth.ok) return authFailureResponse(auth);
  return NextResponse.json({ turns: await listFinalizedTutorTurns() });
}
