import { NextResponse } from 'next/server';
import { authFailureResponse, requireAnyRole } from '@/app/lib/auth';
import { claimReviewCase } from '@/app/lib/dataLab/service';

export async function POST() {
  const auth = await requireAnyRole(['reviewer', 'admin']);
  if (!auth.ok) return authFailureResponse(auth);
  return NextResponse.json({ reviewCase: await claimReviewCase(auth.user) });
}
