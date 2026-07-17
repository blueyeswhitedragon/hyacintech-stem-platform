import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { compileTopicCardsWithModels } from '@/app/lib/dataLab/bootstrap/service';
import type { CandidateModelConfig } from '@/app/lib/dataLab/bootstrap/contracts';
import { sourcePackagesForCompilation } from '@/app/lib/dataLab/bootstrap/topicSources';

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as { sources?: Array<Record<string, unknown>>; sourceCandidateIds?: string[]; modelA?: CandidateModelConfig; modelB?: CandidateModelConfig; internalArchetype?: string };
    if (!body.modelA || !body.modelB) return NextResponse.json({ error: 'modelA、modelB 必填' }, { status: 400 });
    const sources = body.sourceCandidateIds?.length ? await sourcePackagesForCompilation(body.sourceCandidateIds) : body.sources ?? [];
    if (!sources.length) return NextResponse.json({ error: 'sources 或 sourceCandidateIds 必填' }, { status: 400 });
    if (!body.sourceCandidateIds?.length) {
      for (const source of sources) {
        if (source.authorizationStatus !== 'CONFIRMED') return NextResponse.json({ error: `直接提交的资源“${String(source.title ?? '未命名')}”必须明确 authorizationStatus=CONFIRMED` }, { status: 400 });
        if (typeof source.summary !== 'string' || source.summary.trim().length < 20) return NextResponse.json({ error: `直接提交的资源“${String(source.title ?? '未命名')}”摘要不足 20 字` }, { status: 400 });
      }
    }
    return NextResponse.json(await compileTopicCardsWithModels({ sources, modelA: body.modelA, modelB: body.modelB, internalArchetype: body.internalArchetype, user: auth.user }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
