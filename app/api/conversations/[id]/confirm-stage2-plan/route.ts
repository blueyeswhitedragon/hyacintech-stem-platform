import { NextResponse } from 'next/server';
import { requireUser } from '@/app/lib/auth';
import { db } from '@/app/lib/db';
import { getConversationForUser } from '@/app/lib/conversation';
import { buildDataTableSchema } from '@/app/lib/stageArtifacts';
import { deterministicRisks } from '@/app/lib/serverTutorState';
import { finalizeStageData, stage2DraftHash, studentVisibleStageData } from '@/app/lib/stageState';
import type { StageData } from '@/app/models/stageData';

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/conversations/[id]/confirm-stage2-plan'>,
) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;
  let body: { draftHash?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  if (typeof body.draftHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.draftHash)) {
    return NextResponse.json({ error: 'draftHash 格式无效' }, { status: 400 });
  }

  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  if (conv.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: '当前作业状态不可修改' }, { status: 409 });
  }
  if (conv.currentStage !== 2) {
    return NextResponse.json({ error: '当前不在方案设计阶段' }, { status: 400 });
  }

  const draft = conv.stageData.stage2?.planDraft;
  const storedHash = conv.stageData.stage2?.draftHash;
  if (!draft || !storedHash) {
    return NextResponse.json({ error: '方案信息尚未完整，请先继续与导师梳理' }, { status: 400 });
  }
  const computedHash = stage2DraftHash(draft);
  if (body.draftHash !== storedHash || storedHash !== computedHash) {
    return NextResponse.json({ error: '方案预览已变化，请刷新并核对最新版本' }, { status: 409 });
  }

  const schema = buildDataTableSchema(draft);
  const withFrozenPlan: StageData = {
    ...conv.stageData,
    stage2: {
      ...conv.stageData.stage2!,
      submitted: false,
      planDraft: draft,
      draftHash: computedHash,
      confirmedPlanHash: computedHash,
      confirmationSource: {
        type: 'student_checkpoint',
        confirmedAt: new Date().toISOString(),
      },
      experimentPlan: draft,
      factsConfirmed: true,
      schema,
    },
  };
  withFrozenPlan.stage2!.aiRiskAnnotations = deterministicRisks(withFrozenPlan);
  const stageData = finalizeStageData(conv.stageData, withFrozenPlan, {
    mutation: 'STAGE2_PLAN_CONFIRMED',
    promptPolicyVersion: conv.stageData.contractMeta?.promptPolicyVersion,
    serverArtifactTypes: ['experiment_plan', 'data_table_schema', 'risks'],
  });

  await db.conversation.update({
    where: { id: conversationId },
    data: { stageData: JSON.stringify(stageData) },
  });
  return NextResponse.json({ stageData: studentVisibleStageData(stageData), confirmedPlanHash: computedHash });
}
