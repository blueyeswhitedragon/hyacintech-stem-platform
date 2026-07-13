import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { resetDataLabUserPassword } from '@/app/lib/dataLab/service';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/users/[id]/password'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { password?: string };
    if (!body.password || body.password.length < 8 || body.password.length > 128) {
      return NextResponse.json({ error: '新密码需为 8-128 个字符' }, { status: 400 });
    }
    return NextResponse.json(await resetDataLabUserPassword({ targetUserId: id, passwordHash: await bcrypt.hash(body.password, 10), actor: auth.user }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
