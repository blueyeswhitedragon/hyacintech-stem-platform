import { db } from '@/app/lib/db';
import { chooseRolloutModel, evaluateDeploymentGate, evaluateOnlineObservationGate, type OnlineObservationInput } from '@/app/lib/deploymentGate';
import { parseJson } from '@/app/lib/dataLab/validation';

export async function refreshModelDeploymentGate(modelVersionId: string) {
  const model = await db.modelVersion.findUnique({
    where: { id: modelVersionId },
    include: { trainingRun: true },
  });
  if (!model) throw new Error('模型版本不存在');
  const runs = await db.evaluationRun.findMany({
    where: { OR: [{ modelAVersionId: model.id }, { modelBVersionId: model.id }] },
  });
  const trainingReport = parseJson<{ blocked?: number; sftAllowed?: number }>(model.trainingRun?.eligibilityReportJson ?? '{}', {});
  const trainingReady = model.trainingRun?.status === 'SUCCEEDED' && (trainingReport.blocked ?? 1) === 0 && (trainingReport.sftAllowed ?? 0) > 0;
  const report = evaluateDeploymentGate({
    candidateTag: model.tag,
    trainingReady,
    runs: runs.map((run) => ({ id: run.id, modelATag: run.modelATag, modelBTag: run.modelBTag, styleFamily: run.styleFamily, scope: run.scope, summary: parseJson(run.summaryJson, {}) })),
  });
  await db.$transaction(async (tx) => {
    await tx.evaluationRun.updateMany({
      where: { OR: [{ modelAVersionId: model.id }, { modelBVersionId: model.id }] },
      data: { gateResult: report.result, gateReportJson: JSON.stringify(report) },
    });
    if (!['DEPLOYED', 'RETIRED'].includes(model.status)) {
      await tx.modelVersion.update({ where: { id: model.id }, data: { status: report.result === 'PASS' ? 'ELIGIBLE' : 'EVALUATED' } });
    }
  });
  return report;
}

export async function createOrPromoteDeployment(input: { modelVersionId: string; rolloutPercent: 10 | 30 | 100; adminId: string }) {
  if (process.env.ENABLE_MODEL_DEPLOYMENT === 'false') throw new Error('模型部署功能已被环境开关关闭');
  const model = await db.modelVersion.findUnique({ where: { id: input.modelVersionId } });
  if (!model || model.status !== 'ELIGIBLE') throw new Error('模型尚未通过完整评测门禁');
  const gate = await refreshModelDeploymentGate(model.id);
  if (gate.result !== 'PASS') throw new Error(`部署门禁未通过：${gate.failures.join('、')}`);
  const active = await db.modelDeployment.findFirst({ where: { environment: 'PRODUCTION', status: 'ACTIVE' }, orderBy: { startedAt: 'desc' } });
  const sameCandidate = active?.modelVersionId === model.id;
  if (sameCandidate && active && (active.rolloutPercent === 10 || active.rolloutPercent === 30)) {
    const observation = parseJson<Partial<Omit<OnlineObservationInput, 'rolloutPercent' | 'startedAt'>>>(active.observationJson, {});
    if (!active.startedAt) throw new Error('当前灰度缺少 startedAt，无法核验线上观察窗口');
    const online = evaluateOnlineObservationGate({
      rolloutPercent: active.rolloutPercent,
      startedAt: active.startedAt,
      sessions: observation.sessions ?? 0,
      criticalErrors: observation.criticalErrors ?? 0,
      structureFailureRate: observation.structureFailureRate ?? 1,
      baselineStructureFailureRate: observation.baselineStructureFailureRate ?? 0,
      teacherRejectRate: observation.teacherRejectRate ?? 1,
      baselineTeacherRejectRate: observation.baselineTeacherRejectRate ?? 0,
      earlyTerminationRate: observation.earlyTerminationRate ?? 1,
      baselineEarlyTerminationRate: observation.baselineEarlyTerminationRate ?? 0,
    });
    if (!online.pass) throw new Error(`线上灰度门禁未通过：${online.failures.join('、')}`);
  }
  const expected = sameCandidate ? (active.rolloutPercent === 10 ? 30 : active.rolloutPercent === 30 ? 100 : null) : 10;
  if (input.rolloutPercent !== expected) throw new Error(`灰度比例必须按 10% → 30% → 100% 晋级，下一步应为 ${expected ?? '无'}`);
  if (!active && input.rolloutPercent !== 10) throw new Error('首次部署必须从 10% 开始');

  return db.$transaction(async (tx) => {
    if (active) await tx.modelDeployment.update({ where: { id: active.id }, data: { status: 'COMPLETED', endedAt: new Date() } });
    const previousModelVersionId = sameCandidate ? active?.previousModelVersionId ?? null : active?.modelVersionId ?? null;
    const deployment = await tx.modelDeployment.create({ data: { modelVersionId: model.id, previousModelVersionId, environment: 'PRODUCTION', rolloutPercent: input.rolloutPercent, status: 'ACTIVE', evaluationRunId: (await tx.evaluationRun.findFirst({ where: { modelBVersionId: model.id, gateResult: 'PASS' }, orderBy: { createdAt: 'desc' } }))?.id, gateReportJson: JSON.stringify(gate), createdById: input.adminId, startedAt: new Date() } });
    await tx.modelVersion.update({ where: { id: model.id }, data: { status: input.rolloutPercent === 100 ? 'DEPLOYED' : 'ELIGIBLE' } });
    await tx.dataLabAuditLog.create({ data: { actorId: input.adminId, action: 'MODEL_DEPLOYMENT_PROMOTED', entityType: 'ModelDeployment', entityId: deployment.id, payloadJson: JSON.stringify({ rolloutPercent: input.rolloutPercent, modelVersionId: model.id }) } });
    return deployment;
  });
}

export async function rollbackDeployment(input: { deploymentId: string; adminId: string }) {
  const active = await db.modelDeployment.findUnique({ where: { id: input.deploymentId } });
  if (!active || active.status !== 'ACTIVE' || !active.previousModelVersionId) throw new Error('当前部署不可回滚或没有上一模型');
  return db.$transaction(async (tx) => {
    await tx.modelDeployment.update({ where: { id: active.id }, data: { status: 'ROLLED_BACK', endedAt: new Date() } });
    const rollback = await tx.modelDeployment.create({ data: { modelVersionId: active.previousModelVersionId!, previousModelVersionId: active.modelVersionId, environment: active.environment, rolloutPercent: 100, status: 'ACTIVE', gateReportJson: active.gateReportJson, createdById: input.adminId, startedAt: new Date() } });
    await tx.modelVersion.update({ where: { id: active.modelVersionId }, data: { status: 'RETIRED' } });
    await tx.modelVersion.update({ where: { id: active.previousModelVersionId! }, data: { status: 'DEPLOYED' } });
    await tx.conversation.updateMany({ where: { deployedModelVersionId: active.modelVersionId }, data: { deployedModelVersionId: active.previousModelVersionId } });
    await tx.dataLabAuditLog.create({ data: { actorId: input.adminId, action: 'MODEL_DEPLOYMENT_ROLLED_BACK', entityType: 'ModelDeployment', entityId: rollback.id, payloadJson: JSON.stringify({ rolledBackDeploymentId: active.id }) } });
    return rollback;
  });
}

export async function updateDeploymentObservation(input: {
  deploymentId: string;
  adminId: string;
  observation: Omit<OnlineObservationInput, 'rolloutPercent' | 'startedAt' | 'now'>;
}) {
  const deployment = await db.modelDeployment.findUnique({ where: { id: input.deploymentId } });
  if (!deployment || deployment.status !== 'ACTIVE' || ![10, 30].includes(deployment.rolloutPercent)) throw new Error('只有 ACTIVE 的 10%/30% 灰度可记录观察指标');
  const values = Object.values(input.observation);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('观察指标必须是非负数');
  const updated = await db.modelDeployment.update({ where: { id: deployment.id }, data: { observationJson: JSON.stringify({ ...input.observation, recordedAt: new Date().toISOString() }) } });
  await db.dataLabAuditLog.create({ data: { actorId: input.adminId, action: 'DEPLOYMENT_OBSERVATION_UPDATED', entityType: 'ModelDeployment', entityId: deployment.id, payloadJson: JSON.stringify(input.observation) } });
  return updated;
}

export async function resolveConversationModel(conversationId: string) {
  const conversation = await db.conversation.findUnique({ where: { id: conversationId }, include: { deployedModelVersion: true } });
  if (!conversation) throw new Error('会话不存在');
  if (conversation.deployedModelVersion) return conversation.deployedModelVersion;
  const active = await db.modelDeployment.findFirst({ where: { environment: 'PRODUCTION', status: 'ACTIVE' }, orderBy: { startedAt: 'desc' } });
  if (!active) throw new Error('当前没有 ACTIVE 生产部署');
  const modelId = chooseRolloutModel({ stableKey: conversationId, rolloutPercent: active.rolloutPercent, candidateModelId: active.modelVersionId, previousModelId: active.previousModelVersionId });
  await db.conversation.updateMany({ where: { id: conversationId, deployedModelVersionId: null }, data: { deployedModelVersionId: modelId } });
  return db.modelVersion.findUniqueOrThrow({ where: { id: modelId } });
}
