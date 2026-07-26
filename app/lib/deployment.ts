import { db } from '@/app/lib/db';
import { chooseRolloutModel, evaluateDeploymentGate, evaluateOnlineObservationGate, stableRolloutBucket, type OnlineObservationInput } from '@/app/lib/deploymentGate';
import { parseJson } from '@/app/lib/dataLab/validation';
import { runtimeBundleChangeSummary } from '@/app/lib/dataLab/runtimeGovernance';

function runtimeTag(bundle: { name: string; version: number }) {
  return `${bundle.name}:v${bundle.version}`;
}

async function runtimeCallConfig(runtimeBundleId: string) {
  const { resolveRuntimeBundleCallConfig } = await import('@/app/lib/dataLab/runtimeRegistry');
  return resolveRuntimeBundleCallConfig(runtimeBundleId);
}

async function loadPinnedConversationModel(conversationId: string) {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      deployedModelVersion: true,
      deployedRuntimeBundle: { include: { modelVersion: true } },
    },
  });
  if (!conversation) throw new Error('会话不存在');
  if (conversation.deployedRuntimeBundle) {
    const config = await runtimeCallConfig(conversation.deployedRuntimeBundle.id);
    return {
      ...conversation.deployedRuntimeBundle.modelVersion,
      promptPolicyVersion: config.promptVersion,
      contractVersion: config.tutorContractVersion,
      runtimeBundleId: config.runtimeBundleId,
      runtimeConfig: {
        provider: config.provider,
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model: config.model,
      },
    };
  }
  return conversation.deployedModelVersion;
}

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

export async function refreshRuntimeBundleDeploymentGate(runtimeBundleId: string) {
  const bundle = await db.runtimeBundle.findUnique({
    where: { id: runtimeBundleId },
    include: {
      modelVersion: { include: { trainingRun: true } },
      promptCompatibilities: { orderBy: { checkedAt: 'desc' }, take: 1 },
    },
  });
  if (!bundle) throw new Error('运行组合不存在');
  const runs = await db.evaluationRun.findMany({
    where: { OR: [{ runtimeBundleAId: bundle.id }, { runtimeBundleBId: bundle.id }] },
  });
  const trainingReport = parseJson<{ blocked?: number; sftAllowed?: number }>(bundle.modelVersion.trainingRun?.eligibilityReportJson ?? '{}', {});
  const trainingReady = bundle.modelVersion.artifactKind === 'BASE'
    ? bundle.modelVersion.verificationStatus === 'VERIFIED_IDENTITY'
    : bundle.modelVersion.trainingRun?.status === 'SUCCEEDED'
      && (trainingReport.blocked ?? 1) === 0
      && (trainingReport.sftAllowed ?? 0) > 0;
  const compatibilityReady = bundle.promptCompatibilities[0]?.status === 'PASS'
    && ['AVAILABLE', 'DEPLOYED'].includes(bundle.status);
  const report = evaluateDeploymentGate({
    candidateTag: runtimeTag(bundle),
    trainingReady: trainingReady && compatibilityReady,
    runs: runs.map((run) => ({
      id: run.id,
      modelATag: run.modelATag,
      modelBTag: run.modelBTag,
      styleFamily: run.styleFamily,
      scope: run.scope,
      summary: parseJson(run.summaryJson, {}),
    })),
  });
  await db.evaluationRun.updateMany({
    where: { OR: [{ runtimeBundleAId: bundle.id }, { runtimeBundleBId: bundle.id }] },
    data: { gateResult: report.result, gateReportJson: JSON.stringify({ ...report, runtimeBundleId: bundle.id }) },
  });
  return { ...report, runtimeBundleId: bundle.id, compatibilityReady, trainingReady };
}

export async function createOrPromoteRuntimeDeployment(input: {
  runtimeBundleId: string;
  rolloutPercent: 10 | 30 | 100;
  adminId: string;
}) {
  if (process.env.ENABLE_MODEL_DEPLOYMENT === 'false') throw new Error('运行组合部署功能已被环境开关关闭');
  const bundle = await db.runtimeBundle.findUnique({
    where: { id: input.runtimeBundleId },
    include: { modelVersion: true },
  });
  if (!bundle || !['AVAILABLE', 'DEPLOYED'].includes(bundle.status)) throw new Error('运行组合尚未达到可部署状态');
  const gate = await refreshRuntimeBundleDeploymentGate(bundle.id);
  if (gate.result !== 'PASS') throw new Error(`部署门禁未通过：${gate.failures.join('、')}`);
  const active = await db.modelDeployment.findFirst({
    where: { environment: 'PRODUCTION', status: 'ACTIVE' },
    orderBy: { startedAt: 'desc' },
    include: { runtimeBundle: true },
  });
  const sameCandidate = active?.runtimeBundleId === bundle.id;
  if (sameCandidate && active && (active.rolloutPercent === 10 || active.rolloutPercent === 30)) {
    const observation = parseJson<Partial<Omit<OnlineObservationInput, 'rolloutPercent' | 'startedAt'>>>(active.observationJson, {});
    if ((observation as Record<string, unknown>).promotionPaused === true) throw new Error('当前灰度已暂停晋级，请先点击“恢复晋级”');
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
  const expected = sameCandidate
    ? active?.rolloutPercent === 10 ? 30 : active?.rolloutPercent === 30 ? 100 : null
    : 10;
  if (input.rolloutPercent !== expected) throw new Error(`灰度比例必须按 10% → 30% → 100% 晋级，下一步应为 ${expected ?? '无'}`);
  const change = runtimeBundleChangeSummary(active?.runtimeBundle ?? null, bundle);
  const passingEvaluation = await db.evaluationRun.findFirst({
    where: { runtimeBundleBId: bundle.id, gateResult: 'PASS' },
    orderBy: { createdAt: 'desc' },
  });
  return db.$transaction(async (tx) => {
    if (active) await tx.modelDeployment.update({ where: { id: active.id }, data: { status: 'COMPLETED', endedAt: new Date() } });
    const previousModelVersionId = sameCandidate ? active?.previousModelVersionId ?? null : active?.modelVersionId ?? null;
    const previousRuntimeBundleId = sameCandidate ? active?.previousRuntimeBundleId ?? null : active?.runtimeBundleId ?? null;
    const deployment = await tx.modelDeployment.create({
      data: {
        modelVersionId: bundle.modelVersionId,
        previousModelVersionId,
        runtimeBundleId: bundle.id,
        previousRuntimeBundleId,
        environment: 'PRODUCTION',
        rolloutPercent: input.rolloutPercent,
        status: 'ACTIVE',
        evaluationRunId: passingEvaluation?.id,
        gateReportJson: JSON.stringify({ ...gate, change }),
        createdById: input.adminId,
        startedAt: new Date(),
      },
    });
    await tx.runtimeBundle.update({ where: { id: bundle.id }, data: { status: 'DEPLOYED' } });
    if (!sameCandidate && active?.runtimeBundleId) {
      await tx.runtimeBundle.update({ where: { id: active.runtimeBundleId }, data: { status: 'AVAILABLE' } });
    }
    await tx.modelVersion.update({ where: { id: bundle.modelVersionId }, data: { status: input.rolloutPercent === 100 ? 'DEPLOYED' : bundle.modelVersion.status } });
    await tx.dataLabAuditLog.create({
      data: {
        actorId: input.adminId,
        action: 'RUNTIME_BUNDLE_DEPLOYMENT_PROMOTED',
        entityType: 'ModelDeployment',
        entityId: deployment.id,
        payloadJson: JSON.stringify({ rolloutPercent: input.rolloutPercent, runtimeBundleId: bundle.id, change }),
      },
    });
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
    await tx.dataLabAuditLog.create({ data: { actorId: input.adminId, action: 'MODEL_DEPLOYMENT_ROLLED_BACK', entityType: 'ModelDeployment', entityId: rollback.id, payloadJson: JSON.stringify({ rolledBackDeploymentId: active.id }) } });
    return rollback;
  });
}

export async function rollbackRuntimeDeployment(input: { deploymentId: string; adminId: string }) {
  const active = await db.modelDeployment.findUnique({
    where: { id: input.deploymentId },
    include: { runtimeBundle: true, previousRuntimeBundle: true },
  });
  if (!active || active.status !== 'ACTIVE' || !active.runtimeBundleId || !active.previousModelVersionId) {
    throw new Error('当前运行组合部署不可回滚或没有上一运行组合');
  }
  return db.$transaction(async (tx) => {
    await tx.modelDeployment.update({ where: { id: active.id }, data: { status: 'ROLLED_BACK', endedAt: new Date() } });
    const rollback = await tx.modelDeployment.create({
      data: {
        modelVersionId: active.previousModelVersionId!,
        previousModelVersionId: active.modelVersionId,
        runtimeBundleId: active.previousRuntimeBundleId,
        previousRuntimeBundleId: active.runtimeBundleId,
        environment: active.environment,
        rolloutPercent: 100,
        status: 'ACTIVE',
        gateReportJson: JSON.stringify({ reason: 'RUNTIME_BUNDLE_ROLLBACK', rolledBackDeploymentId: active.id }),
        createdById: input.adminId,
        startedAt: new Date(),
      },
    });
    await tx.runtimeBundle.update({ where: { id: active.runtimeBundleId! }, data: { status: 'AVAILABLE' } });
    if (active.previousRuntimeBundleId) {
      await tx.runtimeBundle.update({ where: { id: active.previousRuntimeBundleId }, data: { status: 'DEPLOYED' } });
    }
    await tx.dataLabAuditLog.create({
      data: {
        actorId: input.adminId,
        action: 'RUNTIME_BUNDLE_DEPLOYMENT_ROLLED_BACK',
        entityType: 'ModelDeployment',
        entityId: rollback.id,
        payloadJson: JSON.stringify({
          rolledBackDeploymentId: active.id,
          preservedPinnedConversations: true,
          previousRuntimeBundleId: active.previousRuntimeBundleId,
        }),
      },
    });
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
  const existing = parseJson<Record<string, unknown>>(deployment.observationJson, {});
  const updated = await db.modelDeployment.update({ where: { id: deployment.id }, data: { observationJson: JSON.stringify({ ...existing, ...input.observation, recordedAt: new Date().toISOString() }) } });
  await db.dataLabAuditLog.create({ data: { actorId: input.adminId, action: 'DEPLOYMENT_OBSERVATION_UPDATED', entityType: 'ModelDeployment', entityId: deployment.id, payloadJson: JSON.stringify(input.observation) } });
  return updated;
}

export async function setDeploymentPromotionPaused(input: {
  deploymentId: string;
  paused: boolean;
  adminId: string;
}) {
  const deployment = await db.modelDeployment.findUnique({ where: { id: input.deploymentId } });
  if (!deployment || deployment.status !== 'ACTIVE' || ![10, 30].includes(deployment.rolloutPercent)) {
    throw new Error('只有 ACTIVE 的 10%/30% 灰度可以暂停或恢复晋级');
  }
  const observation = parseJson<Record<string, unknown>>(deployment.observationJson, {});
  const updated = await db.modelDeployment.update({
    where: { id: deployment.id },
    data: { observationJson: JSON.stringify({ ...observation, promotionPaused: input.paused, promotionPauseUpdatedAt: new Date().toISOString() }) },
  });
  await db.dataLabAuditLog.create({
    data: {
      actorId: input.adminId,
      action: input.paused ? 'DEPLOYMENT_PROMOTION_PAUSED' : 'DEPLOYMENT_PROMOTION_RESUMED',
      entityType: 'ModelDeployment',
      entityId: deployment.id,
      payloadJson: JSON.stringify({ paused: input.paused }),
    },
  });
  return updated;
}

export async function resolveConversationModel(conversationId: string) {
  const pinned = await loadPinnedConversationModel(conversationId);
  if (pinned) return pinned;
  const active = await db.modelDeployment.findFirst({
    where: { environment: 'PRODUCTION', status: 'ACTIVE' },
    orderBy: { startedAt: 'desc' },
  });
  if (!active) throw new Error('当前没有 ACTIVE 生产部署，请先运行 npm run model:bootstrap');
  if (active.runtimeBundleId) {
    const useCandidate = !active.previousModelVersionId
      || active.rolloutPercent >= 100
      || stableRolloutBucket(conversationId) < active.rolloutPercent;
    const selectedRuntimeBundleId = useCandidate ? active.runtimeBundleId : active.previousRuntimeBundleId;
    const selectedModelVersionId = useCandidate ? active.modelVersionId : active.previousModelVersionId;
    await db.conversation.updateMany({
      where: { id: conversationId, deployedModelVersionId: null, deployedRuntimeBundleId: null },
      data: {
        deployedModelVersionId: selectedModelVersionId,
        deployedRuntimeBundleId: selectedRuntimeBundleId,
      },
    });
    const resolved = await loadPinnedConversationModel(conversationId);
    if (!resolved) throw new Error('会话模型固定失败，请重试');
    return resolved;
  }
  const modelId = chooseRolloutModel({ stableKey: conversationId, rolloutPercent: active.rolloutPercent, candidateModelId: active.modelVersionId, previousModelId: active.previousModelVersionId });
  await db.conversation.updateMany({
    where: { id: conversationId, deployedModelVersionId: null, deployedRuntimeBundleId: null },
    data: { deployedModelVersionId: modelId },
  });
  const resolved = await loadPinnedConversationModel(conversationId);
  if (!resolved) throw new Error('会话模型固定失败，请重试');
  return resolved;
}
