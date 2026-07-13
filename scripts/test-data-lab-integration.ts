#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import { db } from '../app/lib/db';
import type { SessionUser } from '../app/lib/session';
import type { RevisionInput } from '../app/lib/dataLab/types';
import {
  claimAnnotationTask,
  claimReviewCase,
  createDatasetRelease,
  createTrainingRun,
  decideReview,
  freezeDatasetRelease,
  importEvaluation,
  reviewAnnotationWork,
  submitAnnotationTask,
} from '../app/lib/dataLab/service';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function sessionUser(user: { id: string; username: string; displayName: string; role: string }): SessionUser {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role as SessionUser['role'] };
}

function noChangeInput(task: NonNullable<Awaited<ReturnType<typeof claimAnnotationTask>>>): RevisionInput {
  return {
    assistantMessages: task.conversations
      .filter((message) => message.from === 'gpt' && message.response)
      .map((message) => ({ messageIndex: message.index, response: message.response! })),
    issueTags: [],
    changeReason: '集成测试：无需修改',
    noChange: true,
  };
}

async function main() {
  const [adminRow, annotatorRows, reviewerRow, campaign] = await Promise.all([
    db.user.findFirstOrThrow({ where: { role: 'admin', isActive: true } }),
    db.user.findMany({ where: { role: 'annotator', isActive: true }, orderBy: { username: 'asc' }, take: 2 }),
    db.user.findFirstOrThrow({ where: { role: 'reviewer', isActive: true }, orderBy: { username: 'asc' } }),
    db.annotationCampaign.findUniqueOrThrow({ where: { name: 'dataset-base-v1-pilot-12' } }),
  ]);
  if (annotatorRows.length < 2) throw new Error('集成测试至少需要 2 个启用中的标注员账号');
  const [annotator1Row, annotator2Row] = annotatorRows;
  const admin = sessionUser(adminRow);
  const annotator1 = sessionUser(annotator1Row);
  const annotator2 = sessionUser(annotator2Row);
  const reviewer = sessionUser(reviewerRow);

  const existingDecision = await db.reviewDecision.findFirst({ where: { reviewCase: { campaignId: campaign.id } } });
  if (!existingDecision) {
    const taskA = await claimAnnotationTask(annotator1);
    const taskB = await claimAnnotationTask(annotator2);
    check('two annotators receive tasks', !!taskA && !!taskB);
    check('double annotation uses same sample', taskA?.sampleId === taskB?.sampleId);
    check('double annotation uses different slots/tasks', taskA?.taskId !== taskB?.taskId);
    if (!taskA || !taskB) throw new Error('无法领取双标任务');
    const submissionA = await submitAnnotationTask(taskA.taskId, noChangeInput(taskA), annotator1);
    const submissionB = await submitAnnotationTask(taskB.taskId, noChangeInput(taskB), annotator2);
    const [workA, workB] = await Promise.all([
      db.annotationWorkReview.findUniqueOrThrow({ where: { revisionId: submissionA.revision.id } }),
      db.annotationWorkReview.findUniqueOrThrow({ where: { revisionId: submissionB.revision.id } }),
    ]);
    await reviewAnnotationWork({ reviewId: workA.id, status: 'APPROVED', user: admin });
    await reviewAnnotationWork({ reviewId: workB.id, status: 'APPROVED', user: admin });
    check('approved submissions count independently', await db.annotationWorkReview.count({ where: { id: { in: [workA.id, workB.id] }, status: 'APPROVED' } }) === 2);
    const reviewCase = await claimReviewCase(reviewer);
    check('reviewer receives arbitration case', !!reviewCase);
    check('review candidates anonymized', reviewCase?.candidates.every((candidate) => /^[A-Z]$/.test(candidate.label)) ?? false);
    if (!reviewCase) throw new Error('无法领取复审任务');
    await decideReview({
      reviewCaseId: reviewCase.id,
      action: 'SELECT',
      selectedRevisionId: reviewCase.candidates[0].id,
      finalTier: 'human_gold',
      rubric: { student_agency: 5, theme_fidelity: 5 },
      reason: '集成测试：接受匿名版本A',
      user: reviewer,
    });
  } else {
    check('existing arbitration decision reusable', true);
  }

  let release = await db.datasetRelease.findUnique({ where: { version: 'pilot-v1' } });
  if (!release) release = await createDatasetRelease({ version: 'pilot-v1', campaignId: campaign.id, user: admin });
  if (release.status === 'DRAFT') await freezeDatasetRelease(release.id, admin);
  const frozenRelease = await db.datasetRelease.findUniqueOrThrow({ where: { id: release.id }, include: { _count: { select: { items: true } } } });
  check('release frozen', frozenRelease.status === 'FROZEN');
  check('release contains reviewed item', frozenRelease._count.items >= 1);

  let training = await db.trainingRun.findUnique({ where: { name: 'pilot-training-run' } });
  if (!training) training = await createTrainingRun({ name: 'pilot-training-run', releaseId: frozenRelease.id, baseModel: 'Qwen3.5-35B-A3B', status: 'DRAFT', modelTag: 'pilot-qwen', user: admin });
  check('training run registered', training.releaseId === frozenRelease.id);

  let evaluation = await db.evaluationRun.findUnique({ where: { name: 'pilot-qwen-vs-dsv4' } });
  if (!evaluation) {
    const files = await Promise.all([
      'transcript-qwen-smoke.json',
      'transcript-dsv4-smoke.json',
      'verdict-qwen-smoke-vs-dsv4-smoke.json',
    ].map(async (fileName) => ({ fileName, raw: await readFile(path.join(process.cwd(), 'data/blind-eval', fileName), 'utf8') })));
    evaluation = await importEvaluation({ name: 'pilot-qwen-vs-dsv4', files, user: admin });
  }
  check('evaluation artifacts imported', await db.evaluationArtifact.count({ where: { runId: evaluation.id } }) === 3);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(async () => db.$disconnect());
