import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { setStudentDataConsent } from '@/app/lib/productionCandidates';

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/student/assignments/[id]/data-consent'>
) {
  const auth = await requireRole('student');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  try {
    const body = (await request.json()) as { decision?: 'GRANT' | 'DECLINE' | 'WITHDRAW' };
    if (!body.decision || !['GRANT', 'DECLINE', 'WITHDRAW'].includes(body.decision)) {
      return NextResponse.json({ error: '授权决定无效' }, { status: 400 });
    }
    const result = await setStudentDataConsent({
      studentAssignmentId: id,
      studentId: auth.user.id,
      decision: body.decision,
    });
    return NextResponse.json({ status: result.dataConsentStatus });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
