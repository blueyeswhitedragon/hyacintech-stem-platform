import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/app/lib/db';
import { getSession } from '@/app/lib/session';
import { isUserRole } from '@/app/lib/roles';

export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const username = body.username?.trim();
  const password = body.password ?? '';

  if (!username || !password) {
    return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { username } });
  // 用户不存在 / 密码错误 返回同样的 401，避免泄露用户名是否存在
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
  }

  const session = await getSession();
  if (!isUserRole(user.role)) {
    return NextResponse.json({ error: '账号角色无效，请联系管理员' }, { status: 403 });
  }

  session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
  };
  await session.save();

  return NextResponse.json({ user: session.user });
}
