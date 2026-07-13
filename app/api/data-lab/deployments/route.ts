import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { createOrPromoteDeployment } from '@/app/lib/deployment';

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as { modelVersionId?: string; rolloutPercent?: number };
    if (!body.modelVersionId || ![10, 30, 100].includes(body.rolloutPercent ?? 0)) return NextResponse.json({ error: '模型和灰度比例无效' }, { status: 400 });
    const deployment = await createOrPromoteDeployment({ modelVersionId: body.modelVersionId, rolloutPercent: body.rolloutPercent as 10 | 30 | 100, adminId: auth.user.id });
    return NextResponse.json({ deployment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
