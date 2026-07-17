#!/usr/bin/env tsx
import './load-script-env';
import { db } from '../app/lib/db';

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runId = arg('--run-id');
  const reason = arg('--reason')?.trim();
  const username = arg('--admin') ?? 'data-admin';
  if (!runId || !reason) throw new Error('用法：--run-id <id> --reason <原因> [--admin data-admin]');
  const [run, admin] = await Promise.all([
    db.bootstrapGenerationRun.findUnique({ where: { id: runId }, include: { cases: { include: { finalizedTurn: true, reviewTasks: true, _count: { select: { candidates: true } } } } } }),
    db.user.findFirst({ where: { username, role: 'admin', isActive: true } }),
  ]);
  if (!run || run.kind !== 'CASE_COMPILATION' || !run.parametersJson.includes('"profile":"TRIAL_36"')) throw new Error('run 不存在或不是 Trial 36 编译 run');
  if (!admin) throw new Error(`找不到有效管理员：${username}`);
  if (run.cases.some((item) => item.finalizedTurn || item.reviewTasks.some((task) => task.status === 'SUBMITTED'))) {
    throw new Error('已有最终记录或已提交审核的 Trial run 不允许整体 supersede');
  }
  const preservedCandidates = run.cases.reduce((sum, item) => sum + item._count.candidates, 0);
  await db.$transaction([
    db.tutorTurnCase.updateMany({ where: { generationRunId: runId, status: { not: 'SUPERSEDED' } }, data: { status: 'SUPERSEDED' } }),
    db.tutorReviewTask.updateMany({ where: { case: { generationRunId: runId }, status: { in: ['PENDING', 'RETURNED', 'IN_PROGRESS'] } }, data: { status: 'SUPERSEDED', assignedToId: null, leaseExpiresAt: null } }),
    db.bootstrapGenerationRun.update({ where: { id: runId }, data: { status: 'SUPERSEDED', failureReason: reason } }),
    db.dataLabAuditLog.create({ data: {
      actorId: admin.id,
      action: 'TUTOR_TRIAL_RUN_SUPERSEDED',
      entityType: 'BootstrapGenerationRun',
      entityId: runId,
      payloadJson: JSON.stringify({ reason, cases: run.cases.length, preservedCandidates }),
    } }),
  ]);
  console.log(JSON.stringify({ runId, status: 'SUPERSEDED', cases: run.cases.length, preservedCandidates, reason }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
