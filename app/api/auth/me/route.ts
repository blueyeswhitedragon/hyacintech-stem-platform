import { NextResponse } from 'next/server';
import { authFailureResponse, requireUser } from '@/app/lib/auth';

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return authFailureResponse(auth);
  return NextResponse.json({ user: auth.user });
}
