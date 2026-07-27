import type { Prisma, PrismaClient } from '@prisma/client';
import { checkTutorCandidate, resolveTutorCaseAllowedFocusIds, sha256 } from './bootstrap/contracts';

export const PRODUCTION_FOCUS_REPAIR_ID = 'production-focus-fallback-2026-07-28';

export interface ProductionFocusRepairCandidateSpec {
  id: string;
  slot: 'A' | 'B';
  rawSha256: string;
  runtimeBundleId: string | null;
  shouldRevalidate: boolean;
}

export interface ProductionFocusRepairTaskSpec {
  id: string;
  type: 'EDIT' | 'CASE';
  status: string;
  reason: string;
  caseIssueJson: string;
  assignedToId: string | null;
  operatorId: string | null;
  decision: string;
  submitted: boolean;
}

export interface ProductionFocusRepairCaseSpec {
  id: string;
  mode: 'REVALIDATE' | 'REGENERATE';
  expectedStatus: string;
  phase: number;
  focusIds: string[];
  promptSha256: string;
  sourceRunId: string;
  candidates: ProductionFocusRepairCandidateSpec[];
  tasks: ProductionFocusRepairTaskSpec[];
}

export interface ProductionFocusRepairSpec {
  repairId: string;
  cases: ProductionFocusRepairCaseSpec[];
}

const RETURNED_BY_ID = '1e294d85-93b0-4280-9a25-a3f80eeeaeb2';
const RUNTIME_A = '5d5686ad-f449-4715-be21-7a864e0f4f1a';
const RUNTIME_B = '5ec5ef60-97ed-42d9-84b7-07f60ab27de2';

export const PRODUCTION_FOCUS_REPAIR_SPEC: ProductionFocusRepairSpec = {
  repairId: PRODUCTION_FOCUS_REPAIR_ID,
  cases: [
    {
      id: '0f5646fc-de33-4426-a7da-49b260faf98b',
      mode: 'REVALIDATE', expectedStatus: 'IN_REVIEW', phase: 2, focusIds: ['dependent_variable'],
      promptSha256: '2ed845350926d73672d3f4df9aabadca07f1909ba9558e425d3fdc5b7e4cf3a8',
      sourceRunId: '2214c2f9-7fef-4fea-a51f-514583001359',
      candidates: [
        { id: '4dd48f17-15b9-4719-ba74-aa68319e5745', slot: 'A', rawSha256: 'b497da6cffe09e3a117841616cccebd904bd76c2d0d739459d53ce7e8c0ecd0c', runtimeBundleId: RUNTIME_A, shouldRevalidate: true },
        { id: '3c867c81-7e21-444b-bca7-fc80c2c147ea', slot: 'B', rawSha256: 'dbdecf4b4081b2faccda40e8c5028289489f31487db40fbde7ef824557e3011c', runtimeBundleId: RUNTIME_B, shouldRevalidate: true },
      ],
      tasks: [
        { id: '8c73a98d-5dc5-48c8-bfc4-51595f03a811', type: 'EDIT', status: 'PENDING', reason: '', caseIssueJson: '{}', assignedToId: null, operatorId: null, decision: '', submitted: false },
      ],
    },
    {
      id: '1ff42e23-3ad5-471c-9809-e1e2d45d4d7c',
      mode: 'REVALIDATE', expectedStatus: 'IN_REVIEW', phase: 1, focusIds: ['direction_confirmation'],
      promptSha256: '1bb053e0d47b78ae092a0b6426e4d0ee5dc3c89932ff6d4378409a7306ef3376',
      sourceRunId: 'bc49599f-6c7e-4e22-86ab-db70705adbaa',
      candidates: [
        { id: '6aafdb83-d392-4eee-b4b4-f7bdd01ba518', slot: 'A', rawSha256: '226d2bf2fce67646764dbf222fcb15de6baedcc58231e0ecc553fb56ec157857', runtimeBundleId: RUNTIME_A, shouldRevalidate: true },
        { id: '33fb2e7c-c911-4bd2-992f-2d56427dfdfb', slot: 'B', rawSha256: '23f44a57c9bef64844e3b11f5cf2614d60d02d67828f7bd4e7da48163df40a02', runtimeBundleId: RUNTIME_B, shouldRevalidate: true },
      ],
      tasks: [
        { id: 'd16f55c3-4092-4fcf-aaf1-06fb2c463ab3', type: 'EDIT', status: 'PENDING', reason: '', caseIssueJson: '{}', assignedToId: null, operatorId: null, decision: '', submitted: false },
      ],
    },
    {
      id: '33b990b4-21b2-44f1-9bc2-4a83263d3d2a',
      mode: 'REVALIDATE', expectedStatus: 'IN_REVIEW', phase: 4, focusIds: ['interpret_evidence'],
      promptSha256: '1aecc5fe5cb12e860b68dff5244b465a091e4bf6b1f20e9adc026c5e7ffac7d1',
      sourceRunId: '8b409223-0024-424f-808b-644ac5ade56f',
      candidates: [
        { id: 'fd177ef2-9927-465d-810c-8a0e1e10b76c', slot: 'A', rawSha256: '977aa59096aa430b745b86828c2a58f7a3b1ebb421ae8380bd1018bd42fb0e8f', runtimeBundleId: RUNTIME_A, shouldRevalidate: true },
        { id: 'c0459ba4-99a7-48a9-81f6-2169d7fcebbc', slot: 'B', rawSha256: '6bef8f0267a9883daaf66b0e6c3f70734cd47cc7fb7c98f3a016346db12df832', runtimeBundleId: RUNTIME_B, shouldRevalidate: true },
      ],
      tasks: [
        { id: 'e57f6391-42d3-4da4-bdb7-50df8e55140d', type: 'EDIT', status: 'PENDING', reason: '', caseIssueJson: '{}', assignedToId: null, operatorId: null, decision: '', submitted: false },
      ],
    },
    {
      id: '963c8031-89be-4bb3-a111-2a10311484c3',
      mode: 'REVALIDATE', expectedStatus: 'CASE_NEEDS_REVISION', phase: 4, focusIds: ['cite_evidence'],
      promptSha256: '43a68c707fa9e926b7b1f63c33b71caf4140e678d3a5fc94c959d04b838d4dfd',
      sourceRunId: '4da2557e-b5b3-4b71-ac71-e96963c6e79f',
      candidates: [
        { id: '68af71a0-73f7-4b7c-bdf5-b777025b5e43', slot: 'A', rawSha256: '9221f8439f5949bea1edc071ea5e533309dcc96cd2e5d9350434519789fba2eb', runtimeBundleId: RUNTIME_A, shouldRevalidate: true },
        { id: 'f31d323f-af54-493f-a4cf-baff72bf200f', slot: 'B', rawSha256: '65686b9eb8d91eab795d826c32d72b19aab9dfd1f09f474a844f02ef2db0c427', runtimeBundleId: RUNTIME_B, shouldRevalidate: true },
      ],
      tasks: [
        { id: '5ee05d30-24a1-4fec-aa5b-541324dd82a0', type: 'CASE', status: 'PENDING', reason: '无法查看', caseIssueJson: '{"categories":["OTHER"],"suggestedStudentMessage":"数据有差异","note":"无法查看"}', assignedToId: null, operatorId: null, decision: '', submitted: false },
        { id: '38093f6c-6591-418a-80b0-75e7f379a827', type: 'EDIT', status: 'RETURNED', reason: '无法查看', caseIssueJson: '{"categories":["OTHER"],"suggestedStudentMessage":"数据有差异","note":"无法查看"}', assignedToId: RETURNED_BY_ID, operatorId: RETURNED_BY_ID, decision: 'RETURN_CASE', submitted: true },
      ],
    },
    {
      id: 'de171157-6b57-410f-b64c-a2bf55e351e5',
      mode: 'REGENERATE', expectedStatus: 'CASE_NEEDS_REVISION', phase: 4, focusIds: ['interpret_evidence'],
      promptSha256: '4bc9179d8171b2c1c02b8e52257419eda53e04e61d7ab55034ff89e264d694d5',
      sourceRunId: '45676098-ecfc-41c5-9fde-adc36d5144b3',
      candidates: [
        { id: 'e958b832-2888-44a4-9916-5ae2d312750f', slot: 'A', rawSha256: 'e6185b5c6a0d57a6e09e4665240363dc8aa800172f9e4c9c58478a02377c5b15', runtimeBundleId: RUNTIME_A, shouldRevalidate: true },
        { id: 'cfea944e-117e-4aa5-844d-166725b7894c', slot: 'B', rawSha256: 'b60c4c2d565cd1f10eeb0deffdd7b65fdf9d4fd3960868da68e3533159b70bd8', runtimeBundleId: RUNTIME_B, shouldRevalidate: false },
      ],
      tasks: [
        { id: '323a5d0b-9317-4b1f-b15d-e335e8a1d995', type: 'CASE', status: 'PENDING', reason: '无法查看', caseIssueJson: '{"categories":["PHASE_MISMATCH"],"suggestedStudentMessage":"再比较第3行：12小时组12.9厘米，比8小时组的8.2厘米高出4.7厘米，三行都是同样的趋势，说明光照时间越长绿豆苗长得越高。","note":"无法查看"}', assignedToId: null, operatorId: null, decision: '', submitted: false },
        { id: 'cef53e1e-93b2-4bc4-9f7c-09abe99fc34a', type: 'EDIT', status: 'RETURNED', reason: '无法查看', caseIssueJson: '{"categories":["PHASE_MISMATCH"],"suggestedStudentMessage":"再比较第3行：12小时组12.9厘米，比8小时组的8.2厘米高出4.7厘米，三行都是同样的趋势，说明光照时间越长绿豆苗长得越高。","note":"无法查看"}', assignedToId: RETURNED_BY_ID, operatorId: RETURNED_BY_ID, decision: 'RETURN_CASE', submitted: true },
      ],
    },
  ],
};

type Client = PrismaClient | Prisma.TransactionClient;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Production focus repair refused: ${message}`);
}

function sameStrings(actual: string[], expected: string[]) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function loadSnapshot(client: Client, spec: ProductionFocusRepairSpec, username: string) {
  const caseIds = spec.cases.map((item) => item.id);
  const sourceRunIds = spec.cases.map((item) => item.sourceRunId);
  const [actor, cases, sourceRuns, summaryAudits, caseAudits] = await Promise.all([
    client.user.findFirst({ where: { username }, select: { id: true, username: true, role: true, isActive: true } }),
    client.tutorTurnCase.findMany({
      where: { id: { in: caseIds } },
      include: {
        candidates: { orderBy: [{ createdAt: 'asc' }, { slot: 'asc' }], include: { generationRun: true } },
        reviewTasks: { orderBy: [{ type: 'asc' }, { createdAt: 'asc' }] },
        finalizedTurn: { select: { id: true } },
      },
    }),
    client.bootstrapGenerationRun.findMany({ where: { id: { in: sourceRunIds } } }),
    client.dataLabAuditLog.findMany({ where: { action: 'PRODUCTION_FOCUS_REPAIR_COMPLETED', entityType: 'ProductionCandidateRepair', entityId: spec.repairId } }),
    client.dataLabAuditLog.findMany({ where: { action: { in: ['PRODUCTION_TUTOR_CASE_REVALIDATED', 'PRODUCTION_TUTOR_CASE_MARKED_FOR_REGEN'] }, entityType: 'TutorTurnCase', entityId: { in: caseIds }, payloadJson: { contains: spec.repairId } } }),
  ]);
  return { actor, cases, sourceRuns, summaryAudits, caseAudits };
}

function candidateResult(caseItem: Awaited<ReturnType<typeof loadSnapshot>>['cases'][number], candidateId: string) {
  const candidate = caseItem.candidates.find((item) => item.id === candidateId);
  invariant(candidate, `candidate ${candidateId} is missing`);
  const allowedFocusIds = resolveTutorCaseAllowedFocusIds(caseItem);
  return {
    candidate,
    checked: checkTutorCandidate({
      rawOutput: candidate.rawOutput,
      allowedFocusIds,
      phase: caseItem.phase,
      triggerType: caseItem.triggerType,
      studentMessage: caseItem.studentMessage,
    }),
  };
}

function assertPreflight(snapshot: Awaited<ReturnType<typeof loadSnapshot>>, spec: ProductionFocusRepairSpec) {
  invariant(snapshot.actor?.role === 'admin' && snapshot.actor.isActive, 'actor must be an active admin');
  invariant(snapshot.summaryAudits.length === 0, 'summary audit already exists but postflight was not selected');
  invariant(snapshot.caseAudits.length === 0, 'partial per-case repair audits already exist');
  invariant(snapshot.cases.length === spec.cases.length, `expected ${spec.cases.length} cases, found ${snapshot.cases.length}`);
  invariant(snapshot.sourceRuns.length === spec.cases.length, `expected ${spec.cases.length} source runs, found ${snapshot.sourceRuns.length}`);

  for (const expected of spec.cases) {
    const caseItem = snapshot.cases.find((item) => item.id === expected.id);
    const sourceRun = snapshot.sourceRuns.find((item) => item.id === expected.sourceRunId);
    invariant(caseItem, `case ${expected.id} is missing`);
    invariant(sourceRun, `source run ${expected.sourceRunId} is missing`);
    invariant(caseItem.status === expected.expectedStatus, `case ${expected.id} status changed to ${caseItem.status}`);
    invariant(caseItem.phase === expected.phase && caseItem.promptSha256 === expected.promptSha256, `case ${expected.id} phase or prompt hash changed`);
    invariant(!caseItem.finalizedTurn, `case ${expected.id} is already finalized`);
    const visibleFocus = parseObject(caseItem.visibleFactsJson).allowedFocusIds;
    invariant(!Array.isArray(visibleFocus) || visibleFocus.length === 0, `case ${expected.id} visible focus was changed`);
    invariant(sameStrings(resolveTutorCaseAllowedFocusIds(caseItem), expected.focusIds), `case ${expected.id} private focus changed`);
    invariant(caseItem.candidates.length === expected.candidates.length, `case ${expected.id} candidate count changed`);
    invariant(caseItem.reviewTasks.length === expected.tasks.length, `case ${expected.id} review task count changed`);

    invariant(sourceRun.kind === 'CANDIDATE_GENERATION' && sourceRun.status === 'COMPLETED', `source run ${sourceRun.id} is no longer a completed generation run`);
    invariant(sourceRun.totalItems === 4 && sourceRun.completedItems === 4 && sourceRun.failedItems === 0 && !sourceRun.failureReason, `source run ${sourceRun.id} counters changed`);

    for (const expectedCandidate of expected.candidates) {
      const { candidate, checked } = candidateResult(caseItem, expectedCandidate.id);
      invariant(candidate.generationRunId === expected.sourceRunId && candidate.slot === expectedCandidate.slot && candidate.attempt === 1, `candidate ${candidate.id} lineage changed`);
      invariant(candidate.status === 'HARD_FAILED' && !candidate.normalizedOutput.trim(), `candidate ${candidate.id} status or normalized output changed`);
      invariant(candidate.promptSha256 === expected.promptSha256 && candidate.runtimeBundleId === expectedCandidate.runtimeBundleId, `candidate ${candidate.id} runtime or prompt changed`);
      invariant(sha256(candidate.rawOutput) === expectedCandidate.rawSha256, `candidate ${candidate.id} raw output hash changed`);
      invariant(checked.check.ok === expectedCandidate.shouldRevalidate && Boolean(checked.normalized) === expectedCandidate.shouldRevalidate, `candidate ${candidate.id} corrected validation result changed`);
    }

    for (const expectedTask of expected.tasks) {
      const task = caseItem.reviewTasks.find((item) => item.id === expectedTask.id);
      invariant(task, `review task ${expectedTask.id} is missing`);
      invariant(task.type === expectedTask.type && task.status === expectedTask.status, `review task ${task.id} type or status changed`);
      invariant(task.reason === expectedTask.reason && task.caseIssueJson === expectedTask.caseIssueJson && task.decision === expectedTask.decision, `review task ${task.id} decision evidence changed`);
      invariant(task.assignedToId === expectedTask.assignedToId && task.operatorId === expectedTask.operatorId, `review task ${task.id} ownership changed`);
      invariant(Boolean(task.submittedAt) === expectedTask.submitted, `review task ${task.id} submitted state changed`);
    }
  }
}

function assertResetEditTask(task: { status: string; assignedToId: string | null; leaseExpiresAt: Date | null; operatorId: string | null; decision: string; selectedCandidateId: string | null; preferenceRejectedCandidateId: string | null; draftJson: string; reason: string; preferenceReason: string; warningClosureJson: string; submissionMode: string; authorizedById: string | null; caseIssueJson: string; submittedAt: Date | null }, caseId: string) {
  invariant(task.status === 'PENDING' && !task.assignedToId && !task.leaseExpiresAt && !task.operatorId && !task.decision, `case ${caseId} EDIT task was not reopened cleanly`);
  invariant(!task.selectedCandidateId && !task.preferenceRejectedCandidateId && task.draftJson === '{}' && !task.reason && !task.preferenceReason, `case ${caseId} EDIT draft was not cleared`);
  invariant(task.warningClosureJson === '{}' && task.submissionMode === 'HUMAN' && !task.authorizedById && task.caseIssueJson === '{}' && !task.submittedAt, `case ${caseId} EDIT provenance was not reset`);
}

function assertPostflight(snapshot: Awaited<ReturnType<typeof loadSnapshot>>, spec: ProductionFocusRepairSpec) {
  invariant(snapshot.actor?.role === 'admin' && snapshot.actor.isActive, 'actor must remain an active admin');
  invariant(snapshot.summaryAudits.length === 1, `expected one summary audit, found ${snapshot.summaryAudits.length}`);
  invariant(snapshot.caseAudits.length === spec.cases.length, `expected ${spec.cases.length} case audits, found ${snapshot.caseAudits.length}`);

  for (const expected of spec.cases) {
    const caseItem = snapshot.cases.find((item) => item.id === expected.id);
    const sourceRun = snapshot.sourceRuns.find((item) => item.id === expected.sourceRunId);
    invariant(caseItem && sourceRun, `postflight case or run missing for ${expected.id}`);
    const editTask = caseItem.reviewTasks.find((item) => item.type === 'EDIT');
    invariant(editTask, `case ${expected.id} has no EDIT task`);
    assertResetEditTask(editTask, expected.id);
    for (const expectedTask of expected.tasks.filter((item) => item.type === 'CASE')) {
      const task = caseItem.reviewTasks.find((item) => item.id === expectedTask.id);
      invariant(task?.status === 'SUPERSEDED' && !task.assignedToId && !task.leaseExpiresAt, `case-quality task ${expectedTask.id} was not superseded`);
    }

    for (const expectedCandidate of expected.candidates) {
      const source = caseItem.candidates.find((item) => item.id === expectedCandidate.id);
      invariant(source?.status === 'HARD_FAILED' && !source.normalizedOutput.trim() && sha256(source.rawOutput) === expectedCandidate.rawSha256, `historical candidate ${expectedCandidate.id} was mutated`);
    }

    const revalidationCandidates = caseItem.candidates.filter((item) => item.generationRun?.kind === 'CANDIDATE_REVALIDATION');
    if (expected.mode === 'REVALIDATE') {
      invariant(caseItem.status === 'IN_REVIEW' && sourceRun.status === 'SUPERSEDED', `case ${expected.id} was not restored to review`);
      invariant(caseItem.candidates.length === 4 && revalidationCandidates.length === 2, `case ${expected.id} does not have one preserved and one revalidated pair`);
      const runIds = new Set(revalidationCandidates.map((item) => item.generationRunId));
      invariant(runIds.size === 1, `case ${expected.id} revalidated candidates are split across runs`);
      const run = revalidationCandidates[0].generationRun;
      invariant(run?.parentRunId === expected.sourceRunId && run.status === 'COMPLETED' && run.totalItems === 4 && run.completedItems === 4 && run.failedItems === 0, `case ${expected.id} revalidation run is incomplete`);
      for (const candidate of revalidationCandidates) {
        const params = parseObject(candidate.generationParamsJson).revalidation;
        invariant(candidate.status === 'GENERATED' && candidate.attempt === 2 && Boolean(candidate.normalizedOutput.trim()), `revalidated candidate ${candidate.id} is not reviewable`);
        invariant(params && typeof params === 'object' && (params as Record<string, unknown>).repairId === spec.repairId, `revalidated candidate ${candidate.id} lacks provenance`);
      }
    } else {
      invariant(caseItem.status === 'NEEDS_REGEN' && sourceRun.status === 'PARTIAL_FAILED', `case ${expected.id} was not routed to regeneration`);
      invariant(sourceRun.completedItems === 1 && sourceRun.failedItems === 3 && caseItem.candidates.length === 2 && revalidationCandidates.length === 0, `case ${expected.id} regeneration counters or candidates changed`);
    }
  }
}

const RESET_EDIT_TASK = {
  status: 'PENDING', assignedToId: null, leaseExpiresAt: null, operatorId: null, decision: '',
  selectedCandidateId: null, preferenceRejectedCandidateId: null, draftJson: '{}', reason: '',
  preferenceReason: '', warningClosureJson: '{}', submissionMode: 'HUMAN', authorizedById: null,
  caseIssueJson: '{}', submittedAt: null,
} as const;

export async function repairProductionCandidateFocusValidation(input: {
  client: PrismaClient;
  actorUsername: string;
  apply: boolean;
  verifiedBackup?: { path: string; sha256: string };
  spec?: ProductionFocusRepairSpec;
}) {
  const spec = input.spec ?? PRODUCTION_FOCUS_REPAIR_SPEC;
  const initial = await loadSnapshot(input.client, spec, input.actorUsername);
  if (initial.summaryAudits.length > 0) {
    assertPostflight(initial, spec);
    return { repairId: spec.repairId, alreadyApplied: true, actor: initial.actor, revalidatedCases: spec.cases.filter((item) => item.mode === 'REVALIDATE').length, regenerationCases: spec.cases.filter((item) => item.mode === 'REGENERATE').length };
  }
  assertPreflight(initial, spec);
  const plan = {
    repairId: spec.repairId,
    revalidate: spec.cases.filter((item) => item.mode === 'REVALIDATE').map((item) => ({ caseId: item.id, sourceRunId: item.sourceRunId, sourceCandidateIds: item.candidates.map((candidate) => candidate.id) })),
    regenerate: spec.cases.filter((item) => item.mode === 'REGENERATE').map((item) => ({ caseId: item.id, sourceRunId: item.sourceRunId, invalidCandidateIds: item.candidates.filter((candidate) => !candidate.shouldRevalidate).map((candidate) => candidate.id) })),
    preservedHistoricalCandidates: spec.cases.reduce((count, item) => count + item.candidates.length, 0),
    supersededCaseTasks: spec.cases.flatMap((item) => item.tasks.filter((task) => task.type === 'CASE').map((task) => task.id)),
  };
  if (!input.apply) return { dryRun: true, actor: initial.actor, plan };
  invariant(input.verifiedBackup?.path && /^[a-f0-9]{64}$/.test(input.verifiedBackup.sha256), 'apply requires a verified backup path and SHA-256');

  const result = await input.client.$transaction(async (tx) => {
    const before = await loadSnapshot(tx, spec, input.actorUsername);
    assertPreflight(before, spec);
    const now = new Date();
    const createdRuns: Array<{ caseId: string; runId: string; candidateIds: string[] }> = [];

    for (const expected of spec.cases) {
      const caseItem = before.cases.find((item) => item.id === expected.id)!;
      const sourceRun = before.sourceRuns.find((item) => item.id === expected.sourceRunId)!;
      const previousTasks = caseItem.reviewTasks.map((task) => ({ id: task.id, type: task.type, status: task.status, decision: task.decision, reason: task.reason, caseIssueJson: task.caseIssueJson, assignedToId: task.assignedToId, operatorId: task.operatorId, submittedAt: task.submittedAt }));

      if (expected.mode === 'REVALIDATE') {
        const run = await tx.bootstrapGenerationRun.create({ data: {
          kind: 'CANDIDATE_REVALIDATION', status: 'COMPLETED', modelConfigJson: sourceRun.modelConfigJson,
          promptHashesJson: sourceRun.promptHashesJson,
          parametersJson: JSON.stringify({ repairId: spec.repairId, reason: 'Revalidated preserved production outputs after resolving server-owned focus from privateReviewSpecJson.', caseId: expected.id, sourceRunId: expected.sourceRunId, sourceCandidateIds: expected.candidates.map((candidate) => candidate.id) }),
          reviewPolicy: sourceRun.reviewPolicy, totalItems: 4, completedItems: 4, failedItems: 0,
          parentRunId: sourceRun.id, candidateARuntimeBundleId: sourceRun.candidateARuntimeBundleId,
          candidateBRuntimeBundleId: sourceRun.candidateBRuntimeBundleId,
          promptPolicyVersionId: sourceRun.promptPolicyVersionId ?? caseItem.promptPolicyVersionId,
          firstReviewMode: sourceRun.firstReviewMode, createdById: before.actor!.id, startedAt: now, completedAt: now,
        } });
        const attempt = Math.max(...caseItem.candidates.map((candidate) => candidate.attempt)) + 1;
        const createdCandidates = [];
        for (const expectedCandidate of expected.candidates) {
          const { candidate: source, checked } = candidateResult(caseItem, expectedCandidate.id);
          invariant(checked.normalized && checked.check.ok, `candidate ${source.id} cannot be revalidated`);
          const sourceParams = parseObject(source.generationParamsJson);
          const created = await tx.tutorCandidate.create({ data: {
            caseId: source.caseId, generationRunId: run.id, runtimeBundleId: source.runtimeBundleId,
            slot: source.slot, attempt, provider: source.provider, modelFamily: source.modelFamily,
            externalModelId: source.externalModelId, modelVersionTag: source.modelVersionTag,
            rawOutput: source.rawOutput, normalizedOutput: JSON.stringify(checked.normalized),
            deterministicCheckJson: JSON.stringify(checked.check), critiqueJson: source.critiqueJson,
            generationParamsJson: JSON.stringify({ ...sourceParams, revalidation: { repairId: spec.repairId, sourceCandidateId: source.id, sourceRunId: sourceRun.id, validator: 'corrected-focus-resolution' } }),
            promptSha256: source.promptSha256, status: 'GENERATED',
          } });
          createdCandidates.push(created.id);
        }
        await tx.bootstrapGenerationRun.update({ where: { id: sourceRun.id }, data: { status: 'SUPERSEDED', failureReason: `Superseded by ${run.id}; original candidates preserved after ${spec.repairId}.` } });
        await tx.tutorTurnCase.update({ where: { id: expected.id }, data: { status: 'IN_REVIEW' } });
        createdRuns.push({ caseId: expected.id, runId: run.id, candidateIds: createdCandidates });
        await tx.dataLabAuditLog.create({ data: {
          actorId: before.actor!.id, action: 'PRODUCTION_TUTOR_CASE_REVALIDATED', entityType: 'TutorTurnCase', entityId: expected.id,
          payloadJson: JSON.stringify({ repairId: spec.repairId, sourceRunId: sourceRun.id, sourceCandidateIds: expected.candidates.map((candidate) => candidate.id), revalidationRunId: run.id, revalidatedCandidateIds: createdCandidates, previousTasks }),
        } });
      } else {
        const invalid = expected.candidates.find((candidate) => !candidate.shouldRevalidate)!;
        await tx.bootstrapGenerationRun.update({ where: { id: sourceRun.id }, data: {
          status: 'PARTIAL_FAILED', completedItems: 1, failedItems: 3,
          failureReason: JSON.stringify([{ stage: `TUTOR_${invalid.slot}`, error: 'EMPTY_CONTENT: preserved output contains no non-whitespace content' }]),
          completedAt: now,
        } });
        await tx.tutorTurnCase.update({ where: { id: expected.id }, data: { status: 'NEEDS_REGEN' } });
        await tx.dataLabAuditLog.create({ data: {
          actorId: before.actor!.id, action: 'PRODUCTION_TUTOR_CASE_MARKED_FOR_REGEN', entityType: 'TutorTurnCase', entityId: expected.id,
          payloadJson: JSON.stringify({ repairId: spec.repairId, sourceRunId: sourceRun.id, sourceCandidateIds: expected.candidates.map((candidate) => candidate.id), invalidCandidateId: invalid.id, failureCode: 'EMPTY_CONTENT', previousTasks }),
        } });
      }

      const editTask = caseItem.reviewTasks.find((task) => task.type === 'EDIT')!;
      await tx.tutorReviewTask.update({ where: { id: editTask.id }, data: RESET_EDIT_TASK });
      await tx.tutorReviewTask.updateMany({ where: { caseId: expected.id, type: 'CASE', status: { in: ['PENDING', 'RETURNED', 'IN_PROGRESS', 'REGEN_REQUESTED'] } }, data: { status: 'SUPERSEDED', assignedToId: null, leaseExpiresAt: null } });
    }

    const summaryAudit = await tx.dataLabAuditLog.create({ data: {
      actorId: before.actor!.id, action: 'PRODUCTION_FOCUS_REPAIR_COMPLETED', entityType: 'ProductionCandidateRepair', entityId: spec.repairId,
      payloadJson: JSON.stringify({ repairId: spec.repairId, verifiedBackup: input.verifiedBackup, rootCause: 'Production conversion stored allowedFocusIds in privateReviewSpecJson while candidate validation read only visibleFactsJson.', createdRuns, regenerationCaseIds: spec.cases.filter((item) => item.mode === 'REGENERATE').map((item) => item.id), preservedHistoricalCandidateIds: spec.cases.flatMap((item) => item.candidates.map((candidate) => candidate.id)) }),
    } });
    return { createdRuns, summaryAuditId: summaryAudit.id };
  }, { timeout: 30_000 });

  const after = await loadSnapshot(input.client, spec, input.actorUsername);
  assertPostflight(after, spec);
  return { applied: true, actor: after.actor, verifiedBackup: input.verifiedBackup, plan, result };
}
