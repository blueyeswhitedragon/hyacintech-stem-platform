import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireRole } from '@/app/lib/auth';
import { createDataLabUser, listDataLabUsers } from '@/app/lib/dataLab/service';
import type { UserRole } from '@/app/lib/roles';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ users: await listDataLabUsers() });
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as { username?: string; password?: string; displayName?: string; role?: UserRole };
    const username = body.username?.trim();
    const displayName = body.displayName?.trim();
    if (!username || username.length < 3 || !displayName || (body.password?.length ?? 0) < 8 || !body.role) {
      return NextResponse.json({ error: '用户名至少3字符、密码至少8字符，并填写名称和角色' }, { status: 400 });
    }
    const user = await createDataLabUser({ username, displayName, role: body.role, passwordHash: await bcrypt.hash(body.password!, 10), actor: auth.user });
    return NextResponse.json({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
