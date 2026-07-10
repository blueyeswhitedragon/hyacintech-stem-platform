import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { decideReview } from '@/app/lib/dataLab/service';
import type { RevisionInput } from '@/app/lib/dataLab/types';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/reviews/[id]/decide'>) {
  const auth = await requireAnyRole(['reviewer', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as {
      action: 'SELECT' | 'MERGE' | 'RETURN' | 'REJECT';
      selectedRevisionId?: string;
      mergedInput?: RevisionInput;
      finalTier: 'human_gold' | 'reviewed_silver' | 'reject';
      rubric?: Record<string, number>;
      reason?: string;
    };
    const decision = await decideReview({ ...body, reviewCaseId: id, reason: body.reason ?? '', user: auth.user });
    return NextResponse.json({ decision });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
