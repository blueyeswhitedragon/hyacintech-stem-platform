import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { importDatasetBatch } from '@/app/lib/dataLab/service';
import { MAX_IMPORT_BYTES } from '@/app/lib/dataLab/validation';

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const form = await request.formData();
  const file = form.get('dataset');
  const manifestFile = form.get('manifest');
  const name = String(form.get('name') ?? '').trim();
  const sourceType = String(form.get('sourceType') ?? 'sharegpt_clean').trim();
  if (!name) return NextResponse.json({ error: '请填写批次名称' }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: '请选择数据集 JSON 文件' }, { status: 400 });
  if (file.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: '数据集文件不能超过 10 MB' }, { status: 413 });
  try {
    const raw = await file.text();
    let manifest: unknown;
    if (manifestFile instanceof File && manifestFile.size > 0) manifest = JSON.parse(await manifestFile.text());
    const result = await importDatasetBatch({ name, sourceType, sourceFileName: file.name, raw, manifest, user: auth.user });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
