import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { setDataLabUserActive } from '@/app/lib/dataLab/service';

export async function POST(request: Request, ctx: RouteContext<'/api/data-lab/users/[id]/status'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { isActive?: boolean; reason?: string };
    if (typeof body.isActive !== 'boolean') return NextResponse.json({ error: '账户状态无效' }, { status: 400 });
    return NextResponse.json(await setDataLabUserActive({ targetUserId: id, isActive: body.isActive, reason: body.reason, actor: auth.user }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
