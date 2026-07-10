import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { updateUserRole } from '@/app/lib/dataLab/service';
import { isUserRole } from '@/app/lib/roles';

export async function PATCH(request: Request, ctx: RouteContext<'/api/data-lab/users/[id]/role'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { role?: string };
    if (!body.role || !isUserRole(body.role)) return NextResponse.json({ error: '角色无效' }, { status: 400 });
    const user = await updateUserRole(id, body.role, auth.user);
    return NextResponse.json({ user: { id: user.id, role: user.role } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
