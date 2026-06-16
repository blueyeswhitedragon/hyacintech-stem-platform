import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { getStudentAssignments } from '@/app/lib/queries';

// GET /api/student/assignments —— 学生获取自己所有作业（含状态与当前阶段）
export async function GET() {
  const auth = await requireRole('student');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const assignments = await getStudentAssignments(auth.user.id);
  return NextResponse.json({ assignments });
}
