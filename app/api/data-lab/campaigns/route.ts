import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { listCampaigns } from '@/app/lib/dataLab/service';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ campaigns: await listCampaigns() });
}

export async function POST() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ error: '旧标注活动已冻结。请使用 TopicCard → TutorTurnCase → 首次审核 → 最终确认工作流。' }, { status: 410 });
}
