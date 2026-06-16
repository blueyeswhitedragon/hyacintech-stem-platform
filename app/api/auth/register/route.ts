import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/app/lib/db';
import { getSession, type UserRole } from '@/app/lib/session';

export async function POST(request: Request) {
  let body: { username?: string; password?: string; role?: string; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const username = body.username?.trim();
  const password = body.password ?? '';
  const role = body.role as UserRole | undefined;
  const displayName = body.displayName?.trim();

  // 手动校验（沿用项目现有风格，不引入 zod）
  if (!username || username.length < 3) {
    return NextResponse.json({ error: '用户名至少 3 个字符' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: '密码至少 6 个字符' }, { status: 400 });
  }
  if (role !== 'student' && role !== 'teacher') {
    return NextResponse.json({ error: '角色必须为 student 或 teacher' }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: '请填写显示名称' }, { status: 400 });
  }

  // 查重
  const existing = await db.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: '用户名已被占用' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.user.create({
    data: { username, passwordHash, role, displayName },
  });

  // 注册成功即登录
  const session = await getSession();
  session.user = { id: user.id, username: user.username, role, displayName: user.displayName };
  await session.save();

  return NextResponse.json({ user: session.user }, { status: 201 });
}
