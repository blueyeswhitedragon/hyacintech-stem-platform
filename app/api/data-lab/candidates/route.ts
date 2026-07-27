import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { listProductionCandidates } from '@/app/lib/productionCandidates';

export async function GET(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  const status = new URL(request.url).searchParams.get('status') || undefined;
  return NextResponse.json({ candidates: await listProductionCandidates(status) });
}
