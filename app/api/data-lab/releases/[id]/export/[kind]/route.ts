import { readFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { releaseForDownload } from '@/app/lib/dataLab/service';

export async function GET(_request: Request, ctx: RouteContext<'/api/data-lab/releases/[id]/export/[kind]'>) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id, kind } = await ctx.params;
    if (!['clean', 'gold', 'silver', 'training', 'preference', 'manifest'].includes(kind)) return NextResponse.json({ error: '导出类型无效' }, { status: 400 });
    const file = await releaseForDownload(id, kind as 'clean' | 'gold' | 'silver' | 'training' | 'preference' | 'manifest');
    const content = await readFile(file.filePath);
    return new Response(content, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}
