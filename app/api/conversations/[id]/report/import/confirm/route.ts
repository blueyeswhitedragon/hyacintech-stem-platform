import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireRole } from '@/app/lib/auth';
import { getConversationForUser, parseStageData } from '@/app/lib/conversation';
import { finalizeStageData, recoverStageDataV3, studentVisibleStageData } from '@/app/lib/stageState';
import type { Stage5Sections, StageData } from '@/app/models/stageData';

export async function POST(request: Request, ctx: RouteContext<'/api/conversations/[id]/report/import/confirm'>) {
  const auth = await requireRole('student');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;
  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });

  const body = await request.json().catch(() => null) as { previewHash?: unknown } | null;
  const previewHash = typeof body?.previewHash === 'string' ? body.previewHash : '';
  if (!previewHash) return NextResponse.json({ error: '缺少导入预览标识' }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const latest = await tx.studentAssignment.findUnique({
      where: { id: conv.studentAssignmentId },
      select: { status: true, currentStage: true, conversation: { select: { stageData: true } } },
    });
    if (!latest?.conversation || latest.status !== 'IN_PROGRESS' || latest.currentStage !== 5) {
      return { ok: false as const, error: '报告已提交、阶段已变化或作业已完成' };
    }
    const previous = recoverStageDataV3(parseStageData(latest.conversation.stageData)).stageData;
    const stage5 = previous.stage5;
    const preview = stage5?.importPreview;
    if (!stage5?.sections || !preview || preview.previewHash !== previewHash) {
      return { ok: false as const, error: '导入预览已变化，请重新上传并核对' };
    }

    const imported = preview.sections;
    const sections: Stage5Sections = {
      ...stage5.sections,
      ...imported,
      limitationsDiscussion: imported.limitationsDiscussion
        ?? stage5.sections.limitationsDiscussion
        ?? stage5.sections.reflection,
      reflection: imported.limitationsDiscussion
        ?? imported.reflection
        ?? stage5.sections.limitationsDiscussion
        ?? stage5.sections.reflection,
    };
    const next: StageData = finalizeStageData(previous, {
      ...previous,
      stage5: {
        ...stage5,
        sections,
        importPreview: undefined,
        lastConfirmedImport: {
          previewHash,
          importedFields: preview.detectedFields,
          confirmedAt: new Date().toISOString(),
        },
        aiReferenceScore: undefined,
        submittedSectionsHash: undefined,
        aiScoreSectionsHash: undefined,
      },
    }, { mutation: 'STAGE5_REPORT_IMPORT_CONFIRMED' });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { stageData: JSON.stringify(next) },
    });
    return { ok: true as const, stageData: next };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ stageData: studentVisibleStageData(result.stageData) });
}
