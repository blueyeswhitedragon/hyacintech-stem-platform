import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { importTopicSources, listTopicSources, type TopicSourceImportInput } from '@/app/lib/dataLab/bootstrap/topicSources';

export async function GET(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  const params = new URL(request.url).searchParams;
  return NextResponse.json({ sources: await listTopicSources({ status: params.get('status') ?? undefined, familyKey: params.get('familyKey') ?? undefined, search: params.get('search') ?? undefined }) });
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const body = await request.json() as { sources?: TopicSourceImportInput[] };
    return NextResponse.json(await importTopicSources(body.sources ?? [], auth.user), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
