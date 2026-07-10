import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/app/lib/auth';
import { claimReviewCase } from '@/app/lib/dataLab/service';

export async function POST() {
  const auth = await requireAnyRole(['reviewer', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ reviewCase: await claimReviewCase(auth.user) });
}
