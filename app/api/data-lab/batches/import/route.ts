import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
export async function POST() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ error: '旧 DatasetBatch 导入已冻结。新中间工作结构使用 TopicCard 与 TutorTurnCase；ShareGPT 仅用于最终训练导出。' }, { status: 410 });
}
