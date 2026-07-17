import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { createTopicCard, listTopicCards } from '@/app/lib/dataLab/bootstrap/service';
import type { TopicCardInput } from '@/app/lib/dataLab/bootstrap/contracts';

export async function GET(request: Request) {
  const auth = await requireAnyRole(['admin', 'annotator', 'reviewer']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const status = new URL(request.url).searchParams.get('status') ?? undefined;
  return NextResponse.json({ cards: await listTopicCards(status) });
}

export async function POST(request: Request) {
  const auth = await requireAnyRole(['admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as TopicCardInput;
    return NextResponse.json({ card: await createTopicCard(body, auth.user) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
