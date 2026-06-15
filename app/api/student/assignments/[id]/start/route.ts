import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { ensureStudentConversation } from '@/app/lib/conversation';

// POST /api/student/assignments/[id]/start  （[id] = assignmentId）
// 学生开始/继续作业：不存在则创建 StudentAssignment + 带 welcome 种子的 Conversation，返回 conversationId。
export async function POST(
  _req: Request,
  ctx: RouteContext<'/api/student/assignments/[id]/start'>
) {
  const auth = await requireRole('student');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: assignmentId } = await ctx.params;
  const result = await ensureStudentConversation(assignmentId, auth.user.id);

  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 403;
    const message = result.error === 'not_found' ? '作业不存在' : '你不在该作业所属班级';
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({
    conversationId: result.conversationId,
    studentAssignmentId: result.studentAssignmentId,
  });
}
