#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import { db } from '../app/lib/db';
import { createCampaign, reviewAnnotationWork } from '../app/lib/dataLab/service';
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
  const [adminRow, annotator, sample] = await Promise.all([
    db.user.findFirstOrThrow({ where: { role: 'admin' } }),
    db.user.findFirstOrThrow({ where: { role: 'annotator' } }),
    db.datasetSample.findFirstOrThrow(),
  ]);
  const admin = sessionUser(adminRow);
  const campaign = await createCampaign({
    name: `workload-test-${randomUUID()}`,
    selection: {},
    participants: [{ userId: annotator.id, taskLimit: 3 }],
    user: admin,
  });
  await db.annotationCampaign.update({ where: { id: campaign.id }, data: { status: 'ACTIVE' } });
  const reviewIds: string[] = [];
  try {
    const task = await db.annotationTask.create({ data: { campaignId: campaign.id, sampleId: sample.id, slot: 1, status: 'SUBMITTED', assignedToId: annotator.id, submittedAt: new Date() } });
    const revision1 = await db.annotationRevision.create({ data: { taskId: task.id, sampleId: sample.id, authorId: annotator.id, version: 1, contentJson: '[]', fullRecordJson: sample.originalRecordJson } });
    const review1 = await db.annotationWorkReview.create({ data: { taskId: task.id, revisionId: revision1.id } });
    reviewIds.push(review1.id);
    await reviewAnnotationWork({ reviewId: review1.id, status: 'APPROVED', user: admin });
    check('通过后精确计入一条有效工作量', await db.annotationWorkReview.count({ where: { id: review1.id, status: 'APPROVED' } }) === 1);

    const revision2 = await db.annotationRevision.create({ data: { taskId: task.id, sampleId: sample.id, authorId: annotator.id, version: 2, contentJson: '[]', fullRecordJson: sample.originalRecordJson } });
    const review2 = await db.annotationWorkReview.create({ data: { taskId: task.id, revisionId: revision2.id } });
    reviewIds.push(review2.id);
    let duplicateRejected = false;
    try { await reviewAnnotationWork({ reviewId: review2.id, status: 'APPROVED', user: admin }); } catch { duplicateRejected = true; }
    check('同一参与者同一任务不能重复计数', duplicateRejected);
    await reviewAnnotationWork({ reviewId: review2.id, status: 'RETURNED', note: '需要补充修改理由', user: admin });
    const returnedTask = await db.annotationTask.findUniqueOrThrow({ where: { id: task.id } });
    check('退回后任务回到原参与者且可继续修改', returnedTask.status === 'RETURNED' && returnedTask.assignedToId === annotator.id);

    const invalidTask = await db.annotationTask.create({ data: { campaignId: campaign.id, sampleId: sample.id, slot: 2, status: 'SUBMITTED', assignedToId: annotator.id, submittedAt: new Date() } });
    const invalidRevision = await db.annotationRevision.create({ data: { taskId: invalidTask.id, sampleId: sample.id, authorId: annotator.id, version: 1, contentJson: '[]', fullRecordJson: sample.originalRecordJson } });
    const invalidReview = await db.annotationWorkReview.create({ data: { taskId: invalidTask.id, revisionId: invalidRevision.id } });
    reviewIds.push(invalidReview.id);
    await reviewAnnotationWork({ reviewId: invalidReview.id, status: 'INVALID', note: '无效测试记录', user: admin });
    const reopened = await db.annotationTask.findUniqueOrThrow({ where: { id: invalidTask.id } });
    check('无效任务重新进入公共队列', reopened.status === 'PENDING' && reopened.assignedToId === null);
    const selfTask = await db.annotationTask.create({ data: { campaignId: campaign.id, sampleId: sample.id, slot: 3, status: 'SUBMITTED', assignedToId: admin.id, submittedAt: new Date() } });
    const selfRevision = await db.annotationRevision.create({ data: { taskId: selfTask.id, sampleId: sample.id, authorId: admin.id, version: 1, contentJson: '[]', fullRecordJson: sample.originalRecordJson } });
    const selfReview = await db.annotationWorkReview.create({ data: { taskId: selfTask.id, revisionId: selfRevision.id } });
    reviewIds.push(selfReview.id);
    let selfReviewBlocked = false;
    try { await reviewAnnotationWork({ reviewId: selfReview.id, status: 'APPROVED', user: admin }); } catch { selfReviewBlocked = true; }
    check('即使后来拥有管理员身份也不能审核自己的修订', selfReviewBlocked);
    check('活动参与者和条数上限被保存', await db.campaignParticipant.count({ where: { campaignId: campaign.id, userId: annotator.id, taskLimit: 3 } }) === 1);
  } finally {
    await db.dataLabAuditLog.deleteMany({ where: { OR: [{ entityType: 'AnnotationWorkReview', entityId: { in: reviewIds } }, { entityType: 'AnnotationCampaign', entityId: campaign.id }] } });
    await db.annotationCampaign.delete({ where: { id: campaign.id } });
  }
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(async () => db.$disconnect());
