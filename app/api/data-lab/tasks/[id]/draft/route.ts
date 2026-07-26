import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';

export async function PATCH() {
  const auth = await requireAnyRole(['annotator', 'reviewer', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ error: '旧五风格标注流程已冻结，不能继续保存草稿。', code: 'LEGACY_WORKFLOW_FROZEN' }, { status: 410 });
}
