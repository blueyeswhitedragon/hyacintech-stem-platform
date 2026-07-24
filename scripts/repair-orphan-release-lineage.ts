#!/usr/bin/env tsx
import './load-script-env';

import type { Prisma, PrismaClient } from '@prisma/client';
import { db } from '../app/lib/db';

const IDS = {
  pilotRelease: '6a44008c-06ed-4fdd-a36c-44c32bdfe334',
  pilotTrainingRun: '45707f78-9da4-4cd8-af9c-48425282f10d',
  testRelease: '10d806de-4a76-408f-9e60-03a9e89ba5a2',
  testTrainingRun: 'f7d3e31c-53d5-4c43-a104-940d795a9ff7',
  realModel: 'fdbebc64-c1ae-454a-bf75-a36e52ef13ff',
  realDeployment: 'e59e7921-0b55-4407-97cd-1145acceeb49',
  testBaselineModel: 'b72410d9-4556-461a-b7ee-d10a682ad3d4',
  testCandidateModel: 'c1ebcc20-af8f-4552-a507-69fa71eeff72',
  testEvaluation: '8d0d57d7-59fd-42e0-81aa-57197899d668',
  testDeployments: [
    '9103a6b1-176c-427e-8683-2605afb043f4',
    '8ef58846-6d6b-4b9f-9ec2-3e5a2ec754d9',
    'cb1333bf-3de8-45e1-9110-0afa56e2b312',
    '4c8dfb61-cd67-4c75-9000-cb933b1d640e',
  ],
  activeTestDeployment: '4c8dfb61-cd67-4c75-9000-cb933b1d640e',
} as const;

const VERIFIED_BACKUP = {
  path: 'backups/dev-2026-07-19T14-16-31-692Z.bak',
  sha256: '5ac1ff3d6c3a06da74a42c1cbc17a3767dc12a751efa21b71cb5d54dd5e07864',
} as const;

type Client = PrismaClient | Prisma.TransactionClient;
type ForeignKeyViolation = { table: string; rowid: bigint; parent: string; fkid: bigint };

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Preflight refused repair: ${message}`);
}

function sorted(values: string[]) {
  return [...values].sort();
}

function sameIds(actual: string[], expected: readonly string[]) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted([...expected]));
}

function json(value: unknown) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? Number(item) : item, 2);
}

async function loadSnapshot(client: Client, username: string) {
  const testModelIds = [IDS.testBaselineModel, IDS.testCandidateModel];
  const [
    actor,
    releases,
    trainingRuns,
    models,
    deployments,
    modelDeploymentReferences,
    evaluation,
    evaluationArtifacts,
    evaluationReferences,
    activeDeployments,
    testConversationCount,
    testTraceCount,
    foreignKeyViolations,
  ] = await Promise.all([
    client.user.findFirst({ where: { username }, select: { id: true, username: true, role: true, isActive: true } }),
    client.datasetRelease.findMany({ where: { id: { in: [IDS.pilotRelease, IDS.testRelease] } }, select: { id: true, version: true, status: true } }),
    client.trainingRun.findMany({ where: { id: { in: [IDS.pilotTrainingRun, IDS.testTrainingRun] } }, select: { id: true, name: true, releaseId: true, status: true, parentModelVersionId: true } }),
    client.modelVersion.findMany({ where: { id: { in: [IDS.realModel, ...testModelIds] } }, select: { id: true, tag: true, provider: true, externalModelId: true, status: true, trainingRunId: true, parentModelVersionId: true } }),
    client.modelDeployment.findMany({ where: { id: { in: [IDS.realDeployment, ...IDS.testDeployments] } }, select: { id: true, modelVersionId: true, previousModelVersionId: true, status: true, rolloutPercent: true, evaluationRunId: true, endedAt: true } }),
    client.modelDeployment.findMany({ where: { OR: [{ modelVersionId: { in: testModelIds } }, { previousModelVersionId: { in: testModelIds } }] }, select: { id: true } }),
    client.evaluationRun.findUnique({ where: { id: IDS.testEvaluation }, select: { id: true, name: true, modelAVersionId: true, modelBVersionId: true, gateResult: true } }),
    client.evaluationArtifact.count({ where: { runId: IDS.testEvaluation } }),
    client.evaluationRun.findMany({ where: { OR: [{ modelAVersionId: { in: testModelIds } }, { modelBVersionId: { in: testModelIds } }] }, select: { id: true } }),
    client.modelDeployment.findMany({ where: { environment: 'PRODUCTION', status: 'ACTIVE' }, select: { id: true, modelVersionId: true, rolloutPercent: true } }),
    client.conversation.count({ where: { deployedModelVersionId: { in: testModelIds } } }),
    client.generationTrace.count({ where: { modelVersionId: { in: testModelIds } } }),
    client.$queryRawUnsafe<ForeignKeyViolation[]>('PRAGMA foreign_key_check'),
  ]);

  return {
    actor,
    releases,
    trainingRuns,
    models,
    deployments,
    modelDeploymentReferences,
    evaluation,
    evaluationArtifacts,
    evaluationReferences,
    activeDeployments,
    testConversationCount,
    testTraceCount,
    foreignKeyViolations,
  };
}

function assertExpectedBefore(snapshot: Awaited<ReturnType<typeof loadSnapshot>>) {
  invariant(snapshot.actor?.role === 'admin' && snapshot.actor.isActive, 'actor must be an active admin');
  invariant(snapshot.releases.length === 0, 'the two unwanted releases must still be absent');

  const pilotRun = snapshot.trainingRuns.find((run) => run.id === IDS.pilotTrainingRun);
  const testRun = snapshot.trainingRuns.find((run) => run.id === IDS.testTrainingRun);
  invariant(pilotRun?.name === 'pilot-training-run' && pilotRun.releaseId === IDS.pilotRelease && pilotRun.status === 'DRAFT', 'pilot TrainingRun no longer matches the verified orphan');
  invariant(testRun?.name === 'training-644c8bb9' && testRun.releaseId === IDS.testRelease && testRun.status === 'SUCCEEDED' && testRun.parentModelVersionId === IDS.testBaselineModel, 'test TrainingRun no longer matches the verified orphan');

  const realModel = snapshot.models.find((model) => model.id === IDS.realModel);
  const baseline = snapshot.models.find((model) => model.id === IDS.testBaselineModel);
  const candidate = snapshot.models.find((model) => model.id === IDS.testCandidateModel);
  invariant(realModel?.provider === 'deepseek' && realModel.externalModelId === 'deepseek-v4-pro', 'real DeepSeek model identity changed');
  invariant(baseline?.tag === 'baseline-644c8bb9' && baseline.trainingRunId === null, 'test baseline model identity changed');
  invariant(candidate?.tag === 'candidate-644c8bb9' && candidate.trainingRunId === IDS.testTrainingRun && candidate.parentModelVersionId === IDS.testBaselineModel, 'test candidate model identity changed');

  invariant(sameIds(snapshot.deployments.map((deployment) => deployment.id), [IDS.realDeployment, ...IDS.testDeployments]), 'expected deployment rows are missing');
  invariant(sameIds(snapshot.modelDeploymentReferences.map((deployment) => deployment.id), IDS.testDeployments), 'unexpected deployments still reference test models');
  invariant(snapshot.activeDeployments.length === 1 && snapshot.activeDeployments[0].id === IDS.activeTestDeployment && snapshot.activeDeployments[0].modelVersionId === IDS.testCandidateModel && snapshot.activeDeployments[0].rolloutPercent === 100, 'ACTIVE production deployment changed');
  const realDeployment = snapshot.deployments.find((deployment) => deployment.id === IDS.realDeployment);
  invariant(realDeployment?.modelVersionId === IDS.realModel && realDeployment.status === 'COMPLETED' && realDeployment.rolloutPercent === 100, 'real DeepSeek deployment no longer matches rollback target');

  invariant(snapshot.evaluation?.name === 'evaluation-644c8bb9' && snapshot.evaluation.modelAVersionId === IDS.testBaselineModel && snapshot.evaluation.modelBVersionId === IDS.testCandidateModel, 'test evaluation identity changed');
  invariant(snapshot.evaluationArtifacts === 3, 'test evaluation must still have exactly three artifacts');
  invariant(sameIds(snapshot.evaluationReferences.map((evaluation) => evaluation.id), [IDS.testEvaluation]), 'unexpected evaluations reference test models');
  invariant(snapshot.testConversationCount === 0, 'a conversation is now bound to a test model');
  invariant(snapshot.testTraceCount === 0, 'a GenerationTrace is now bound to a test model');

  const trainingRunViolations = snapshot.foreignKeyViolations.filter((item) => item.table === 'TrainingRun');
  invariant(trainingRunViolations.length === 2, 'expected exactly two TrainingRun foreign-key violations');
}

async function afterSummary() {
  const [activeDeployments, removedRuns, removedModels, removedDeployments, removedEvaluation, foreignKeyViolations] = await Promise.all([
    db.modelDeployment.findMany({ where: { environment: 'PRODUCTION', status: 'ACTIVE' }, select: { id: true, modelVersionId: true, rolloutPercent: true } }),
    db.trainingRun.count({ where: { id: { in: [IDS.pilotTrainingRun, IDS.testTrainingRun] } } }),
    db.modelVersion.count({ where: { id: { in: [IDS.testBaselineModel, IDS.testCandidateModel] } } }),
    db.modelDeployment.count({ where: { id: { in: [...IDS.testDeployments] } } }),
    db.evaluationRun.count({ where: { id: IDS.testEvaluation } }),
    db.$queryRawUnsafe<ForeignKeyViolation[]>('PRAGMA foreign_key_check'),
  ]);
  return { activeDeployments, removedRuns, removedModels, removedDeployments, removedEvaluation, foreignKeyViolations };
}

async function main() {
  const username = arg('--actor');
  if (!username) throw new Error('Usage: npx tsx scripts/repair-orphan-release-lineage.ts --actor <admin> [--apply]');

  const initial = await loadSnapshot(db, username);
  assertExpectedBefore(initial);
  if (!hasFlag('--apply')) {
    console.log(json({
      dryRun: true,
      actor: initial.actor,
      verifiedBackup: VERIFIED_BACKUP,
      actions: [
        `Delete test deployments: ${IDS.testDeployments.join(', ')}`,
        `Reactivate real DeepSeek deployment: ${IDS.realDeployment}`,
        `Delete test evaluation and 3 artifacts: ${IDS.testEvaluation}`,
        `Delete test candidate, training run, and baseline: ${IDS.testCandidateModel}, ${IDS.testTrainingRun}, ${IDS.testBaselineModel}`,
        `Delete orphan pilot TrainingRun: ${IDS.pilotTrainingRun}`,
      ],
      currentForeignKeyViolations: initial.foreignKeyViolations.length,
      expectedRemainingForeignKeyViolations: initial.foreignKeyViolations.length - 2,
    }));
    return;
  }

  const result = await db.$transaction(async (tx) => {
    const before = await loadSnapshot(tx, username);
    assertExpectedBefore(before);

    const deletedDeployments = await tx.modelDeployment.deleteMany({ where: { id: { in: [...IDS.testDeployments] } } });
    invariant(deletedDeployments.count === IDS.testDeployments.length, 'test deployment deletion count changed inside transaction');
    await tx.modelDeployment.update({ where: { id: IDS.realDeployment }, data: { status: 'ACTIVE', endedAt: null, rolloutPercent: 100 } });
    await tx.modelVersion.update({ where: { id: IDS.realModel }, data: { status: 'DEPLOYED' } });

    const deletedArtifacts = await tx.evaluationArtifact.deleteMany({ where: { runId: IDS.testEvaluation } });
    invariant(deletedArtifacts.count === 3, 'test evaluation artifact deletion count changed inside transaction');
    await tx.evaluationRun.delete({ where: { id: IDS.testEvaluation } });
    await tx.modelVersion.delete({ where: { id: IDS.testCandidateModel } });
    await tx.trainingRun.delete({ where: { id: IDS.testTrainingRun } });
    await tx.modelVersion.delete({ where: { id: IDS.testBaselineModel } });
    await tx.trainingRun.delete({ where: { id: IDS.pilotTrainingRun } });

    await tx.dataLabAuditLog.create({ data: {
      actorId: before.actor!.id,
      action: 'EMERGENCY_ORPHAN_RELEASE_LINEAGE_CLEANED',
      entityType: 'DatabaseIntegrityRepair',
      entityId: IDS.realDeployment,
      payloadJson: JSON.stringify({
        reason: 'Removed two unwanted release lineages after their DatasetRelease rows were deleted out of band; restored the verified real DeepSeek deployment.',
        verifiedBackup: VERIFIED_BACKUP,
        removed: {
          releasesAlreadyAbsent: [IDS.pilotRelease, IDS.testRelease],
          trainingRuns: [IDS.pilotTrainingRun, IDS.testTrainingRun],
          modelVersions: [IDS.testBaselineModel, IDS.testCandidateModel],
          modelDeployments: IDS.testDeployments,
          evaluationRun: IDS.testEvaluation,
          evaluationArtifacts: deletedArtifacts.count,
        },
        activated: { modelVersionId: IDS.realModel, deploymentId: IDS.realDeployment, rolloutPercent: 100 },
        foreignKeyViolationsBefore: before.foreignKeyViolations.length,
      }),
    } });

    return { deletedDeployments: deletedDeployments.count, deletedArtifacts: deletedArtifacts.count };
  }, { timeout: 30_000 });

  const after = await afterSummary();
  invariant(after.activeDeployments.length === 1 && after.activeDeployments[0].id === IDS.realDeployment && after.activeDeployments[0].modelVersionId === IDS.realModel, 'postflight ACTIVE deployment is not the verified real DeepSeek deployment');
  invariant(after.removedRuns === 0 && after.removedModels === 0 && after.removedDeployments === 0 && after.removedEvaluation === 0, 'postflight found a supposedly removed record');
  invariant(after.foreignKeyViolations.every((item) => item.table !== 'TrainingRun'), 'postflight still has TrainingRun foreign-key violations');

  console.log(json({
    applied: true,
    actor: username,
    verifiedBackup: VERIFIED_BACKUP,
    result,
    activeDeployment: after.activeDeployments[0],
    foreignKeyViolations: { before: initial.foreignKeyViolations.length, after: after.foreignKeyViolations.length },
  }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
