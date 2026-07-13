import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { reviewAnnotationWork } from '@/app/lib/dataLab/service';
import { WORK_REVIEW_STATUSES, type WorkReviewStatus } from '@/app/lib/dataLab/types';

export async function PATCH(request: Request, ctx: RouteContext<'/api/data-lab/work-reviews/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { status?: WorkReviewStatus; note?: string };
    if (!body.status || body.status === 'PENDING' || !WORK_REVIEW_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: '无效的工作量审核状态' }, { status: 400 });
    }
    return NextResponse.json(await reviewAnnotationWork({ reviewId: id, status: body.status, note: body.note, user: auth.user }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
