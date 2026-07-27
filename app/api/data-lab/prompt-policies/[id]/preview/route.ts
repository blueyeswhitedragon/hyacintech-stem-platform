import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { previewPromptPolicy } from '@/app/lib/dataLab/runtimeRegistry';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/prompt-policies/[id]/preview'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const { id } = await ctx.params;
    const body = await request.json() as {
      phase?: number;
      triggerType?: string;
      visibleFacts?: unknown;
      allowedFocusIds?: string[];
      focusDescriptions?: Record<string, string>;
    };
    return NextResponse.json(await previewPromptPolicy({
      id,
      phase: Number(body.phase ?? 1),
      triggerType: body.triggerType ?? 'USER_MESSAGE',
      visibleFacts: body.visibleFacts ?? {},
      allowedFocusIds: body.allowedFocusIds ?? ['research_question'],
      focusDescriptions: body.focusDescriptions,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
