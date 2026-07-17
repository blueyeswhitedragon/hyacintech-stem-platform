import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { retryTutorCandidateCritics } from '@/app/lib/dataLab/bootstrap/service';

export async function POST(_request: Request, ctx: RouteContext<'/api/data-lab/tutor-cases/[id]/retry-critics'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const result = await retryTutorCandidateCritics({ caseId: id, user: auth.user });
    return NextResponse.json(result, { status: result.status === 'COMPLETED' ? 201 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message.includes('必须重新生成') ? 409 : 400 });
  }
}
