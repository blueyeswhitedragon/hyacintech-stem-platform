#!/usr/bin/env tsx
import './load-script-env';
import { db } from '../app/lib/db';

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseReasons(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function main() {
  const runId = arg('run-id');
  const adminUsername = arg('admin') ?? 'data-admin';
  if (!runId) throw new Error('用法：npx tsx scripts/mark-tutor-calibration-run.ts --run-id <id> [--admin data-admin]');
  const [run, admin] = await Promise.all([
    db.bootstrapGenerationRun.findUnique({ where: { id: runId } }),
    db.user.findUnique({ where: { username: adminUsername } }),
  ]);
  if (!run || run.kind !== 'CASE_COMPILATION') throw new Error('run 不存在或不是案例编译 run');
  if (!admin || admin.role !== 'admin' || !admin.isActive) throw new Error('需要有效管理员账号');
  const cases = await db.tutorTurnCase.findMany({ where: { generationRunId: runId }, include: { finalizedTurn: true } });
  if (!cases.length) throw new Error('run 中没有 TutorTurnCase');
  const finalized = cases.flatMap((item) => item.finalizedTurn ? [item.finalizedTurn] : []);
  await db.$transaction(async (tx) => {
    await tx.tutorTurnCase.updateMany({
      where: { generationRunId: runId, status: { in: ['READY', 'NEEDS_REGEN', 'NEEDS_CRITIC'] } },
      data: { status: 'SUPERSEDED' },
    });
    await tx.bootstrapGenerationRun.update({ where: { id: runId }, data: { status: 'SUPERSEDED' } });
    for (const turn of finalized) {
      const reasons = [...new Set([...parseReasons(turn.eligibilityReasonJson), 'V1_CALIBRATION_ONLY'])];
      await tx.finalizedTutorTurn.update({
        where: { id: turn.id },
        data: { trainingEligibility: 'MONITORING_ONLY', eligibilityReasonJson: JSON.stringify(reasons) },
      });
    }
    await tx.dataLabAuditLog.create({
      data: {
        actorId: admin.id,
        action: 'TUTOR_CALIBRATION_RUN_MARKED_MONITORING_ONLY',
        entityType: 'BootstrapGenerationRun',
        entityId: runId,
        payloadJson: JSON.stringify({
          supersededUnfinishedCases: cases.filter((item) => ['READY', 'NEEDS_REGEN', 'NEEDS_CRITIC'].includes(item.status)).length,
          monitoringOnlyFinalizedTurns: finalized.length,
          reason: 'Prompt v1 calibration/regression evidence only',
        }),
      },
    });
  });
  console.log(JSON.stringify({ runId, cases: cases.length, finalized: finalized.length, status: 'MONITORING_ONLY_CALIBRATION' }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
