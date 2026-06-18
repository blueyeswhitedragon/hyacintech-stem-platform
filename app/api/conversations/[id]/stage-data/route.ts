import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import type { StageData, Stage2Column, Stage3FileAssociation } from '@/app/models/stageData';

// PATCH /api/conversations/[id]/stage-data
// 学生录入数据落库（白名单字段，按当前阶段校验）：
//   { stage2: { columns } }                      仅 currentStage==2（编辑数据表列定义）
//   { stage3: { rows, fileAssociations? } }  仅 currentStage==3
//   { stage5: { conclusion, reflection } }    仅 currentStage==5（不允许改 AI 预填的其它 section）
export async function PATCH(req: Request, ctx: RouteContext<'/api/conversations/[id]/stage-data'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;

  let body: {
    stage2?: { columns?: Stage2Column[] };
    stage3?: { rows?: Record<string, unknown>[]; fileAssociations?: Stage3FileAssociation[] };
    stage5?: { conclusion?: string; reflection?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) {
    return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  }

  const stageData: StageData = { ...conv.stageData };

  if (body.stage2) {
    if (conv.currentStage !== 2) {
      return NextResponse.json({ error: '当前不在方案设计阶段' }, { status: 400 });
    }
    if (!conv.stageData.stage2?.schema) {
      return NextResponse.json({ error: '请先生成数据表结构' }, { status: 400 });
    }
    if (!Array.isArray(body.stage2.columns) || body.stage2.columns.length === 0) {
      return NextResponse.json({ error: 'columns 必须为非空数组' }, { status: 400 });
    }
    // 验证每个 column 的合法性
    for (const c of body.stage2.columns) {
      if (!c.key || !c.title || !['text', 'number', 'image'].includes(c.type)) {
        return NextResponse.json({ error: `列「${c.key || '?'}」定义不合法` }, { status: 400 });
      }
    }
    stageData.stage2 = {
      ...conv.stageData.stage2,
      schema: {
        ...conv.stageData.stage2.schema,
        columns: body.stage2.columns,
      },
    };
  } else if (body.stage3) {
    if (conv.currentStage !== 3) {
      return NextResponse.json({ error: '当前不在过程执行阶段' }, { status: 400 });
    }
    if (!Array.isArray(body.stage3.rows)) {
      return NextResponse.json({ error: 'rows 必须为数组' }, { status: 400 });
    }
    stageData.stage3 = {
      rows: body.stage3.rows,
      fileAssociations: Array.isArray(body.stage3.fileAssociations)
        ? body.stage3.fileAssociations
        : conv.stageData.stage3?.fileAssociations,
    };
  } else if (body.stage5) {
    if (conv.currentStage !== 5) {
      return NextResponse.json({ error: '当前不在报告成型阶段' }, { status: 400 });
    }
    const prev = conv.stageData.stage5;
    if (!prev?.sections) {
      return NextResponse.json({ error: '请先生成报告框架' }, { status: 400 });
    }
    // 仅覆盖 conclusion/reflection，其它 section 保持 AI 预填
    stageData.stage5 = {
      ...prev,
      sections: {
        ...prev.sections,
        conclusion: typeof body.stage5.conclusion === 'string' ? body.stage5.conclusion : prev.sections.conclusion,
        reflection: typeof body.stage5.reflection === 'string' ? body.stage5.reflection : prev.sections.reflection,
      },
    };
  } else {
    return NextResponse.json({ error: '无可保存的字段' }, { status: 400 });
  }

  await db.conversation.update({
    where: { id: conversationId },
    data: { stageData: JSON.stringify(stageData) },
  });

  return NextResponse.json({ stageData });
}
