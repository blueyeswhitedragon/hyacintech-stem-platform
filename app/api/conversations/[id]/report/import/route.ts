import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { db } from '@/app/lib/db';
import { requireRole } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import { extractDocxText } from '@/app/lib/docxExtract';
import type { StageData } from '@/app/models/stageData';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// POST /api/conversations/[id]/report/import —— 学生上传自己的 Word 报告（轻量：留存 + 文本提取，不覆盖 AI 框架）
export async function POST(request: Request, ctx: RouteContext<'/api/conversations/[id]/report/import'>) {
  const auth = await requireRole('student');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;
  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });

  if (conv.currentStage !== 5) {
    return NextResponse.json({ error: '仅在报告成型阶段可上传报告' }, { status: 400 });
  }
  if (!conv.stageData.stage5?.sections) {
    return NextResponse.json({ error: '请先等待报告框架生成' }, { status: 400 });
  }

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
  const isDocx = file.type === DOCX_TYPE || file.name.toLowerCase().endsWith('.docx');
  if (!isDocx) {
    return NextResponse.json({ error: '仅支持 .docx（Word）文件' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '文件超过 10MB 限制' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let text: string;
  try {
    text = extractDocxText(buffer);
  } catch {
    return NextResponse.json({ error: '无法解析该 Word 文档，请确认是有效的 .docx 文件' }, { status: 400 });
  }

  // 留存原文件
  const filename = `${randomUUID()}.docx`;
  const dest = path.join(process.cwd(), 'public', 'uploads', filename);
  await writeFile(dest, buffer);

  // 写入 stage5（独立字段，不覆盖 AI 框架各节）
  const stageData: StageData = { ...conv.stageData };
  stageData.stage5 = {
    ...conv.stageData.stage5!,
    uploadedDocUrl: `/uploads/${filename}`,
    uploadedText: text,
  };

  await db.conversation.update({
    where: { id: conversationId },
    data: { stageData: JSON.stringify(stageData) },
  });

  return NextResponse.json({ stageData });
}
