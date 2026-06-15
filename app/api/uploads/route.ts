import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { requireRole } from '@/app/lib/auth';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// POST /api/uploads —— 学生上传实验图片（≤5MB、仅图片），存 public/uploads/
export async function POST(request: Request) {
  const auth = await requireRole('student');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: '请求格式错误（需 multipart/form-data）' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少文件字段 file' }, { status: 400 });
  }

  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json({ error: '仅支持 PNG/JPG/WebP/GIF 图片' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '文件超过 5MB 限制' }, { status: 400 });
  }

  const filename = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const dest = path.join(process.cwd(), 'public', 'uploads', filename);
  await writeFile(dest, buffer);

  return NextResponse.json({ url: `/uploads/${filename}` }, { status: 201 });
}
