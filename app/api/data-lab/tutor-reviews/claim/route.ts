import { NextResponse } from 'next/server';
import { authFailureResponse, requireAnyRole } from '@/app/lib/auth';
import { claimTutorReviewTask } from '@/app/lib/dataLab/bootstrap/service';

export async function POST(request: Request) {
  const auth = await requireAnyRole(['admin', 'annotator', 'reviewer']);
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const body = await request.json() as { type?: 'EDIT' | 'CONFIRM' };
    if (!body.type) return NextResponse.json({ error: 'type 必填' }, { status: 400 });
    const payload = await claimTutorReviewTask(body.type, auth.user);
    return NextResponse.json({ payload });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
