import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import type { StageData, Stage2Column, Stage3FileAssociation } from '@/app/models/stageData';
import { validateStage3Rows } from '@/app/lib/stage3Rows';
import { finalizeStageData, studentVisibleStageData } from '@/app/lib/stageState';

// PATCH /api/conversations/[id]/stage-data
// 学生录入数据落库（白名单字段，按当前阶段校验）：
//   { stage2: { columns } }                      仅 currentStage==2（编辑数据表列定义）
//   { stage3: { rows, fileAssociations? } }  仅 currentStage==3
//   { stage5: { conclusion, limitationsDiscussion } } 仅 currentStage==5（不允许改平台预填字段）
export async function PATCH(req: Request, ctx: RouteContext<'/api/conversations/[id]/stage-data'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;

  let body: {
    stage2?: { columns?: Stage2Column[] };
    stage3?: { rows?: Record<string, unknown>[]; fileAssociations?: Stage3FileAssociation[] };
    stage5?: { conclusion?: string; limitationsDiscussion?: string; reflection?: string };
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
  if (conv.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: '当前作业已提交或完成，不能修改' }, { status: 409 });
  }

  const stageData: StageData = { ...conv.stageData };

  if (body.stage2) {
    return NextResponse.json({ error: '数据表结构由已确认方案锁定；如需修改，请先修改方案并重新确认' }, { status: 409 });
  } else if (body.stage3) {
    if (conv.currentStage !== 3) {
      return NextResponse.json({ error: '当前不在过程执行阶段' }, { status: 400 });
    }
    const stage2 = conv.stageData.stage2;
    if (!stage2?.experimentPlan || !stage2.confirmedPlanHash || stage2.confirmedPlanHash !== stage2.draftHash) {
      return NextResponse.json({ error: '实验方案尚未确认或已变化' }, { status: 409 });
    }
    if (!conv.safetyQuizCompleted && conv.stageData.stage3?.safetyQuiz?.passed !== true) {
      return NextResponse.json({ error: '请先完成并通过本实验的安全问答，再录入数据' }, { status: 400 });
    }
    const validated = validateStage3Rows(body.stage3.rows, body.stage3.fileAssociations, stage2.schema);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    stageData.stage3 = {
      ...conv.stageData.stage3,
      rows: validated.rows!,
      fileAssociations: body.stage3.fileAssociations === undefined
        ? conv.stageData.stage3?.fileAssociations
        : validated.fileAssociations,
    };
  } else if (body.stage5) {
    if (conv.currentStage !== 5) {
      return NextResponse.json({ error: '当前不在报告成型阶段' }, { status: 400 });
    }
    const prev = conv.stageData.stage5;
    if (!prev?.sections) {
      return NextResponse.json({ error: '请先生成报告框架' }, { status: 400 });
    }
    const nextLimitations = typeof body.stage5.limitationsDiscussion === 'string'
      ? body.stage5.limitationsDiscussion
      : typeof body.stage5.reflection === 'string'
        ? body.stage5.reflection
        : prev.sections.limitationsDiscussion ?? prev.sections.reflection;
    // 仅覆盖学生字段；reflection 继续作为旧客户端兼容镜像。
    stageData.stage5 = {
      ...prev,
      aiReferenceScore: undefined,
      submittedSectionsHash: undefined,
      aiScoreSectionsHash: undefined,
      sections: {
        ...prev.sections,
        conclusion: typeof body.stage5.conclusion === 'string' ? body.stage5.conclusion : prev.sections.conclusion,
        limitationsDiscussion: nextLimitations,
        reflection: nextLimitations,
      },
    };
  } else {
    return NextResponse.json({ error: '无可保存的字段' }, { status: 400 });
  }

  const finalized = finalizeStageData(conv.stageData, stageData, {
    mutation: body.stage3 ? 'STAGE3_ROWS_SAVED' : 'STAGE5_FIELDS_SAVED',
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: { stageData: JSON.stringify(finalized) },
  });

  return NextResponse.json({ stageData: studentVisibleStageData(finalized) });
}
