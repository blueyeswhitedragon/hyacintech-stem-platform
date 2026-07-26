#!/usr/bin/env tsx
import './load-script-env';
import { db } from '../app/lib/db';

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const requestedRunId = arg('--run-id');
  const reason = arg('--reason')?.trim() || '结构决策覆盖配比升级，旧 Trial 36 与人工签署失效';
  const username = arg('--admin') ?? 'data-admin';
  const latest = requestedRunId ? null : await db.bootstrapGenerationRun.findFirst({
    where: {
      kind: 'CASE_COMPILATION',
      status: 'COMPLETED',
      parametersJson: { contains: '"profile":"TRIAL_36"' },
      cases: { some: { status: { not: 'SUPERSEDED' } } },
    },
    orderBy: { completedAt: 'desc' },
    select: { id: true },
  });
  const runId = requestedRunId ?? latest?.id;
  if (!runId) throw new Error('找不到可替代的 Trial 36 run');
  const [run, admin] = await Promise.all([
    db.bootstrapGenerationRun.findUnique({ where: { id: runId }, include: { cases: { include: { finalizedTurn: true, reviewTasks: true, _count: { select: { candidates: true } } } } } }),
    db.user.findFirst({ where: { username, role: 'admin', isActive: true } }),
  ]);
  if (!run || run.kind !== 'CASE_COMPILATION' || !run.parametersJson.includes('"profile":"TRIAL_36"')) throw new Error('run 不存在或不是 Trial 36 编译 run');
  if (!admin) throw new Error(`找不到有效管理员：${username}`);
  const preservedCandidates = run.cases.reduce((sum, item) => sum + item._count.candidates, 0);
  const preservedFinalized = run.cases.filter((item) => item.finalizedTurn).length;
  const preservedSubmittedReviews = run.cases.flatMap((item) => item.reviewTasks).filter((task) => task.status === 'SUBMITTED').length;
  await db.$transaction([
    db.tutorTurnCase.updateMany({ where: { generationRunId: runId, status: { not: 'SUPERSEDED' } }, data: { status: 'SUPERSEDED' } }),
    db.tutorReviewTask.updateMany({ where: { case: { generationRunId: runId }, status: { in: ['PENDING', 'RETURNED', 'IN_PROGRESS'] } }, data: { status: 'SUPERSEDED', assignedToId: null, leaseExpiresAt: null } }),
    db.bootstrapGenerationRun.update({ where: { id: runId }, data: { status: 'SUPERSEDED', failureReason: reason } }),
    db.bootstrapGenerationRun.updateMany({
      where: { kind: 'TRIAL_SIGNOFF', status: 'COMPLETED', parametersJson: { contains: `"trialRunId":"${runId}"` } },
      data: { status: 'SUPERSEDED', failureReason: reason },
    }),
    db.dataLabAuditLog.create({ data: {
      actorId: admin.id,
      action: 'TUTOR_TRIAL_RUN_SUPERSEDED',
      entityType: 'BootstrapGenerationRun',
      entityId: runId,
      payloadJson: JSON.stringify({ reason, cases: run.cases.length, preservedCandidates, preservedFinalized, preservedSubmittedReviews }),
    } }),
  ]);
  console.log(JSON.stringify({ runId, status: 'SUPERSEDED', cases: run.cases.length, preservedCandidates, preservedFinalized, preservedSubmittedReviews, reason }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
