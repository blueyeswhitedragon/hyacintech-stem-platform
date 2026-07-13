import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { convertProductionCandidates } from '@/app/lib/productionCandidates';

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as { ids?: string[]; batchName?: string };
    const result = await convertProductionCandidates({ ids: body.ids ?? [], batchName: body.batchName ?? '', adminId: auth.user.id });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
