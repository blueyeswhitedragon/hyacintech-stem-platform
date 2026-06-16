import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireRole } from '@/app/lib/auth';
import { getClassDetail } from '@/app/lib/queries';

// GET /api/classes/[id] —— 班级详情（仅所属教师）
export async function GET(_req: Request, ctx: RouteContext<'/api/classes/[id]'>) {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  const detail = await getClassDetail(id);
  if (!detail) {
    return NextResponse.json({ error: '班级不存在' }, { status: 404 });
  }
  if (detail.teacherId !== auth.user.id) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  return NextResponse.json({ class: detail });
}

// DELETE /api/classes/[id] —— 解散班级（事务级联删除依赖数据）
export async function DELETE(_req: Request, ctx: RouteContext<'/api/classes/[id]'>) {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  const klass = await db.class.findUnique({
    where: { id },
    select: { id: true, teacherId: true },
  });
  if (!klass) {
    return NextResponse.json({ error: '班级不存在' }, { status: 404 });
  }
  if (klass.teacherId !== auth.user.id) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  // 收集依赖：作业 -> 学生作业（连带 conversationId）
  const assignments = await db.assignment.findMany({
    where: { classId: id },
    select: {
      id: true,
      studentAssignments: { select: { id: true, conversationId: true } },
    },
  });
  const assignmentIds = assignments.map((a) => a.id);
  const studentAssignmentIds = assignments.flatMap((a) =>
    a.studentAssignments.map((sa) => sa.id)
  );
  const conversationIds = assignments
    .flatMap((a) => a.studentAssignments.map((sa) => sa.conversationId))
    .filter((c): c is string => !!c);

  // 按外键依赖顺序删除（StudentAssignment.conversationId 指向 Conversation，
  // 故先删 StudentAssignment 再删 Conversation）
  await db.$transaction([
    db.studentAssignment.deleteMany({ where: { id: { in: studentAssignmentIds } } }),
    db.conversation.deleteMany({ where: { id: { in: conversationIds } } }),
    db.assignment.deleteMany({ where: { id: { in: assignmentIds } } }),
    db.classMember.deleteMany({ where: { classId: id } }),
    db.class.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
