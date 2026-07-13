import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { deleteUnusedDataLabUser, updateDataLabUser } from '@/app/lib/dataLab/service';
import { isUserRole } from '@/app/lib/roles';

export async function PATCH(request: Request, ctx: RouteContext<'/api/data-lab/users/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { username?: string; displayName?: string; role?: string };
    if (!body.username || !body.displayName || !body.role || !isUserRole(body.role)) {
      return NextResponse.json({ error: '请填写用户名、显示名称和角色' }, { status: 400 });
    }
    const user = await updateDataLabUser({ targetUserId: id, username: body.username, displayName: body.displayName, role: body.role, actor: auth.user });
    return NextResponse.json({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<'/api/data-lab/users/[id]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    return NextResponse.json(await deleteUnusedDataLabUser(id, auth.user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
