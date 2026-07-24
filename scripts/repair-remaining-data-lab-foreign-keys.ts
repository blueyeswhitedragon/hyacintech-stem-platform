#!/usr/bin/env tsx
import './load-script-env';

import type { Prisma, PrismaClient } from '@prisma/client';
import { db } from '../app/lib/db';

const VERIFIED_BACKUP = {
  path: 'backups/dev-2026-07-19T16-08-49-758Z.bak',
  sha256: '957dd83bdafe1ca1f2c71e47ea4913f467d774a0d48dc8cb139316a95b293a6c',
} as const;

const EXPECTED = {
  violations: 34,
  candidateViolations: 24,
  reviewTaskViolations: 6,
  reviewDecisionViolations: 2,
  topicCardViolations: 2,
  reviewDecisionId: '3edabb9e-a6b5-4d0f-94e0-2845ccaba4fa',
  topicCards: [
    '0812f3df-bb3b-4c1a-b1a8-ee4be234e42e',
    'f6c33d0f-c2d2-482b-89d2-718e8b70f90c',
  ],
  missingTopicSourceCandidate: '407d794f-c0f7-47c1-816d-2456d214e3a1',
} as const;

type Client = PrismaClient | Prisma.TransactionClient;
type ForeignKeyViolation = { table: string; rowid: bigint; parent: string; fkid: bigint };
type IdRow = { id: string };

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string) {
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

async function orphanIds(client: Client, table: 'TutorCandidate' | 'TutorReviewTask' | 'ReviewDecision' | 'TopicCard') {
  return client.$queryRawUnsafe<IdRow[]>(`
    SELECT DISTINCT child.id
    FROM "${table}" child
    JOIN pragma_foreign_key_check fk ON fk.rowid = child.rowid
    WHERE fk."table" = '${table}'
    ORDER BY child.id
  `);
}

async function loadSnapshot(client: Client, username: string) {
  const [
    actor,
    violations,
    candidateIdRows,
    reviewTaskIdRows,
    decisionIdRows,
    topicCardIdRows,
  ] = await Promise.all([
    client.user.findFirst({ where: { username }, select: { id: true, username: true, role: true, isActive: true } }),
    client.$queryRawUnsafe<ForeignKeyViolation[]>('PRAGMA foreign_key_check'),
    orphanIds(client, 'TutorCandidate'),
    orphanIds(client, 'TutorReviewTask'),
    orphanIds(client, 'ReviewDecision'),
    orphanIds(client, 'TopicCard'),
  ]);

  const candidateIds = candidateIdRows.map((row) => row.id);
  const reviewTaskIds = reviewTaskIdRows.map((row) => row.id);
  const decisionIds = decisionIdRows.map((row) => row.id);
  const topicCardIds = topicCardIdRows.map((row) => row.id);
  const reviewDecision = decisionIds.length === 1
    ? await client.reviewDecision.findUnique({ where: { id: decisionIds[0] } })
    : null;
  const [
    candidates,
    candidateCaseCount,
    candidateReviewReferences,
    candidateFinalizedReferences,
    reviewTasks,
    reviewTaskCaseCount,
    reviewTaskAuditReferences,
    reviewDecisionCase,
    reviewDecisionSelectedRevision,
    reviewDecisionAuditReferences,
    topicCards,
    topicSourceCandidate,
  ] = await Promise.all([
    client.tutorCandidate.findMany({ where: { id: { in: candidateIds } }, select: { id: true, caseId: true, generationRunId: true, slot: true, status: true, createdAt: true } }),
    client.tutorTurnCase.count({ where: { id: { in: candidateIds.length ? (await client.tutorCandidate.findMany({ where: { id: { in: candidateIds } }, select: { caseId: true } })).map((row) => row.caseId) : [] } } }),
    client.tutorReviewTask.count({ where: { OR: [{ selectedCandidateId: { in: candidateIds } }, { preferenceRejectedCandidateId: { in: candidateIds } }] } }),
    client.finalizedTutorTurn.count({ where: { OR: [{ selectedCandidateId: { in: candidateIds } }, { preferenceRejectedCandidateId: { in: candidateIds } }] } }),
    client.tutorReviewTask.findMany({ where: { id: { in: reviewTaskIds } }, select: { id: true, caseId: true, type: true, status: true, assignedToId: true, operatorId: true, decision: true, selectedCandidateId: true, preferenceRejectedCandidateId: true, submittedAt: true } }),
    client.tutorTurnCase.count({ where: { id: { in: reviewTaskIds.length ? (await client.tutorReviewTask.findMany({ where: { id: { in: reviewTaskIds } }, select: { caseId: true } })).map((row) => row.caseId) : [] } } }),
    client.dataLabAuditLog.count({ where: { entityId: { in: reviewTaskIds } } }),
    reviewDecision ? client.reviewCase.count({ where: { id: reviewDecision.reviewCaseId } }) : Promise.resolve(-1),
    reviewDecision?.selectedRevisionId ? client.annotationRevision.count({ where: { id: reviewDecision.selectedRevisionId } }) : Promise.resolve(-1),
    client.dataLabAuditLog.count({ where: { entityId: { in: decisionIds } } }),
    client.topicCard.findMany({ where: { id: { in: topicCardIds } }, select: { id: true, displayTitle: true, status: true, schemaVersion: true, sourceCandidateId: true, revisionOfId: true, _count: { select: { cases: true, revisions: true } } } }),
    client.topicSourceCandidate.count({ where: { id: EXPECTED.missingTopicSourceCandidate } }),
  ]);

  return {
    actor,
    violations,
    candidateIds,
    reviewTaskIds,
    decisionIds,
    topicCardIds,
    candidates,
    candidateCaseCount,
    candidateReviewReferences,
    candidateFinalizedReferences,
    reviewTasks,
    reviewTaskCaseCount,
    reviewTaskAuditReferences,
    reviewDecision,
    reviewDecisionCase,
    reviewDecisionSelectedRevision,
    reviewDecisionAuditReferences,
    topicCards,
    topicSourceCandidate,
  };
}

function violationCount(snapshot: Awaited<ReturnType<typeof loadSnapshot>>, table: string) {
  return snapshot.violations.filter((item) => item.table === table).length;
}

function assertExpected(snapshot: Awaited<ReturnType<typeof loadSnapshot>>) {
  invariant(snapshot.actor?.role === 'admin' && snapshot.actor.isActive, 'actor must be an active admin');
  invariant(snapshot.violations.length === EXPECTED.violations, `expected ${EXPECTED.violations} total violations, found ${snapshot.violations.length}`);
  invariant(violationCount(snapshot, 'TutorCandidate') === EXPECTED.candidateViolations, 'TutorCandidate violation count changed');
  invariant(violationCount(snapshot, 'TutorReviewTask') === EXPECTED.reviewTaskViolations, 'TutorReviewTask violation count changed');
  invariant(violationCount(snapshot, 'ReviewDecision') === EXPECTED.reviewDecisionViolations, 'ReviewDecision violation count changed');
  invariant(violationCount(snapshot, 'TopicCard') === EXPECTED.topicCardViolations, 'TopicCard violation count changed');
  invariant(new Set(snapshot.violations.map((item) => item.table)).size === 4, 'an unexpected table now has foreign-key violations');

  invariant(snapshot.candidateIds.length === EXPECTED.candidateViolations && snapshot.candidates.length === EXPECTED.candidateViolations, 'orphan candidate IDs could not be resolved exactly');
  invariant(snapshot.candidates.every((candidate) => candidate.generationRunId && ['A', 'B'].includes(candidate.slot)), 'an orphan candidate has unexpected lineage fields');
  invariant(snapshot.candidateCaseCount === 0, 'an orphan candidate case now exists');
  invariant(snapshot.candidateReviewReferences === 0, 'an orphan candidate is referenced by a review task');
  invariant(snapshot.candidateFinalizedReferences === 0, 'an orphan candidate is referenced by a finalized turn');

  invariant(snapshot.reviewTaskIds.length === EXPECTED.reviewTaskViolations && snapshot.reviewTasks.length === EXPECTED.reviewTaskViolations, 'orphan review task IDs could not be resolved exactly');
  invariant(snapshot.reviewTasks.every((task) => task.type === 'EDIT' && task.status === 'PENDING' && !task.assignedToId && !task.operatorId && !task.decision && !task.selectedCandidateId && !task.preferenceRejectedCandidateId && !task.submittedAt), 'an orphan review task is no longer an untouched PENDING EDIT task');
  invariant(snapshot.reviewTaskCaseCount === 0, 'an orphan review task case now exists');
  invariant(snapshot.reviewTaskAuditReferences === 0, 'an orphan review task now has audit history');

  invariant(sameIds(snapshot.decisionIds, [EXPECTED.reviewDecisionId]), 'unexpected ReviewDecision orphan');
  invariant(snapshot.reviewDecision?.action === 'SELECT' && snapshot.reviewDecision.reason.includes('集成测试'), 'orphan ReviewDecision is not the verified integration-test record');
  invariant(snapshot.reviewDecisionCase === 0 && snapshot.reviewDecisionSelectedRevision === 0, 'ReviewDecision parent unexpectedly exists');
  invariant(snapshot.reviewDecisionAuditReferences === 1, 'ReviewDecision audit reference count changed');

  invariant(sameIds(snapshot.topicCardIds, EXPECTED.topicCards), 'unexpected TopicCard orphan');
  invariant(snapshot.topicSourceCandidate === 0, 'missing TopicSourceCandidate unexpectedly exists');
  invariant(snapshot.topicCards.length === 2 && snapshot.topicCards.every((card) => card.schemaVersion === 2 && card.sourceCandidateId === EXPECTED.missingTopicSourceCandidate), 'TopicCard source lineage changed');
  const approved = snapshot.topicCards.find((card) => card.id === EXPECTED.topicCards[1]);
  const superseded = snapshot.topicCards.find((card) => card.id === EXPECTED.topicCards[0]);
  invariant(approved?.status === 'APPROVED' && approved._count.cases === 2, 'approved TopicCard no longer has the verified two case references');
  invariant(superseded?.status === 'SUPERSEDED' && superseded._count.revisions === 1, 'superseded TopicCard revision lineage changed');
}

async function main() {
  const username = arg('--actor');
  if (!username) throw new Error('Usage: npx tsx scripts/repair-remaining-data-lab-foreign-keys.ts --actor <admin> [--apply]');

  const initial = await loadSnapshot(db, username);
  assertExpected(initial);
  if (!hasFlag('--apply')) {
    console.log(json({
      dryRun: true,
      actor: initial.actor,
      verifiedBackup: VERIFIED_BACKUP,
      plan: {
        deleteTutorCandidates: initial.candidateIds.length,
        deleteUntouchedTutorReviewTasks: initial.reviewTaskIds.length,
        deleteIntegrationTestReviewDecision: initial.decisionIds,
        disconnectMissingTopicSourceCandidate: initial.topicCards.map((card) => ({ id: card.id, title: card.displayTitle, status: card.status, caseReferences: card._count.cases })),
      },
      expectedForeignKeyViolationsAfter: 0,
    }));
    return;
  }

  const result = await db.$transaction(async (tx) => {
    const before = await loadSnapshot(tx, username);
    assertExpected(before);

    const deletedTasks = await tx.tutorReviewTask.deleteMany({ where: { id: { in: before.reviewTaskIds } } });
    const deletedCandidates = await tx.tutorCandidate.deleteMany({ where: { id: { in: before.candidateIds } } });
    const deletedDecision = await tx.reviewDecision.deleteMany({ where: { id: { in: before.decisionIds } } });
    const disconnectedCards = await tx.topicCard.updateMany({ where: { id: { in: before.topicCardIds }, sourceCandidateId: EXPECTED.missingTopicSourceCandidate }, data: { sourceCandidateId: null } });

    invariant(deletedTasks.count === EXPECTED.reviewTaskViolations, 'review task deletion count changed inside transaction');
    invariant(deletedCandidates.count === EXPECTED.candidateViolations, 'candidate deletion count changed inside transaction');
    invariant(deletedDecision.count === 1, 'ReviewDecision deletion count changed inside transaction');
    invariant(disconnectedCards.count === EXPECTED.topicCards.length, 'TopicCard disconnect count changed inside transaction');

    const remaining = await tx.$queryRawUnsafe<ForeignKeyViolation[]>('PRAGMA foreign_key_check');
    invariant(remaining.length === 0, `transaction would leave ${remaining.length} foreign-key violations`);

    await tx.dataLabAuditLog.create({ data: {
      actorId: before.actor!.id,
      action: 'EMERGENCY_REMAINING_FOREIGN_KEYS_REPAIRED',
      entityType: 'DatabaseIntegrityRepair',
      entityId: EXPECTED.reviewDecisionId,
      payloadJson: JSON.stringify({
        reason: 'Removed records whose required parents no longer existed and disconnected two valid TopicCards from a missing optional TopicSourceCandidate.',
        verifiedBackup: VERIFIED_BACKUP,
        deletedTutorCandidateIds: before.candidateIds,
        deletedTutorReviewTaskIds: before.reviewTaskIds,
        deletedReviewDecisionIds: before.decisionIds,
        disconnectedTopicCards: before.topicCards.map((card) => ({ id: card.id, title: card.displayTitle, status: card.status, previousSourceCandidateId: card.sourceCandidateId })),
        foreignKeyViolationsBefore: before.violations.length,
        foreignKeyViolationsAfter: remaining.length,
      }),
    } });

    return {
      deletedCandidates: deletedCandidates.count,
      deletedReviewTasks: deletedTasks.count,
      deletedReviewDecisions: deletedDecision.count,
      disconnectedTopicCards: disconnectedCards.count,
    };
  }, { timeout: 30_000 });

  const [violations, audit] = await Promise.all([
    db.$queryRawUnsafe<ForeignKeyViolation[]>('PRAGMA foreign_key_check'),
    db.dataLabAuditLog.findFirst({ where: { action: 'EMERGENCY_REMAINING_FOREIGN_KEYS_REPAIRED' }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } }),
  ]);
  invariant(violations.length === 0, 'postflight foreign-key check is not clean');
  console.log(json({ applied: true, actor: username, verifiedBackup: VERIFIED_BACKUP, result, foreignKeyViolations: violations.length, audit }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
