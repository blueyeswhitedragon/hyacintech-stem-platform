import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { createOfflineEvaluation } from '@/app/lib/dataLab/service';

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const body = await request.json() as {
      name?: string;
      runtimeBundleAId?: string;
      runtimeBundleBId?: string;
    };
    if (!body.name || !body.runtimeBundleAId || !body.runtimeBundleBId) {
      return NextResponse.json({ error: '评测名称、基线运行组合和候选运行组合必填' }, { status: 400 });
    }
    const run = await createOfflineEvaluation({
      name: body.name,
      runtimeBundleAId: body.runtimeBundleAId,
      runtimeBundleBId: body.runtimeBundleBId,
      user: auth.user,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
