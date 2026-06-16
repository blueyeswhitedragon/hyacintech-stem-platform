import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireRole } from '@/app/lib/auth';

// POST /api/classes/[id]/join —— 学生用邀请码加入班级
// 注：以邀请码为准；路由中的 [id] 仅作占位，不强制与邀请码对应的班级一致。
export async function POST(request: Request) {
  const auth = await requireRole('student');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { inviteCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const inviteCode = body.inviteCode?.trim().toUpperCase();
  if (!inviteCode) {
    return NextResponse.json({ error: '请输入邀请码' }, { status: 400 });
  }

  const klass = await db.class.findUnique({
    where: { inviteCode },
    select: { id: true, name: true },
  });
  if (!klass) {
    return NextResponse.json({ error: '邀请码无效' }, { status: 404 });
  }

  const existing = await db.classMember.findUnique({
    where: { classId_studentId: { classId: klass.id, studentId: auth.user.id } },
  });
  if (existing) {
    return NextResponse.json({ error: '你已加入该班级' }, { status: 409 });
  }

  await db.classMember.create({
    data: { classId: klass.id, studentId: auth.user.id },
  });

  return NextResponse.json({ class: klass }, { status: 201 });
}
