import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { importBuiltInTopicSources } from '@/app/lib/dataLab/bootstrap/topicSources';

export async function POST() {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    return NextResponse.json(await importBuiltInTopicSources(auth.user), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
