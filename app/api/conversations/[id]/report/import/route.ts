import { NextResponse } from 'next/server';
import { unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { db } from '@/app/lib/db';
import { requireRole } from '@/app/lib/auth';
import { getConversationForUser, parseStageData } from '@/app/lib/conversation';
import { extractDocxText } from '@/app/lib/docxExtract';
import type { StageData } from '@/app/models/stageData';
import { finalizeStageData, recoverStageDataV3, studentVisibleStageData } from '@/app/lib/stageState';

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
  if (conv.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: '报告已提交或作业已完成，不能上传' }, { status: 409 });
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

  // 重新读取并合并最新 JSON，避免覆盖同时发生的报告字段保存。
  const result = await db.$transaction(async (tx) => {
    const latest = await tx.studentAssignment.findUnique({
      where: { id: conv.studentAssignmentId },
      select: { status: true, currentStage: true, conversation: { select: { stageData: true } } },
    });
    if (!latest?.conversation || latest.status !== 'IN_PROGRESS' || latest.currentStage !== 5) {
      return { ok: false as const };
    }
    const previous = recoverStageDataV3(parseStageData(latest.conversation.stageData)).stageData;
    if (!previous.stage5?.sections || previous.stage5.submitted) return { ok: false as const };
    const next: StageData = finalizeStageData(previous, {
      ...previous,
      stage5: {
        ...previous.stage5,
        uploadedDocUrl: `/uploads/${filename}`,
        uploadedText: text,
      },
    }, { mutation: 'STAGE5_REPORT_IMPORTED' });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { stageData: JSON.stringify(next) },
    });
    return { ok: true as const, stageData: next };
  });
  if (!result.ok) {
    await unlink(dest).catch(() => undefined);
    return NextResponse.json({ error: '报告已提交、阶段已变化或作业已完成' }, { status: 409 });
  }

  return NextResponse.json({ stageData: studentVisibleStageData(result.stageData) });
}
