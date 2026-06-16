import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { getPendingReviews } from '@/app/lib/queries';

// GET /api/teacher/review —— 教师待审核列表
export async function GET() {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const items = await getPendingReviews(auth.user.id);
  return NextResponse.json({ items });
}
