import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { generateAiAssistedTutorDraft } from '@/app/lib/dataLab/bootstrap/service';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/tutor-cases/[id]/ai-draft'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const body = await request.json().catch(() => ({})) as { provider?: string; model?: string };
    return NextResponse.json(await generateAiAssistedTutorDraft({ caseId: id, provider: body.provider, model: body.model, user: auth.user }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
