import { NextResponse } from 'next/server';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import { buildReportDocx } from '@/app/lib/reportDocx';

// POST /api/conversations/[id]/report/export —— 把第五阶段报告导出为 .docx（含数据表）
export async function POST(_req: Request, ctx: RouteContext<'/api/conversations/[id]/report/export'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;
  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });

  const stage5 = conv.stageData.stage5;
  if (!stage5?.sections) {
    return NextResponse.json({ error: '报告框架尚未生成，无法导出' }, { status: 400 });
  }

  const buffer = buildReportDocx({
    sections: stage5.sections,
    schemaColumns: conv.stageData.stage2?.schema?.columns,
    dataRows: conv.stageData.stage3?.rows,
    uploadedText: stage5.uploadedText,
  });

  const filename = '实验报告.docx';
  const encoded = encodeURIComponent(filename);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="report.docx"; filename*=UTF-8''${encoded}`,
      'Content-Length': String(buffer.length),
    },
  });
}
