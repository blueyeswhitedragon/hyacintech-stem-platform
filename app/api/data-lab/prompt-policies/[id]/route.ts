import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import {
  createPromptPolicyRevision,
  updatePromptPolicyStatus,
} from '@/app/lib/dataLab/runtimeRegistry';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/prompt-policies/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const { id } = await ctx.params;
    const body = await request.json() as {
      action?: 'SUBMIT' | 'APPROVE' | 'SET_DEFAULT' | 'DISABLE' | 'CREATE_REVISION';
      version?: string;
      displayName?: string;
    };
    if (body.action === 'CREATE_REVISION') {
      const policy = await createPromptPolicyRevision({
        sourceId: id,
        version: body.version ?? '',
        displayName: body.displayName,
        user: auth.user,
      });
      return NextResponse.json({ policy }, { status: 201 });
    }
    if (!body.action) throw new Error('缺少策略操作');
    const policy = await updatePromptPolicyStatus({
      id,
      action: body.action,
      user: auth.user,
    });
    return NextResponse.json({ policy });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
