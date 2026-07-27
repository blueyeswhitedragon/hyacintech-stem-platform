import { NextResponse } from 'next/server';
import { authFailureResponse, requireAnyRole } from '@/app/lib/auth';

export async function POST() {
  const auth = await requireAnyRole(['annotator', 'reviewer', 'admin']);
  if (!auth.ok) return authFailureResponse(auth);
  return NextResponse.json({ error: '旧五风格标注流程已冻结，不能继续提交。', code: 'LEGACY_WORKFLOW_FROZEN' }, { status: 410 });
}
