import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireRole } from '@/app/lib/auth';
import { generateUniqueInviteCode } from '@/app/lib/inviteCode';
import { getTeacherClasses } from '@/app/lib/queries';

// POST /api/classes —— 教师创建班级
export async function POST(request: Request) {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: '请填写班级名称' }, { status: 400 });
  }

  const inviteCode = await generateUniqueInviteCode(db);
  const klass = await db.class.create({
    data: { name, inviteCode, teacherId: auth.user.id },
    select: { id: true, name: true, inviteCode: true, createdAt: true },
  });

  return NextResponse.json({ class: klass }, { status: 201 });
}

// GET /api/classes —— 教师自己的班级列表
export async function GET() {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const classes = await getTeacherClasses(auth.user.id);
  return NextResponse.json({ classes });
}
