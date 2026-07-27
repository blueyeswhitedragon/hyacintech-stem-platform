import { NextResponse } from 'next/server';
import { authFailureResponse, requireAnyRole } from '@/app/lib/auth';
import { myTasks } from '@/app/lib/dataLab/service';

export async function GET() {
  const auth = await requireAnyRole(['annotator', 'reviewer', 'admin']);
  if (!auth.ok) return authFailureResponse(auth);
  return NextResponse.json({ tasks: await myTasks(auth.user.id) });
}
