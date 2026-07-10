import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { importEvaluation } from '@/app/lib/dataLab/service';
import { MAX_IMPORT_BYTES } from '@/app/lib/dataLab/validation';

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const form = await request.formData();
  const name = String(form.get('name') ?? '').trim();
  const files = form.getAll('artifacts').filter((item): item is File => item instanceof File);
  if (!name) return NextResponse.json({ error: '请填写评测名称' }, { status: 400 });
  if (files.length === 0) return NextResponse.json({ error: '请选择 transcript 或 verdict JSON' }, { status: 400 });
  if (files.some((file) => file.size > MAX_IMPORT_BYTES)) return NextResponse.json({ error: '单个文件不能超过 10 MB' }, { status: 413 });
  try {
    const run = await importEvaluation({
      name,
      files: await Promise.all(files.map(async (file) => ({ fileName: file.name, raw: await file.text() }))),
      user: auth.user,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
