#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import { db } from '../app/lib/db';
import { chooseRolloutModel, evaluateDeploymentGate, evaluateOnlineObservationGate, stableRolloutBucket } from '../app/lib/deploymentGate';
import { createOrPromoteDeployment, refreshModelDeploymentGate, resolveConversationModel, rollbackDeployment, updateDeploymentObservation } from '../app/lib/deployment';

let passed = 0;
let failed = 0;
function check(condition: unknown, label: string) {
  if (condition) { passed++; console.log(`PASS ${label}`); }
  else { failed++; console.error(`FAIL ${label}`); }
}

async function main() {
  check(stableRolloutBucket('same') === stableRolloutBucket('same'), '稳定分桶对同一会话保持确定');
  check(chooseRolloutModel({ stableKey: 'x', rolloutPercent: 100, candidateModelId: 'new', previousModelId: 'old' }) === 'new', '100% 灰度全部选择新模型');
  const phase = Object.fromEntries([1, 2, 3, 4, 5, 6].map((value) => [String(value), { B: 2, A: 1, tie: 0, inconsistent: 0, criticalErrors: 0, parseSuccessA: 9, parseTotalA: 10, parseSuccessB: 10, parseTotalB: 10 }]));
  const pureRuns = [{ id: 'all', modelATag: 'base', modelBTag: 'candidate', scope: 'all', summary: { phase, artifactValidation: { complete: true, invalidArtifacts: 0, scenarioIdsComplete: true, modelIdentitiesVerified: true } } }];
  check(evaluateDeploymentGate({ candidateTag: 'candidate', runs: pureRuns, trainingReady: true }).result === 'PASS', '六阶段均不退化且训练血缘合格时门禁通过');
  const missingPhase = { ...phase }; delete missingPhase['6'];
  check(evaluateDeploymentGate({ candidateTag: 'candidate', runs: [{ ...pureRuns[0], summary: { ...pureRuns[0].summary, phase: missingPhase } }], trainingReady: true }).result === 'INSUFFICIENT', '缺少任一阶段评测时门禁资料不足');
  const regressedPhase = { ...phase, '1': { ...phase['1'], A: 3, B: 0 } };
  check(evaluateDeploymentGate({ candidateTag: 'candidate', runs: [{ ...pureRuns[0], summary: { ...pureRuns[0].summary, phase: regressedPhase } }], trainingReady: true }).result === 'FAIL', '单一阶段退化会阻断总体表现正常的模型');
  check(!evaluateOnlineObservationGate({ rolloutPercent: 10, startedAt: new Date(), sessions: 0, criticalErrors: 0, structureFailureRate: 0, baselineStructureFailureRate: 0, teacherRejectRate: 0, baselineTeacherRejectRate: 0, earlyTerminationRate: 0, baselineEarlyTerminationRate: 0 }).pass, '线上观察时间与会话量不足时阻断');

  const suffix = randomUUID();
  const admin = await db.user.findFirstOrThrow({ where: { role: 'admin' } });
  const baselineDeployment = await db.modelDeployment.findFirstOrThrow({ where: { environment: 'PRODUCTION', status: 'ACTIVE' }, orderBy: { startedAt: 'desc' } });
  const baseline = await db.modelVersion.findUniqueOrThrow({ where: { id: baselineDeployment.modelVersionId } });
  const release = await db.datasetRelease.create({ data: { version: `gate-release-${suffix}`, status: 'FROZEN', createdById: admin.id, eligibilityReportJson: JSON.stringify({ sftAllowed: 1, blocked: 0 }) } });
  const training = await db.trainingRun.create({ data: { name: `gate-training-${suffix}`, releaseId: release.id, baseModel: baseline.tag, status: 'SUCCEEDED', eligibilityReportJson: JSON.stringify({ sftAllowed: 1, blocked: 0 }), parentModelVersionId: baseline.id, createdById: admin.id } });
  const candidate = await db.modelVersion.create({ data: { tag: `gate-candidate-${suffix}`, provider: baseline.provider, externalModelId: baseline.externalModelId, parentModelVersionId: baseline.id, trainingRunId: training.id, status: 'TRAINED' } });
  const evaluation = await db.evaluationRun.create({ data: { name: `gate-phase-${suffix}`, modelATag: baseline.tag, modelBTag: candidate.tag, modelAVersionId: baseline.id, modelBVersionId: candidate.id, scope: 'all-phases', summaryJson: JSON.stringify({ phase, artifactValidation: { complete: true, invalidArtifacts: 0, scenarioIdsComplete: true, modelIdentitiesVerified: true } }), createdById: admin.id } });
  const evaluationIds = [evaluation.id];
  const gate = await refreshModelDeploymentGate(candidate.id);
  check(gate.result === 'PASS' && (await db.modelVersion.findUniqueOrThrow({ where: { id: candidate.id } })).status === 'ELIGIBLE', '数据库评测汇总使模型晋级 ELIGIBLE');
  const ten = await createOrPromoteDeployment({ modelVersionId: candidate.id, rolloutPercent: 10, adminId: admin.id });
  check(ten.rolloutPercent === 10 && ten.previousModelVersionId === baseline.id, '新模型只能从 10% 灰度开始且保存回滚目标');
  let skippedBlocked = false;
  try { await createOrPromoteDeployment({ modelVersionId: candidate.id, rolloutPercent: 100, adminId: admin.id }); } catch { skippedBlocked = true; }
  check(skippedBlocked, '不能跳过 30% 直接晋级 100%');

  let candidateKey = '';
  let baselineKey = '';
  for (let index = 0; index < 1000 && (!candidateKey || !baselineKey); index++) {
    const key = `conversation-${suffix}-${index}`;
    if (stableRolloutBucket(key) < 10) candidateKey ||= key;
    else baselineKey ||= key;
  }
  const candidateConversation = await db.conversation.create({ data: { id: candidateKey, userId: admin.id } });
  const baselineConversation = await db.conversation.create({ data: { id: baselineKey, userId: admin.id } });
  check((await resolveConversationModel(candidateConversation.id)).id === candidate.id, '10% 分桶内会话选择候选模型');
  check((await resolveConversationModel(baselineConversation.id)).id === baseline.id, '10% 分桶外会话继续使用基线');
  await db.modelDeployment.update({ where: { id: ten.id }, data: { startedAt: new Date(Date.now() - 96 * 3_600_000) } });
  await updateDeploymentObservation({ deploymentId: ten.id, adminId: admin.id, observation: { sessions: 60, criticalErrors: 0, structureFailureRate: 0.01, baselineStructureFailureRate: 0.01, teacherRejectRate: 0.1, baselineTeacherRejectRate: 0.1, earlyTerminationRate: 0.1, baselineEarlyTerminationRate: 0.1 } });
  const thirty = await createOrPromoteDeployment({ modelVersionId: candidate.id, rolloutPercent: 30, adminId: admin.id });
  await db.modelDeployment.update({ where: { id: thirty.id }, data: { startedAt: new Date(Date.now() - 96 * 3_600_000) } });
  await updateDeploymentObservation({ deploymentId: thirty.id, adminId: admin.id, observation: { sessions: 160, criticalErrors: 0, structureFailureRate: 0.01, baselineStructureFailureRate: 0.01, teacherRejectRate: 0.1, baselineTeacherRejectRate: 0.1, earlyTerminationRate: 0.1, baselineEarlyTerminationRate: 0.1 } });
  const hundred = await createOrPromoteDeployment({ modelVersionId: candidate.id, rolloutPercent: 100, adminId: admin.id });
  check((await resolveConversationModel(baselineConversation.id)).id === baseline.id, '灰度晋级后已有会话仍保持原模型黏性');
  const rollback = await rollbackDeployment({ deploymentId: hundred.id, adminId: admin.id });
  check(rollback.modelVersionId === baseline.id && rollback.rolloutPercent === 100, '一键回滚恢复上一生产模型');
  check((await resolveConversationModel(candidateConversation.id)).id === baseline.id, '紧急回滚会把候选模型会话切回安全基线');

  await db.conversation.deleteMany({ where: { id: { in: [candidateConversation.id, baselineConversation.id] } } });
  const createdDeployments = await db.modelDeployment.findMany({ where: { OR: [{ modelVersionId: candidate.id }, { previousModelVersionId: candidate.id }], id: { not: baselineDeployment.id } }, select: { id: true } });
  await db.dataLabAuditLog.deleteMany({ where: { entityType: 'ModelDeployment', entityId: { in: createdDeployments.map((item) => item.id) } } });
  await db.modelDeployment.deleteMany({ where: { id: { in: createdDeployments.map((item) => item.id) } } });
  await db.modelDeployment.update({ where: { id: baselineDeployment.id }, data: { status: 'ACTIVE', endedAt: null } });
  await db.evaluationRun.deleteMany({ where: { id: { in: evaluationIds } } });
  await db.modelVersion.delete({ where: { id: candidate.id } });
  await db.trainingRun.delete({ where: { id: training.id } });
  await db.datasetRelease.delete({ where: { id: release.id } });
  await db.modelVersion.update({ where: { id: baseline.id }, data: { status: 'DEPLOYED' } });

  console.log(`\nDeployment gate tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
