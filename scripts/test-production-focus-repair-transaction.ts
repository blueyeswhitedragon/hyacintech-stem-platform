#!/usr/bin/env tsx
import { execFileSync } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { sha256 } from '../app/lib/dataLab/bootstrap/contracts';
import { repairProductionCandidateFocusValidation, type ProductionFocusRepairSpec } from '../app/lib/dataLab/productionCandidateRepair';

let passed = 0;
let failed = 0;

function check(condition: unknown, label: string) {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.error(`FAIL ${label}`); }
}

const actorId = 'repair-test-admin';
const focus = 'direction_confirmation';
const promptSha = '1'.repeat(64);
const rawA = JSON.stringify({ dialogue: '请确认这个研究方向是否准确？', interactionType: 'checkpoint', focus, hints: [] });
const rawB = JSON.stringify({ dialogue: '这个方向就是你想继续研究的吗？', interactionType: 'checkpoint', focus, hints: [] });
const blank = ' '.repeat(12);

const spec: ProductionFocusRepairSpec = {
  repairId: 'production-focus-repair-isolated-test',
  cases: [
    {
      id: 'repair-case-revalidate', mode: 'REVALIDATE', expectedStatus: 'CASE_NEEDS_REVISION', phase: 1,
      focusIds: [focus], promptSha256: promptSha, sourceRunId: 'repair-run-revalidate',
      candidates: [
        { id: 'repair-revalidate-a', slot: 'A', rawSha256: sha256(rawA), runtimeBundleId: null, shouldRevalidate: true },
        { id: 'repair-revalidate-b', slot: 'B', rawSha256: sha256(rawB), runtimeBundleId: null, shouldRevalidate: true },
      ],
      tasks: [
        { id: 'repair-revalidate-case-task', type: 'CASE', status: 'PENDING', reason: '无法查看', caseIssueJson: '{"note":"无法查看"}', assignedToId: null, operatorId: null, decision: '', submitted: false },
        { id: 'repair-revalidate-edit-task', type: 'EDIT', status: 'RETURNED', reason: '无法查看', caseIssueJson: '{"note":"无法查看"}', assignedToId: actorId, operatorId: actorId, decision: 'RETURN_CASE', submitted: true },
      ],
    },
    {
      id: 'repair-case-regenerate', mode: 'REGENERATE', expectedStatus: 'IN_REVIEW', phase: 1,
      focusIds: [focus], promptSha256: promptSha, sourceRunId: 'repair-run-regenerate',
      candidates: [
        { id: 'repair-regenerate-a', slot: 'A', rawSha256: sha256(rawA), runtimeBundleId: null, shouldRevalidate: true },
        { id: 'repair-regenerate-b', slot: 'B', rawSha256: sha256(blank), runtimeBundleId: null, shouldRevalidate: false },
      ],
      tasks: [
        { id: 'repair-regenerate-edit-task', type: 'EDIT', status: 'PENDING', reason: '', caseIssueJson: '{}', assignedToId: null, operatorId: null, decision: '', submitted: false },
      ],
    },
  ],
};

async function seed(db: PrismaClient) {
  await db.user.create({ data: { id: actorId, username: 'repair-test-admin', passwordHash: 'x', role: 'admin', displayName: 'Repair Test Admin' } });
  for (const caseSpec of spec.cases) {
    await db.bootstrapGenerationRun.create({ data: {
      id: caseSpec.sourceRunId, kind: 'CANDIDATE_GENERATION', status: 'COMPLETED',
      totalItems: 4, completedItems: 4, failedItems: 0, createdById: actorId,
      modelConfigJson: JSON.stringify({ A: { provider: 'openai', model: 'a' }, B: { provider: 'deepseek', model: 'b' } }),
      promptHashesJson: JSON.stringify([promptSha]), startedAt: new Date(), completedAt: new Date(),
    } });
    await db.tutorTurnCase.create({ data: {
      id: caseSpec.id, phase: caseSpec.phase, triggerType: 'USER_MESSAGE', studentMessage: '我想研究光照时间。',
      visibleFactsJson: '{}', privateReviewSpecJson: JSON.stringify({ allowedFocusIds: caseSpec.focusIds }),
      systemPrompt: 'test system prompt', promptSha256: promptSha, status: caseSpec.expectedStatus,
    } });
    const outputs = caseSpec.mode === 'REVALIDATE' ? [rawA, rawB] : [rawA, blank];
    for (const [index, candidateSpec] of caseSpec.candidates.entries()) {
      await db.tutorCandidate.create({ data: {
        id: candidateSpec.id, caseId: caseSpec.id, generationRunId: caseSpec.sourceRunId,
        slot: candidateSpec.slot, attempt: 1, provider: index === 0 ? 'openai' : 'deepseek',
        modelFamily: index === 0 ? 'anthropic' : 'deepseek', externalModelId: index === 0 ? 'model-a' : 'model-b',
        modelVersionTag: index === 0 ? 'model-a:v1' : 'model-b:v1', rawOutput: outputs[index], normalizedOutput: '',
        deterministicCheckJson: JSON.stringify({ ok: false, hardErrorCount: 1, warningCount: 0, issues: [{ code: 'CONTRACT_INVALID', severity: 'error' }] }),
        critiqueJson: JSON.stringify({ status: 'COMPLETED', issues: [], advisories: [] }), generationParamsJson: JSON.stringify({ maxTokens: 1200 }),
        promptSha256: promptSha, status: 'HARD_FAILED',
      } });
    }
    for (const taskSpec of caseSpec.tasks) {
      await db.tutorReviewTask.create({ data: {
        id: taskSpec.id, caseId: caseSpec.id, type: taskSpec.type, status: taskSpec.status,
        assignedToId: taskSpec.assignedToId, operatorId: taskSpec.operatorId, decision: taskSpec.decision,
        reason: taskSpec.reason, caseIssueJson: taskSpec.caseIssueJson,
        submittedAt: taskSpec.submitted ? new Date() : null,
      } });
    }
  }
}

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'hyacintech-production-focus-repair-'));
  const databasePath = path.join(tempRoot, 'repair.db');
  const databaseUrl = `file:${databasePath}`;
  const prismaCli = path.resolve('node_modules/prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await seed(db);
    const dryRun = await repairProductionCandidateFocusValidation({ client: db, actorUsername: 'repair-test-admin', apply: false, spec });
    check('dryRun' in dryRun && dryRun.dryRun === true && (await db.tutorCandidate.count()) === 4, 'dry-run 只返回精确计划且不写数据库');

    await db.tutorCandidate.update({ where: { id: 'repair-revalidate-a' }, data: { rawOutput: `${rawA} ` } });
    let driftRefused = false;
    try { await repairProductionCandidateFocusValidation({ client: db, actorUsername: 'repair-test-admin', apply: false, spec }); }
    catch (error) { driftRefused = error instanceof Error && error.message.includes('raw output hash changed'); }
    check(driftRefused, '源候选哈希发生漂移时拒绝修复');
    await db.tutorCandidate.update({ where: { id: 'repair-revalidate-a' }, data: { rawOutput: rawA } });

    const applied = await repairProductionCandidateFocusValidation({
      client: db, actorUsername: 'repair-test-admin', apply: true, spec,
      verifiedBackup: { path: 'isolated-test-backup.bak', sha256: 'a'.repeat(64) },
    });
    check('applied' in applied && applied.applied === true, '修复在单事务中应用并通过后置断言');
    check((await db.tutorCandidate.count()) === 6 && (await db.tutorCandidate.count({ where: { status: 'HARD_FAILED' } })) === 4, '历史四条候选不变并新增两条重校验候选');
    check((await db.bootstrapGenerationRun.count({ where: { kind: 'CANDIDATE_REVALIDATION', status: 'COMPLETED' } })) === 1, '完整案例新增可追溯 CANDIDATE_REVALIDATION run');
    check((await db.tutorTurnCase.findUniqueOrThrow({ where: { id: 'repair-case-regenerate' } })).status === 'NEEDS_REGEN', '空输出案例进入 NEEDS_REGEN 而不伪造候选');
    check((await db.tutorReviewTask.findUniqueOrThrow({ where: { id: 'repair-revalidate-case-task' } })).status === 'SUPERSEDED', '错误 CASE 任务保留但标记为 SUPERSEDED');

    const repeated = await repairProductionCandidateFocusValidation({ client: db, actorUsername: 'repair-test-admin', apply: true, spec, verifiedBackup: { path: 'isolated-test-backup.bak', sha256: 'a'.repeat(64) } });
    check('alreadyApplied' in repeated && repeated.alreadyApplied === true && (await db.tutorCandidate.count()) === 6, '重复执行识别已完成修复且不重复写入');
  } finally {
    await db.$disconnect();
    await rm(tempRoot, { recursive: true, force: true });
  }

  console.log(`\nProduction focus repair transaction tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
