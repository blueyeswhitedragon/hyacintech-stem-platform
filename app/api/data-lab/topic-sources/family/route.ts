import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { setTopicSourceFamily } from '@/app/lib/dataLab/bootstrap/topicSources';

export async function PATCH(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const body = await request.json() as { ids?: string[]; familyKey?: string };
    return NextResponse.json(await setTopicSourceFamily(body.ids ?? [], body.familyKey ?? '', auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
