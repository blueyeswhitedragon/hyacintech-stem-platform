#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import { db } from '../app/lib/db';
import {
  archiveCampaign,
  claimAnnotationTask,
  createCampaign,
  decideReview,
  deleteDraftCampaign,
  reviewAnnotationWork,
  saveTaskDraft,
} from '../app/lib/dataLab/service';
import type { SessionUser } from '../app/lib/session';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function sessionUser(user: { id: string; username: string; displayName: string; role: string }): SessionUser {
  return { ...user, role: user.role as SessionUser['role'] };
}

async function main() {
  const suffix = randomUUID();
  const [adminRow, batch, sourceSample] = await Promise.all([
    db.user.findFirstOrThrow({ where: { role: 'admin' } }),
    db.datasetBatch.findFirstOrThrow(),
    db.datasetSample.findFirstOrThrow(),
  ]);
  const admin = sessionUser(adminRow);
  const annotator = await db.user.create({
    data: { username: `campaign-lifecycle-${suffix}`, displayName: '活动生命周期测试标注员', passwordHash: 'x', role: 'annotator' },
  });
  const samples = await Promise.all([1, 2, 3].map((index) => db.datasetSample.create({
    data: {
      batchId: batch.id,
      sourceRecordId: `campaign-lifecycle-${suffix}-${index}`,
      familyKey: `campaign-lifecycle-family-${suffix}-${index}`,
      phase: index === 3 ? -1 : 0,
      scenario: `活动生命周期测试样本 ${index}`,
      sourceKind: 'test',
      candidateTier: 'silver',
      originalRecordJson: sourceSample.originalRecordJson,
    },
  })));
  const campaignIds: string[] = [];
  const taskIds: string[] = [];
  const reviewIds: string[] = [];
  const releaseIds: string[] = [];

  try {
    const campaign = await createCampaign({
      name: `campaign-archive-test-${suffix}`,
      selection: {},
      participants: [{ userId: annotator.id, taskLimit: 0 }],
      user: admin,
    });
    campaignIds.push(campaign.id);
    await db.annotationCampaign.update({ where: { id: campaign.id }, data: { status: 'ACTIVE', startedAt: new Date() } });

    const pendingTask = await db.annotationTask.create({ data: { campaignId: campaign.id, sampleId: samples[0].id, slot: 1 } });
    const inProgressTask = await db.annotationTask.create({
      data: {
        campaignId: campaign.id,
        sampleId: samples[0].id,
        slot: 2,
        status: 'IN_PROGRESS',
        assignedToId: annotator.id,
        draftJson: JSON.stringify({ assistantMessages: [], issueTags: [], changeReason: '尚未提交的测试草稿', noChange: false }),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const submittedTask = await db.annotationTask.create({
      data: { campaignId: campaign.id, sampleId: samples[0].id, slot: 3, status: 'SUBMITTED', assignedToId: annotator.id, submittedAt: new Date() },
    });
    taskIds.push(pendingTask.id, inProgressTask.id, submittedTask.id);
    const submittedRevision = await db.annotationRevision.create({
      data: { taskId: submittedTask.id, sampleId: samples[0].id, authorId: annotator.id, version: 1, contentJson: '[]', fullRecordJson: samples[0].originalRecordJson },
    });
    const submittedReview = await db.annotationWorkReview.create({ data: { taskId: submittedTask.id, revisionId: submittedRevision.id } });
    reviewIds.push(submittedReview.id);

    const arbitrationTasks = await Promise.all([1, 2].map((slot) => db.annotationTask.create({
      data: { campaignId: campaign.id, sampleId: samples[1].id, slot, status: 'SUBMITTED', assignedToId: annotator.id, submittedAt: new Date() },
    })));
    taskIds.push(...arbitrationTasks.map((task) => task.id));
    const arbitrationRevisions = await Promise.all(arbitrationTasks.map((task, index) => db.annotationRevision.create({
      data: { taskId: task.id, sampleId: samples[1].id, authorId: annotator.id, version: 1, contentJson: '[]', fullRecordJson: samples[1].originalRecordJson, changeReason: `候选 ${index + 1}` },
    })));
    const arbitrationReviews = await Promise.all(arbitrationRevisions.map((revision, index) => db.annotationWorkReview.create({
      data: { taskId: arbitrationTasks[index].id, revisionId: revision.id },
    })));
    reviewIds.push(...arbitrationReviews.map((review) => review.id));
    const reviewCase = await db.reviewCase.create({
      data: {
        campaignId: campaign.id,
        sampleId: samples[1].id,
        triggerReason: 'LIFECYCLE_TEST',
        candidateRevisionIdsJson: JSON.stringify(arbitrationRevisions.map((revision) => revision.id)),
        status: 'IN_REVIEW',
        assignedReviewerId: admin.id,
        assignedAt: new Date(),
      },
    });
    const release = await db.datasetRelease.create({
      data: { version: `campaign-lifecycle-${suffix}`, campaignId: campaign.id, createdById: admin.id },
    });
    releaseIds.push(release.id);

    const summary = await archiveCampaign(campaign.id, '自动化测试：结束试运行活动', admin);
    const archived = await db.annotationCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    check('进行中活动可以结束并归档', archived.status === 'ARCHIVED' && !!archived.completedAt);
    check('归档只取消未完成任务', summary.cancelledTaskCount === 2 && await db.annotationTask.count({ where: { id: { in: [pendingTask.id, inProgressTask.id] }, status: 'CANCELLED' } }) === 2);
    const preservedDraft = await db.annotationTask.findUniqueOrThrow({ where: { id: inProgressTask.id } });
    check('取消任务仍保留负责人和未提交草稿作为历史证据', preservedDraft.assignedToId === annotator.id && preservedDraft.draftJson.includes('尚未提交的测试草稿'));
    check('已提交任务和人工修订保持不变', await db.annotationTask.count({ where: { campaignId: campaign.id, status: 'SUBMITTED' } }) === 3 && await db.annotationRevision.count({ where: { task: { campaignId: campaign.id } } }) === 3);
    check('归档停用活动参与者分配', await db.campaignParticipant.count({ where: { campaignId: campaign.id, active: true } }) === 0);
    check('归档保留仲裁和发布版本', await db.reviewCase.count({ where: { id: reviewCase.id } }) === 1 && await db.datasetRelease.count({ where: { id: release.id, campaignId: campaign.id } }) === 1);
    check('归档影响统计准确', summary.submittedTaskCount === 3 && summary.pendingWorkReviewCount === 3 && summary.pendingReviewCount === 1 && summary.releaseCount === 1);
    check('归档操作写入审计日志', await db.dataLabAuditLog.count({ where: { action: 'CAMPAIGN_ARCHIVED', entityId: campaign.id } }) === 1);

    let draftRejected = false;
    try {
      await saveTaskDraft(inProgressTask.id, { assistantMessages: [], issueTags: [], changeReason: '归档后不应保存', noChange: false }, sessionUser(annotator));
    } catch { draftRejected = true; }
    check('归档任务不能继续保存草稿', draftRejected);

    let workReturnRejected = false;
    try { await reviewAnnotationWork({ reviewId: submittedReview.id, status: 'RETURNED', note: '归档后退回测试', user: admin }); } catch { workReturnRejected = true; }
    check('归档活动的工作量审核不能退回修改', workReturnRejected);
    await reviewAnnotationWork({ reviewId: submittedReview.id, status: 'INVALID', note: '归档活动无效测试', user: admin });
    check('归档活动标记无效后不会重新开放任务', (await db.annotationTask.findUniqueOrThrow({ where: { id: submittedTask.id } })).status === 'CANCELLED');

    let arbitrationReturnRejected = false;
    try {
      await decideReview({ reviewCaseId: reviewCase.id, action: 'RETURN', finalTier: 'reject', reason: '归档后仲裁退回测试', user: admin });
    } catch { arbitrationReturnRejected = true; }
    check('归档活动的仲裁不能重新开放任务', arbitrationReturnRejected);

    const activeCampaign = await createCampaign({
      name: `campaign-active-test-${suffix}`,
      selection: {},
      participants: [{ userId: annotator.id, taskLimit: 1 }],
      user: admin,
    });
    campaignIds.push(activeCampaign.id);
    await db.annotationCampaign.update({ where: { id: activeCampaign.id }, data: { status: 'ACTIVE', startedAt: new Date() } });
    const activeTask = await db.annotationTask.create({ data: { campaignId: activeCampaign.id, sampleId: samples[2].id, slot: 1 } });
    taskIds.push(activeTask.id);
    const claimed = await claimAnnotationTask(sessionUser(annotator));
    check('领取队列跳过归档活动并只返回进行中活动', claimed?.taskId === activeTask.id);

    let startedDeleteRejected = false;
    try { await deleteDraftCampaign(campaign.id, admin); } catch { startedDeleteRejected = true; }
    check('已启动活动不能永久删除', startedDeleteRejected);

    const draftCampaign = await createCampaign({
      name: `campaign-draft-delete-test-${suffix}`,
      selection: {},
      participants: [{ userId: annotator.id, taskLimit: 1 }],
      user: admin,
    });
    campaignIds.push(draftCampaign.id);
    await deleteDraftCampaign(draftCampaign.id, admin);
    check('没有业务记录的草稿活动可以永久删除', await db.annotationCampaign.count({ where: { id: draftCampaign.id } }) === 0);
    check('删除空草稿仍保留管理员审计记录', await db.dataLabAuditLog.count({ where: { action: 'UNUSED_CAMPAIGN_DELETED', entityId: draftCampaign.id } }) === 1);
  } finally {
    const externalClaims = await db.annotationTask.findMany({
      where: { assignedToId: annotator.id, campaignId: { notIn: campaignIds } },
      select: { id: true },
    });
    if (externalClaims.length > 0) {
      await db.annotationTask.updateMany({
        where: { id: { in: externalClaims.map((task) => task.id) }, assignedToId: annotator.id, status: 'IN_PROGRESS' },
        data: { status: 'PENDING', assignedToId: null, draftJson: '{}', leaseExpiresAt: null },
      });
    }
    await db.dataLabAuditLog.deleteMany({
      where: {
        OR: [
          { actorId: annotator.id },
          { entityType: 'AnnotationCampaign', entityId: { in: campaignIds } },
          { entityType: 'AnnotationTask', entityId: { in: taskIds } },
          { entityType: 'AnnotationWorkReview', entityId: { in: reviewIds } },
        ],
      },
    });
    await db.datasetRelease.deleteMany({ where: { id: { in: releaseIds } } });
    await db.annotationCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await db.datasetSample.deleteMany({ where: { id: { in: samples.map((sample) => sample.id) } } });
    await db.user.delete({ where: { id: annotator.id } });
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(async () => db.$disconnect());
