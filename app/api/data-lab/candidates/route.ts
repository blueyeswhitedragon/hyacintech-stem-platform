import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { listProductionCandidates } from '@/app/lib/productionCandidates';

export async function GET(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const status = new URL(request.url).searchParams.get('status') || undefined;
  return NextResponse.json({ candidates: await listProductionCandidates(status) });
}
