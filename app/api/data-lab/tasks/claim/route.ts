import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { claimAnnotationTaskWithStatus } from '@/app/lib/dataLab/service';

export async function POST() {
  const auth = await requireAnyRole(['annotator', 'reviewer', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await claimAnnotationTaskWithStatus(auth.user));
}
