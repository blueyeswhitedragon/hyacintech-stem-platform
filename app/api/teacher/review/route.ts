import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { getPendingReviews } from '@/app/lib/queries';

// GET /api/teacher/review?page=1&pageSize=20 —— 教师待审核列表（分页）
export async function GET(req: Request) {
  const auth = await requireRole('teacher');
  if (!auth.ok) return authFailureResponse(auth);

  // 参数不合法时由 normalizePageParams 夹回默认值，不报 400：
  // 这是个只读列表，翻页参数被人手改坏时给第一页比给错误页更有用。
  const url = new URL(req.url);
  const { items, total, page, pageSize, pageCount } = await getPendingReviews(auth.user.id, {
    page: Number(url.searchParams.get('page')),
    pageSize: Number(url.searchParams.get('pageSize')),
  });

  return NextResponse.json({ items, total, page, pageSize, pageCount });
}
