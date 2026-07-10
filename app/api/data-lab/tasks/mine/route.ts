import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { myTasks } from '@/app/lib/dataLab/service';

export async function GET() {
  const auth = await requireAnyRole(['annotator', 'reviewer', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ tasks: await myTasks(auth.user.id) });
}
