import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
export async function POST() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ error: '旧标注活动不再允许启动；历史读取、导出和审计仍可用。' }, { status: 410 });
}
