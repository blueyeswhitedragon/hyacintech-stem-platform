import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireRole } from '@/app/lib/auth';
import { DATA_POLICY_VERSION } from '@/app/lib/productionCandidates';

/**
 * PATCH /api/assignments/[id] —— 教师调整已发布作业的数据回流开关
 *
 * 补这条路由是因为原先 dataContributionMode 只在创建时可写：发布时忘记勾选，
 * 这份作业的对话就永久无法提名，只能重发一份新作业让学生从头做。
 *
 * 开启时要顺带回填已在进行中的 StudentAssignment：授权卡片的显示条件是
 * 作业已开启 + 该学生有 studentAssignment 记录，而 dataConsentStatus 只在
 * 建会话时写过一次（ensureStudentConversation）。不回填的话，已经开始探究的
 * 学生会一直停在 NOT_APPLICABLE，看不到授权入口。
 *
 * 关闭时保留学生已作出的授权决定：那是学生的历史意思表示，不该被教师改写。
 * 关闭后 setStudentDataConsent 与提名校验都会拒绝，回流自然停止。
 */
export async function PATCH(request: Request, ctx: RouteContext<'/api/assignments/[id]'>) {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;

  let body: { allowDataContribution?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  if (typeof body.allowDataContribution !== 'boolean') {
    return NextResponse.json({ error: 'allowDataContribution 必须为布尔值' }, { status: 400 });
  }

  const assignment = await db.assignment.findUnique({
    where: { id },
    select: { id: true, dataContributionMode: true, class: { select: { teacherId: true } } },
  });
  if (!assignment) return NextResponse.json({ error: '作业不存在' }, { status: 404 });
  if (assignment.class.teacherId !== auth.user.id) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  const nextMode = body.allowDataContribution ? 'CONSENT_REQUIRED' : 'DISABLED';
  if (assignment.dataContributionMode === nextMode) {
    return NextResponse.json({ dataContributionMode: nextMode, backfilled: 0 });
  }

  const result = await db.$transaction(async (tx) => {
    await tx.assignment.update({
      where: { id: assignment.id },
      data: {
        dataContributionMode: nextMode,
        dataPolicyVersion: body.allowDataContribution ? DATA_POLICY_VERSION : null,
      },
    });

    const backfilled = body.allowDataContribution
      ? (
          await tx.studentAssignment.updateMany({
            where: { assignmentId: assignment.id, dataConsentStatus: 'NOT_APPLICABLE' },
            data: { dataConsentStatus: 'PENDING', dataConsentPolicyVersion: DATA_POLICY_VERSION },
          })
        ).count
      : 0;

    await tx.dataLabAuditLog.create({
      data: {
        actorId: auth.user.id,
        action: body.allowDataContribution ? 'ASSIGNMENT_DATA_CONTRIBUTION_ENABLED' : 'ASSIGNMENT_DATA_CONTRIBUTION_DISABLED',
        entityType: 'Assignment',
        entityId: assignment.id,
        payloadJson: JSON.stringify({
          from: assignment.dataContributionMode,
          to: nextMode,
          backfilledStudentAssignments: backfilled,
        }),
      },
    });

    return backfilled;
  });

  return NextResponse.json({ dataContributionMode: nextMode, backfilled: result });
}
