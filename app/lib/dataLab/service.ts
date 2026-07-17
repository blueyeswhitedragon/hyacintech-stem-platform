import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { db } from '@/app/lib/db';
import type { SessionUser } from '@/app/lib/session';
import type { UserRole } from '@/app/lib/roles';
import { TUTOR_LANGUAGE_CONTRACT_VERSION, TUTOR_LANGUAGE_PROMPT_VERSIONS, type TutorLanguagePromptVersion } from '@/app/lib/tutorLanguage';
import { EXTRACTOR_VERSION } from '@/app/lib/stateExtractor';
import {
  STYLE_FAMILIES,
  type AutoCheckResult,
  type AnnotationClaimAvailability,
  type AnnotationPayload,
  type CampaignParticipantInput,
  type CampaignSelection,
  type ReleaseRecipe,
  type RevisionInput,
  type ShareGPTRecord,
  type StyleQuota,
  TRANSFORMATION_TYPES,
  type TransformationType,
  type WorkReviewStatus,
} from './types';
import { chooseAnnotationCandidate, claimUnavailableReason, hasMeaningfulDraft, styleForSample } from './assignment';
import { DEFAULT_STYLE_POLICY_VERSION, isStyleFamily, type StyleFamily } from '@/app/lib/stylePolicy';
import {
  resolveRecordStyle,
  summarizeStyles,
  toTrainingShareGPTRecords,
  withStyleMetadata,
  type RecordStyle,
} from './styleMetadata';
import {
  canonicalizeRecord,
  familyKey,
  parseAssistantResponse,
  parseJson,
  parseShareGPTDataset,
  normalizeLegacyEmptyStage2Schemas,
  sha256,
  validateAnnotationRevision,
  validateShareGPTRecord,
} from './validation';
import {
  buildPreferenceRecord,
  evaluateTrainingEligibility,
  TRAINING_POLICY_VERSION,
} from '@/app/lib/trainingEligibility';
import { refreshModelDeploymentGate } from '@/app/lib/deployment';
import {
  DATASET_BATCH_STATUSES,
  isTrainableBatchStatus,
  resolveImportedBatchStatus,
} from './datasetPolicy';

const DATA_LAB_ROLES: UserRole[] = ['annotator', 'reviewer', 'admin'];
const REVIEW_ROLES: UserRole[] = ['reviewer', 'admin'];
const ADMIN_ROLES: UserRole[] = ['admin'];
const LEASE_MS = 45 * 60 * 1000;
const RELEASE_DIR = process.env.DATA_LAB_USE_TEST_RELEASE_DIR === 'true'
  ? path.join(process.cwd(), 'tmp', 'data-lab-releases')
  : path.join(process.cwd(), 'data', 'releases');

export function canUseDataLab(role: UserRole) {
  return DATA_LAB_ROLES.includes(role);
}

export function canReview(role: UserRole) {
  return REVIEW_ROLES.includes(role);
}

export function isAdmin(role: UserRole) {
  return ADMIN_ROLES.includes(role);
}

export async function audit(actorId: string, action: string, entityType: string, entityId: string, payload: unknown = {}) {
  await db.dataLabAuditLog.create({
    data: { actorId, action, entityType, entityId, payloadJson: JSON.stringify(payload) },
  });
}

function candidateTier(record: ShareGPTRecord): string {
  return typeof record.meta?.tier === 'string' ? record.meta.tier : 'silver';
}

function sourceKind(record: ShareGPTRecord): string {
  return typeof record.meta?.sourceKind === 'string' ? record.meta.sourceKind : record.source ?? 'unknown';
}

export async function importDatasetBatch(input: {
  name: string;
  sourceType: string;
  sourceFileName: string;
  raw: string;
  manifest?: unknown;
  status?: string;
  user: SessionUser;
}) {
  const records = parseShareGPTDataset(input.raw).map(canonicalizeRecord);
  const fileSha = sha256(input.raw);
  if (input.status && !DATASET_BATCH_STATUSES.includes(input.status as (typeof DATASET_BATCH_STATUSES)[number])) {
    throw new Error(`未知批次状态：${input.status}`);
  }
  const policy = resolveImportedBatchStatus({
    name: input.name,
    sourceFileName: input.sourceFileName,
    recordIds: records.map((record) => record.id),
    requestedStatus: input.status as (typeof DATASET_BATCH_STATUSES)[number] | undefined,
  });
  const effectiveStatus = policy.status;
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) throw new Error(`导入文件存在重复 ID：${record.id}`);
    seen.add(record.id);
  }
  const existing = await db.datasetSample.findMany({
    where: { sourceRecordId: { in: records.map((record) => record.id) } },
    select: { sourceRecordId: true },
  });
  if (existing.length > 0) throw new Error(`已有 ${existing.length} 条相同 sourceRecordId，导入已取消`);

  const byPhase: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  const checks = records.map((record) => {
    byPhase[`P${record.phase}`] = (byPhase[`P${record.phase}`] ?? 0) + 1;
    const tier = candidateTier(record);
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    return validateShareGPTRecord(record);
  });
  const summary = {
    records: records.length,
    usagePolicy: {
      status: effectiveStatus,
      reason: policy.reason,
    },
    byPhase,
    byTier,
    autoCheck: {
      ok: checks.filter((check) => check.status === 'ok').length,
      warning: checks.filter((check) => check.status === 'warning').length,
      error: checks.filter((check) => check.status === 'error').length,
    },
  };

  const batch = await db.$transaction(async (tx) => {
    const created = await tx.datasetBatch.create({
      data: {
        name: input.name,
        sourceType: input.sourceType,
        sourceFileName: input.sourceFileName,
        sourceSha256: fileSha,
        status: effectiveStatus,
        manifestJson: JSON.stringify(input.manifest ?? {}),
        summaryJson: JSON.stringify(summary),
        importedById: input.user.id,
      },
    });
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      await tx.datasetSample.create({
        data: {
          batchId: created.id,
          sourceRecordId: record.id,
          familyKey: familyKey(record),
          phase: record.phase,
          scenario: record.scenario,
          sourceKind: sourceKind(record),
          candidateTier: candidateTier(record),
          rubricTargetsJson: JSON.stringify(record.rubricTargets ?? []),
          autoCheckJson: JSON.stringify(checks[index]),
          originalRecordJson: JSON.stringify(record),
        },
      });
    }
    return created;
  });
  await audit(input.user.id, 'DATASET_BATCH_IMPORTED', 'DatasetBatch', batch.id, summary);
  return { batch, summary };
}

export async function dataLabOverview(user: SessionUser) {
  const [batches, samples, campaigns, pendingTasks, pendingWorkReviews, approvedWork, pendingReviews, releases, trainingRuns, evaluations] = await Promise.all([
    db.datasetBatch.count(),
    db.datasetSample.count(),
    db.annotationCampaign.count(),
    isAdmin(user.role) ? db.annotationTask.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] } } }) : db.annotationTask.count({ where: { assignedToId: user.id, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
    isAdmin(user.role) ? db.annotationWorkReview.count({ where: { status: 'PENDING' } }) : Promise.resolve(0),
    isAdmin(user.role) ? db.annotationWorkReview.count({ where: { status: 'APPROVED' } }) : Promise.resolve(0),
    canReview(user.role) ? db.reviewCase.count({ where: { status: { in: ['PENDING', 'IN_REVIEW'] } } }) : Promise.resolve(0),
    db.datasetRelease.count(),
    db.trainingRun.count(),
    db.evaluationRun.count(),
  ]);
  return { batches, samples, campaigns, pendingTasks, pendingWorkReviews, approvedWork, pendingReviews, releases, trainingRuns, evaluations };
}

export async function listBatches() {
  return db.datasetBatch.findMany({
    orderBy: { importedAt: 'desc' },
    include: { importedBy: { select: { displayName: true } }, _count: { select: { samples: true } } },
  });
}

export async function batchDetail(id: string) {
  return db.datasetBatch.findUnique({
    where: { id },
    include: {
      importedBy: { select: { displayName: true } },
      samples: { orderBy: [{ phase: 'asc' }, { sourceRecordId: 'asc' }], take: 100 },
      _count: { select: { samples: true } },
    },
  });
}

function selectedByCampaign(sample: { batchId: string; phase: number; candidateTier: string }, selection: CampaignSelection) {
  return (!selection.batchIds?.length || selection.batchIds.includes(sample.batchId))
    && (!selection.phases?.length || selection.phases.includes(sample.phase))
    && (!selection.candidateTiers?.length || selection.candidateTiers.includes(sample.candidateTier));
}

function doubleReviewSilver(sampleId: string, percent: number): boolean {
  const bucket = Number.parseInt(sha256(sampleId).slice(0, 8), 16) % 100;
  return bucket < percent;
}

function stratifiedCampaignSamples<T extends { phase: number; sourceKind: string; familyKey: string }>(samples: T[], limit?: number): T[] {
  if (!limit || limit <= 0 || samples.length <= limit) return samples;
  const queues = new Map<string, T[]>();
  for (const sample of samples) {
    const key = `${sample.phase}:${sample.sourceKind}`;
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key)?.push(sample);
  }
  const result: T[] = [];
  const usedFamilies = new Set<string>();
  while (result.length < limit) {
    let added = false;
    for (const queue of queues.values()) {
      const nextIndex = queue.findIndex((sample) => !usedFamilies.has(sample.familyKey));
      const index = nextIndex >= 0 ? nextIndex : (queue.length > 0 ? 0 : -1);
      if (index < 0) continue;
      const [sample] = queue.splice(index, 1);
      result.push(sample);
      usedFamilies.add(sample.familyKey);
      added = true;
      if (result.length >= limit) break;
    }
    if (!added) break;
  }
  return result;
}

export async function createCampaign(input: {
  name: string;
  selection: CampaignSelection;
  styleQuota?: StyleQuota;
  goldSlots?: number;
  silverDoubleReviewPercent?: number;
  maxActivePerAnnotator?: number;
  participants?: CampaignParticipantInput[];
  user: SessionUser;
}) {
  if (input.selection.batchIds?.length) {
    const selectedBatches = await db.datasetBatch.findMany({
      where: { id: { in: input.selection.batchIds } },
      select: { id: true, name: true, status: true },
    });
    if (selectedBatches.length !== input.selection.batchIds.length) throw new Error('选择的数据批次不存在');
    const blocked = selectedBatches.filter((batch) => !isTrainableBatchStatus(batch.status));
    if (blocked.length) {
      throw new Error(`以下批次已隔离，不能下发标注任务：${blocked.map((batch) => batch.name).join('、')}`);
    }
  }
  const participantMap = new Map((input.participants ?? []).map((item) => [item.userId, Math.max(0, Math.floor(item.taskLimit ?? 0))]));
  const participantIds = [...participantMap.keys()];
  if (participantIds.length > 0) {
    const eligible = await db.user.count({ where: { id: { in: participantIds }, role: 'annotator', isActive: true } });
    if (eligible !== participantIds.length) throw new Error('参与人员中包含不存在或非标注员账号');
  }
  const campaign = await db.$transaction(async (tx) => {
    const created = await tx.annotationCampaign.create({
      data: {
        name: input.name,
        selectionJson: JSON.stringify(input.selection),
        styleQuotaJson: JSON.stringify(input.styleQuota ?? Object.fromEntries(STYLE_FAMILIES.map((style) => [style, 1]))),
        stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION,
        goldSlots: Math.min(3, Math.max(1, input.goldSlots ?? 2)),
        silverDoubleReviewPercent: Math.min(100, Math.max(0, input.silverDoubleReviewPercent ?? 30)),
        maxActivePerAnnotator: Math.max(1, input.maxActivePerAnnotator ?? 1),
        createdById: input.user.id,
      },
    });
    if (participantIds.length > 0) {
      await tx.campaignParticipant.createMany({
        data: participantIds.map((userId) => ({ campaignId: created.id, userId, taskLimit: participantMap.get(userId) ?? 0 })),
      });
    }
    return created;
  });
  await audit(input.user.id, 'CAMPAIGN_CREATED', 'AnnotationCampaign', campaign.id, input);
  return campaign;
}

export async function startCampaign(id: string, user: SessionUser) {
  const campaign = await db.annotationCampaign.findUnique({ where: { id } });
  if (!campaign) throw new Error('标注活动不存在');
  if (campaign.status !== 'DRAFT') throw new Error('只有草稿活动可以启动');
  const selection = parseJson<CampaignSelection>(campaign.selectionJson, {});
  const styles = parseJson<StyleQuota>(campaign.styleQuotaJson, Object.fromEntries(STYLE_FAMILIES.map((style) => [style, 1])) as StyleQuota);
  const matchedSamples = (await db.datasetSample.findMany({ include: { batch: { select: { status: true } }, productionCandidate: { select: { status: true } } }, orderBy: [{ phase: 'asc' }, { sourceRecordId: 'asc' }] }))
    .filter((sample) => isTrainableBatchStatus(sample.batch.status))
    .filter((sample) => !sample.productionCandidate || sample.productionCandidate.status === 'CONVERTED')
    .filter((sample) => selectedByCampaign(sample, selection));
  const samples = stratifiedCampaignSamples(matchedSamples, selection.limit);
  if (samples.length === 0) throw new Error('筛选条件没有匹配样本');

  await db.$transaction(async (tx) => {
    let styleIndex = 0;
    for (const sample of samples) {
      const gold = sample.candidateTier === 'gold_candidate';
      const slots = gold ? campaign.goldSlots : (doubleReviewSilver(sample.id, campaign.silverDoubleReviewPercent) ? 2 : 1);
      const styleFamily = styleForSample(styleIndex, styles);
      for (let slot = 1; slot <= slots; slot++) {
        await tx.annotationTask.create({
          data: {
            campaignId: campaign.id,
            sampleId: sample.id,
            slot,
            styleFamily,
            stylePolicyVersion: campaign.stylePolicyVersion,
          },
        });
      }
      styleIndex++;
    }
    await tx.annotationCampaign.update({ where: { id }, data: { status: 'ACTIVE', startedAt: new Date() } });
  });
  await audit(user.id, 'CAMPAIGN_STARTED', 'AnnotationCampaign', id, { samples: samples.length });
  return { samples: samples.length };
}

export async function listCampaigns() {
  return db.annotationCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { displayName: true } },
      _count: { select: { tasks: true, reviewCases: true } },
    },
  });
}

export async function listAssignableAnnotators() {
  return db.user.findMany({
    where: { role: 'annotator', isActive: true },
    orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
    select: { id: true, username: true, displayName: true },
  });
}

export async function listCampaignProgress() {
  const campaigns = await db.annotationCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { displayName: true } },
      participants: { where: { active: true }, select: { taskLimit: true, user: { select: { displayName: true } } } },
      tasks: {
        select: {
          status: true,
          sampleId: true,
          draftJson: true,
          workReviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
        },
      },
      reviewCases: { select: { status: true } },
      releases: { select: { id: true } },
    },
  });
  return campaigns.map((campaign) => {
    const bySample = new Map<string, typeof campaign.tasks>();
    for (const task of campaign.tasks) bySample.set(task.sampleId, [...(bySample.get(task.sampleId) ?? []), task]);
    const approvedTasks = campaign.tasks.filter((task) => task.workReviews[0]?.status === 'APPROVED').length;
    const unfinishedTasks = campaign.tasks.filter((task) => ['PENDING', 'IN_PROGRESS', 'RETURNED'].includes(task.status));
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      createdBy: campaign.createdBy,
      completedAt: campaign.completedAt?.toISOString() ?? null,
      participantCount: campaign.participants.length,
      taskCount: campaign.tasks.length,
      submittedTaskCount: campaign.tasks.filter((task) => task.status === 'SUBMITTED').length,
      cancelledTaskCount: campaign.tasks.filter((task) => task.status === 'CANCELLED').length,
      unfinishedTaskCount: unfinishedTasks.length,
      inProgressTaskCount: unfinishedTasks.filter((task) => ['IN_PROGRESS', 'RETURNED'].includes(task.status)).length,
      draftTaskCount: unfinishedTasks.filter((task) => hasMeaningfulDraft(task.draftJson)).length,
      approvedTaskCount: approvedTasks,
      pendingWorkReviewCount: campaign.tasks.filter((task) => task.workReviews[0]?.status === 'PENDING').length,
      sampleCount: bySample.size,
      completedSampleCount: [...bySample.values()].filter((tasks) => tasks.length > 0 && tasks.every((task) => task.workReviews[0]?.status === 'APPROVED')).length,
      pendingReviewCount: campaign.reviewCases.filter((item) => ['PENDING', 'IN_REVIEW'].includes(item.status)).length,
      decidedReviewCount: campaign.reviewCases.filter((item) => item.status === 'DECIDED').length,
      releaseCount: campaign.releases.length,
      canDelete: campaign.status === 'DRAFT'
        && campaign.tasks.length === 0
        && campaign.reviewCases.length === 0
        && campaign.releases.length === 0,
    };
  });
}

export async function archiveCampaign(id: string, reason: string, user: SessionUser) {
  if (!isAdmin(user.role)) throw new Error('仅管理员可以结束标注活动');
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('请填写结束活动的原因');

  return db.$transaction(async (tx) => {
    const campaign = await tx.annotationCampaign.findUnique({
      where: { id },
      include: {
        tasks: {
          select: {
            status: true,
            draftJson: true,
            workReviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
          },
        },
        reviewCases: { select: { status: true } },
        releases: { select: { id: true } },
      },
    });
    if (!campaign) throw new Error('标注活动不存在');
    if (campaign.status === 'DRAFT') throw new Error('草稿活动尚未产生任务，请使用永久删除');
    if (campaign.status === 'ARCHIVED') throw new Error('标注活动已经归档');
    if (campaign.status !== 'ACTIVE') throw new Error('只有进行中的活动可以结束并归档');

    const unfinished = campaign.tasks.filter((task) => ['PENDING', 'IN_PROGRESS', 'RETURNED'].includes(task.status));
    const cancelled = await tx.annotationTask.updateMany({
      where: { campaignId: id, status: { in: ['PENDING', 'IN_PROGRESS', 'RETURNED'] } },
      data: { status: 'CANCELLED', leaseExpiresAt: null },
    });
    await tx.campaignParticipant.updateMany({ where: { campaignId: id, active: true }, data: { active: false } });
    await tx.annotationCampaign.update({
      where: { id },
      data: { status: 'ARCHIVED', completedAt: new Date() },
    });

    const summary = {
      reason: trimmedReason,
      previousStatus: campaign.status,
      cancelledTaskCount: cancelled.count,
      inProgressTaskCount: unfinished.filter((task) => ['IN_PROGRESS', 'RETURNED'].includes(task.status)).length,
      draftTaskCount: unfinished.filter((task) => hasMeaningfulDraft(task.draftJson)).length,
      submittedTaskCount: campaign.tasks.filter((task) => task.status === 'SUBMITTED').length,
      pendingWorkReviewCount: campaign.tasks.filter((task) => task.workReviews[0]?.status === 'PENDING').length,
      pendingReviewCount: campaign.reviewCases.filter((item) => ['PENDING', 'IN_REVIEW'].includes(item.status)).length,
      releaseCount: campaign.releases.length,
    };
    await tx.dataLabAuditLog.create({
      data: {
        actorId: user.id,
        action: 'CAMPAIGN_ARCHIVED',
        entityType: 'AnnotationCampaign',
        entityId: id,
        payloadJson: JSON.stringify(summary),
      },
    });
    return summary;
  });
}

export async function deleteDraftCampaign(id: string, user: SessionUser) {
  if (!isAdmin(user.role)) throw new Error('仅管理员可以删除标注活动');
  return db.$transaction(async (tx) => {
    const campaign = await tx.annotationCampaign.findUnique({
      where: { id },
      include: { _count: { select: { tasks: true, reviewCases: true, releases: true } } },
    });
    if (!campaign) throw new Error('标注活动不存在');
    if (campaign.status !== 'DRAFT') throw new Error('已启动的活动必须归档，不能永久删除');
    if (campaign._count.tasks > 0 || campaign._count.reviewCases > 0 || campaign._count.releases > 0) {
      throw new Error('该活动已有任务、仲裁或发布记录，不能永久删除');
    }
    await tx.annotationCampaign.delete({ where: { id } });
    await tx.dataLabAuditLog.create({
      data: {
        actorId: user.id,
        action: 'UNUSED_CAMPAIGN_DELETED',
        entityType: 'AnnotationCampaign',
        entityId: id,
        payloadJson: JSON.stringify({ name: campaign.name }),
      },
    });
    return { ok: true };
  });
}

async function taskPayload(taskId: string, userId: string): Promise<AnnotationPayload> {
  const task = await db.annotationTask.findUnique({
    where: { id: taskId },
    include: { sample: true },
  });
  if (!task || task.assignedToId !== userId) throw new Error('任务不存在或未分配给当前用户');
  const record = parseJson<ShareGPTRecord>(task.sample.originalRecordJson, {} as ShareGPTRecord);
  const rawDraft = parseJson<Partial<RevisionInput>>(task.draftJson, {});
  const draft = Array.isArray(rawDraft.assistantMessages)
    ? normalizeLegacyEmptyStage2Schemas(rawDraft as RevisionInput).input
    : undefined;
  return {
    taskId: task.id,
    sampleId: task.sampleId,
    sourceRecordId: task.sample.sourceRecordId,
    sourceKind: task.sample.sourceKind,
    phase: task.sample.phase,
    scenario: task.sample.scenario,
    styleFamily: task.styleFamily as StyleFamily | null,
    stylePolicyVersion: task.stylePolicyVersion,
    conversations: record.conversations.map((message, index) => ({
      index,
      from: message.from,
      value: message.from === 'human' ? message.value : '',
      response: message.from === 'gpt' ? parseAssistantResponse(message.value) : undefined,
    })),
    autoCheck: parseJson<AutoCheckResult>(task.sample.autoCheckJson, { status: 'error', issues: [] }),
    rubricTargets: parseJson<string[]>(task.sample.rubricTargetsJson, []),
    draft,
    leaseExpiresAt: task.leaseExpiresAt?.toISOString() ?? null,
  };
}

async function annotationExposure(userId: string) {
  const [assigned, claimAudits] = await Promise.all([
    db.annotationTask.findMany({
      where: { assignedToId: userId },
      select: { id: true, campaignId: true, sampleId: true, updatedAt: true, sample: { select: { familyKey: true } } },
    }),
    db.dataLabAuditLog.findMany({
      where: { actorId: userId, action: 'ANNOTATION_TASK_CLAIMED', entityType: 'AnnotationTask' },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true },
      take: 1000,
    }),
  ]);
  const auditedIds = [...new Set(claimAudits.map((item) => item.entityId))];
  const audited = auditedIds.length > 0
    ? await db.annotationTask.findMany({
      where: { id: { in: auditedIds } },
      select: { id: true, campaignId: true, sampleId: true, updatedAt: true, sample: { select: { familyKey: true } } },
    })
    : [];
  return [...new Map([...assigned, ...audited].map((item) => [item.id, item])).values()]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

async function annotationCampaignAccess(userId: string) {
  const campaigns = await db.annotationCampaign.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, participants: { where: { active: true }, select: { userId: true, taskLimit: true } } },
  });
  const assigned = await db.annotationTask.groupBy({
    by: ['campaignId'],
    where: { assignedToId: userId, campaignId: { in: campaigns.map((item) => item.id) } },
    _count: { _all: true },
  });
  const assignedCounts = new Map(assigned.map((item) => [item.campaignId, item._count._all]));
  let assignedCampaigns = 0;
  const allowedCampaignIds: string[] = [];
  for (const campaign of campaigns) {
    if (campaign.participants.length === 0) {
      assignedCampaigns++;
      allowedCampaignIds.push(campaign.id);
      continue;
    }
    const participant = campaign.participants.find((item) => item.userId === userId);
    if (!participant) continue;
    assignedCampaigns++;
    if (participant.taskLimit === 0 || (assignedCounts.get(campaign.id) ?? 0) < participant.taskLimit) {
      allowedCampaignIds.push(campaign.id);
    }
  }
  return { activeCampaigns: campaigns.length, assignedCampaigns, allowedCampaignIds };
}

async function availableAnnotationCandidates(now: Date, campaignIds?: string[]) {
  if (campaignIds && campaignIds.length === 0) return [];
  const rows = await db.annotationTask.findMany({
    where: {
      campaign: { status: 'ACTIVE', ...(campaignIds ? { id: { in: campaignIds } } : {}) },
      OR: [
        { status: 'PENDING', assignedToId: null },
        { status: 'IN_PROGRESS', leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: [{ sample: { phase: 'asc' } }, { createdAt: 'asc' }],
    include: { sample: { select: { familyKey: true } } },
    take: 200,
  });
  return rows.filter((item) => item.status === 'PENDING' || !hasMeaningfulDraft(item.draftJson));
}

export async function claimAnnotationTask(user: SessionUser) {
  const now = new Date();
  const active = await db.annotationTask.findFirst({
    where: {
      assignedToId: user.id,
      status: { in: ['IN_PROGRESS', 'RETURNED'] },
      campaign: { status: 'ACTIVE' },
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (active) {
    const expired = !active.leaseExpiresAt || active.leaseExpiresAt <= now;
    if (active.status === 'RETURNED' || expired) {
      const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
      const renewed = await db.annotationTask.updateMany({
        where: {
          id: active.id,
          assignedToId: user.id,
          status: active.status,
          campaign: { status: 'ACTIVE' },
        },
        data: { status: 'IN_PROGRESS', leaseExpiresAt },
      });
      if (renewed.count !== 1) return claimAnnotationTask(user);
      await audit(user.id, 'ANNOTATION_TASK_RENEWED', 'AnnotationTask', active.id, { previousStatus: active.status, expired });
    }
    return taskPayload(active.id, user.id);
  }

  const handled = await annotationExposure(user.id);
  const handledPairs = new Set(handled.map((item) => `${item.campaignId}:${item.sampleId}`));
  const excludedFamilies = new Set(handled.slice(0, 5).map((item) => item.sample.familyKey));
  const access = await annotationCampaignAccess(user.id);
  const candidates = await availableAnnotationCandidates(now, access.allowedCampaignIds);
  const fallback = chooseAnnotationCandidate(
    candidates.map((item) => ({ ...item, familyKey: item.sample.familyKey })),
    handledPairs,
    excludedFamilies,
  );
  if (!fallback) return null;
  const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
  const updated = await db.annotationTask.updateMany({
    where: {
      id: fallback.id,
      draftJson: fallback.draftJson,
      campaign: { status: 'ACTIVE' },
      OR: [
        { status: 'PENDING', assignedToId: null },
        { status: 'IN_PROGRESS', leaseExpiresAt: { lt: now } },
      ],
    },
    data: { assignedToId: user.id, status: 'IN_PROGRESS', leaseExpiresAt, draftJson: '{}' },
  });
  if (updated.count !== 1) return claimAnnotationTask(user);
  await audit(user.id, 'ANNOTATION_TASK_CLAIMED', 'AnnotationTask', fallback.id);
  return taskPayload(fallback.id, user.id);
}

export async function annotationClaimAvailability(user: SessionUser): Promise<AnnotationClaimAvailability> {
  const now = new Date();
  const access = await annotationCampaignAccess(user.id);
  const [candidates, handled] = await Promise.all([
    availableAnnotationCandidates(now, access.allowedCampaignIds),
    annotationExposure(user.id),
  ]);
  const handledPairs = new Set(handled.map((item) => `${item.campaignId}:${item.sampleId}`));
  const blockedByDoubleBlind = candidates.filter((item) => handledPairs.has(`${item.campaignId}:${item.sampleId}`)).length;
  const eligibleForUser = candidates.length - blockedByDoubleBlind;
  return {
    reason: claimUnavailableReason({ activeCampaigns: access.activeCampaigns, assignedCampaigns: access.assignedCampaigns, remainingGlobal: candidates.length, blockedByDoubleBlind }),
    remainingGlobal: candidates.length,
    eligibleForUser,
    blockedByDoubleBlind,
  };
}

export async function claimAnnotationTaskWithStatus(user: SessionUser) {
  const task = await claimAnnotationTask(user);
  if (task) return { task, availability: null };
  return { task: null, availability: await annotationClaimAvailability(user) };
}

export async function saveTaskDraft(taskId: string, input: RevisionInput, user: SessionUser) {
  const normalized = normalizeLegacyEmptyStage2Schemas(input);
  const updated = await db.annotationTask.updateMany({
    where: { id: taskId, assignedToId: user.id, status: 'IN_PROGRESS', campaign: { status: 'ACTIVE' } },
    data: { draftJson: JSON.stringify(normalized.input), leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  if (updated.count !== 1) throw new Error('任务不可编辑，所属活动可能已经结束');
  if (normalized.removedMessageIndexes.length > 0) {
    await audit(user.id, 'EMPTY_STAGE2_SCHEMA_NORMALIZED', 'AnnotationTask', taskId, { messageIndexes: normalized.removedMessageIndexes });
  }
}

export class AnnotationValidationError extends Error {
  constructor(public readonly check: AutoCheckResult) {
    super(check.issues.filter((item) => item.severity === 'error').map((item) => item.message).join('；') || '修订未通过校验');
    this.name = 'AnnotationValidationError';
  }
}

function validateTaskRevision(
  task: { sample: { originalRecordJson: string }; styleFamily: string | null; stylePolicyVersion: string },
  input: RevisionInput,
) {
  const original = parseJson<ShareGPTRecord>(task.sample.originalRecordJson, {} as ShareGPTRecord);
  return validateAnnotationRevision(original, input, {
    mode: 'submit',
    styleFamily: isStyleFamily(task.styleFamily) ? task.styleFamily : null,
    stylePolicyVersion: task.stylePolicyVersion,
  });
}

/** 只读预检：不保存草稿、不续租、不写审计日志。 */
export async function validateAnnotationTaskRevision(taskId: string, input: RevisionInput, user: SessionUser) {
  const task = await db.annotationTask.findUnique({
    where: { id: taskId },
    include: { sample: true, campaign: { select: { status: true } } },
  });
  if (!task || task.assignedToId !== user.id || task.status !== 'IN_PROGRESS' || task.campaign.status !== 'ACTIVE') {
    throw new Error('任务不可校验，所属活动可能已经结束');
  }
  return validateTaskRevision(task, input).check;
}

export async function submitAnnotationTask(taskId: string, input: RevisionInput, user: SessionUser) {
  const task = await db.annotationTask.findUnique({ where: { id: taskId }, include: { sample: true } });
  if (!task || task.assignedToId !== user.id || task.status !== 'IN_PROGRESS') throw new Error('任务不可提交');
  const validation = validateTaskRevision(task, input);
  if (validation.check.status === 'error' || !validation.revisedRecord || !validation.transformationType || !validation.transformationMetrics) {
    throw new AnnotationValidationError(validation.check);
  }
  const normalizedInput = validation.normalizedInput;
  const revised = validation.revisedRecord;
  const transformationType = validation.transformationType;
  const transformationMetrics = validation.transformationMetrics;
  const check = validation.check;
  const style = resolveRecordStyle(revised, task.styleFamily, task.stylePolicyVersion);

  const revision = await db.$transaction(async (tx) => {
    const currentTask = await tx.annotationTask.findFirst({
      where: { id: taskId, assignedToId: user.id, status: 'IN_PROGRESS', campaign: { status: 'ACTIVE' } },
      select: { id: true },
    });
    if (!currentTask) throw new Error('任务不可提交，所属活动可能已经结束');
    const latest = await tx.annotationRevision.findFirst({ where: { taskId }, orderBy: { version: 'desc' } });
    const created = await tx.annotationRevision.create({
      data: {
        taskId,
        sampleId: task.sampleId,
        authorId: user.id,
        version: (latest?.version ?? 0) + 1,
        contentJson: JSON.stringify(normalizedInput.assistantMessages),
        fullRecordJson: JSON.stringify(revised),
        issueTagsJson: JSON.stringify(normalizedInput.issueTags),
        changeReason: normalizedInput.changeReason,
        noChange: normalizedInput.noChange,
        styleFamily: style.styleFamily,
        stylePolicyVersion: style.stylePolicyVersion,
        transformationType,
        transformationMetricsJson: JSON.stringify(transformationMetrics),
        parentRevisionId: latest?.id,
      },
    });
    await tx.annotationWorkReview.create({ data: { taskId, revisionId: created.id, status: 'PENDING' } });
    await tx.annotationTask.update({ where: { id: taskId }, data: { status: 'SUBMITTED', submittedAt: new Date(), draftJson: '{}', leaseExpiresAt: null } });
    return created;
  });
  await audit(user.id, 'ANNOTATION_SUBMITTED', 'AnnotationRevision', revision.id, { check });
  return { revision, check };
}

function revisionDraft(revision: { contentJson: string; issueTagsJson: string; changeReason: string; transformationType?: string }): RevisionInput {
  return {
    assistantMessages: parseJson(revision.contentJson, []),
    issueTags: parseJson(revision.issueTagsJson, []),
    changeReason: revision.changeReason,
    noChange: false,
    transformationType: TRANSFORMATION_TYPES.includes(revision.transformationType as TransformationType)
      ? revision.transformationType as TransformationType
      : undefined,
  };
}

async function ensureReviewCaseReady(campaignId: string, sampleId: string) {
  const tasks = await db.annotationTask.findMany({
    where: { campaignId, sampleId },
    orderBy: { slot: 'asc' },
    include: {
      revisions: { orderBy: { version: 'desc' }, take: 1, include: { workReview: true } },
    },
  });
  if (tasks.length < 2) return;
  if (!tasks.every((task) => task.status === 'SUBMITTED' && task.revisions[0]?.workReview?.status === 'APPROVED')) return;
  const candidateRevisionIds = tasks.map((task) => task.revisions[0].id);
  const existing = await db.reviewCase.findUnique({ where: { campaignId_sampleId: { campaignId, sampleId } } });
  if (existing?.status === 'DECIDED' || existing?.status === 'IN_REVIEW') return;
  await db.reviewCase.upsert({
    where: { campaignId_sampleId: { campaignId, sampleId } },
    update: { candidateRevisionIdsJson: JSON.stringify(candidateRevisionIds), status: 'PENDING', assignedReviewerId: null, assignedAt: null, decidedAt: null },
    create: { campaignId, sampleId, triggerReason: 'MULTI_ANNOTATION', candidateRevisionIdsJson: JSON.stringify(candidateRevisionIds) },
  });
}

export async function reviewAnnotationWork(input: {
  reviewId: string;
  status: Exclude<WorkReviewStatus, 'PENDING'>;
  note?: string;
  user: SessionUser;
}) {
  if (!isAdmin(input.user.role)) throw new Error('仅管理员可以审核工作量');
  const note = input.note?.trim() ?? '';
  if (input.status !== 'APPROVED' && !note) throw new Error('退回或判定无效时必须填写说明');
  const review = await db.annotationWorkReview.findUnique({
    where: { id: input.reviewId },
    include: {
      revision: true,
      task: { include: { campaign: { select: { status: true } }, revisions: { orderBy: { version: 'desc' }, take: 1 } } },
    },
  });
  if (!review || review.status !== 'PENDING') throw new Error('该提交已审核或不存在');
  if (input.status === 'RETURNED' && review.task.campaign.status !== 'ACTIVE') {
    throw new Error('活动已结束，不能再退回给标注员修改；可以审核通过或标记无效');
  }
  if (review.revision.authorId === input.user.id) throw new Error('不能审核自己的标注提交');
  if (review.task.revisions[0]?.id !== review.revisionId) throw new Error('该提交已被更新，请审核最新版本');
  const reviewCase = await db.reviewCase.findUnique({
    where: { campaignId_sampleId: { campaignId: review.task.campaignId, sampleId: review.task.sampleId } },
  });
  if (input.status !== 'APPROVED' && reviewCase && ['IN_REVIEW', 'DECIDED'].includes(reviewCase.status)) {
    throw new Error('该样本已进入或完成数据仲裁，不能再退回工作量');
  }

  if (input.status === 'APPROVED') {
    const check = validateShareGPTRecord(parseJson<ShareGPTRecord>(review.revision.fullRecordJson, {} as ShareGPTRecord), 'submit');
    if (check.status === 'error') {
      throw new AnnotationValidationError(check);
    }
    const duplicate = await db.annotationWorkReview.count({
      where: {
        id: { not: review.id },
        taskId: review.taskId,
        status: 'APPROVED',
        revision: { authorId: review.revision.authorId },
      },
    });
    if (duplicate > 0) throw new Error('该参与者在此任务已有一条通过记录，不能重复计数');
    await db.annotationWorkReview.update({
      where: { id: review.id },
      data: { status: 'APPROVED', note, reviewerId: input.user.id, reviewedAt: new Date() },
    });
    await ensureReviewCaseReady(review.task.campaignId, review.task.sampleId);
  } else {
    await db.$transaction(async (tx) => {
      const campaign = await tx.annotationCampaign.findUnique({ where: { id: review.task.campaignId }, select: { status: true } });
      if (!campaign) throw new Error('标注活动不存在');
      if (input.status === 'RETURNED' && campaign.status !== 'ACTIVE') {
        throw new Error('活动已结束，不能再退回给标注员修改；可以审核通过或标记无效');
      }
      const nextTaskData = input.status === 'RETURNED'
        ? {
            status: 'RETURNED',
            draftJson: JSON.stringify({ ...revisionDraft(review.revision), changeReason: `${review.revision.changeReason}\n工作量审核退回：${note}`.trim() }),
            leaseExpiresAt: null,
            submittedAt: null,
          }
        : campaign.status === 'ACTIVE'
          ? { status: 'PENDING', assignedToId: null, draftJson: '{}', leaseExpiresAt: null, submittedAt: null }
          : { status: 'CANCELLED', leaseExpiresAt: null };
      await tx.annotationWorkReview.update({
        where: { id: review.id },
        data: { status: input.status, note, reviewerId: input.user.id, reviewedAt: new Date() },
      });
      await tx.annotationTask.update({ where: { id: review.taskId }, data: nextTaskData });
      if (reviewCase?.status === 'PENDING') await tx.reviewCase.delete({ where: { id: reviewCase.id } });
    });
  }
  await audit(input.user.id, 'ANNOTATION_WORK_REVIEWED', 'AnnotationWorkReview', review.id, { status: input.status, note });
  return { ok: true };
}

async function currentWorkReviewRows() {
  const rows = await db.annotationWorkReview.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      reviewer: { select: { displayName: true } },
      revision: { include: { author: { select: { id: true, username: true, displayName: true, role: true } } } },
      task: { include: { campaign: { select: { id: true, name: true, status: true } }, sample: { select: { sourceRecordId: true, phase: true, scenario: true } } } },
    },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.taskId}:${row.revision.authorId}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}

export async function workloadDashboard() {
  const [rows, annotators, assignedTasks] = await Promise.all([
    currentWorkReviewRows(),
    db.user.findMany({ where: { role: 'annotator', isActive: true }, orderBy: { displayName: 'asc' }, select: { id: true, username: true, displayName: true, role: true } }),
    db.annotationTask.findMany({ where: { assignedToId: { not: null } }, select: { assignedToId: true, status: true } }),
  ]);
  const people = new Map<string, { id: string; username: string; displayName: string; role: string; assigned: number; inProgress: number; pending: number; approved: number; returned: number; invalid: number }>();
  const ensurePerson = (person: { id: string; username: string; displayName: string; role: string }) => {
    if (!people.has(person.id)) people.set(person.id, { ...person, assigned: 0, inProgress: 0, pending: 0, approved: 0, returned: 0, invalid: 0 });
    return people.get(person.id)!;
  };
  for (const annotator of annotators) ensurePerson(annotator);
  for (const task of assignedTasks) {
    if (!task.assignedToId || !people.has(task.assignedToId)) continue;
    const person = people.get(task.assignedToId)!;
    person.assigned++;
    if (['IN_PROGRESS', 'RETURNED'].includes(task.status)) person.inProgress++;
  }
  for (const row of rows) {
    const person = ensurePerson(row.revision.author);
    if (row.status === 'PENDING') person.pending++;
    if (row.status === 'APPROVED') person.approved++;
    if (row.status === 'RETURNED') person.returned++;
    if (row.status === 'INVALID') person.invalid++;
  }
  const items = rows.slice(0, 300).map((row) => {
    const record = parseJson<ShareGPTRecord>(row.revision.fullRecordJson, {} as ShareGPTRecord);
    const preview = record.conversations.filter((message) => message.from === 'gpt').slice(0, 4).map((message) => parseAssistantResponse(message.value)?.dialogue ?? message.value);
    const check = validateShareGPTRecord(record, 'submit');
    return {
      id: row.id,
      taskId: row.taskId,
      revisionId: row.revisionId,
      participant: row.revision.author,
      campaign: row.task.campaign,
      phase: row.task.sample.phase,
      scenario: row.task.sample.scenario,
      sourceRecordId: row.task.sample.sourceRecordId,
      submittedAt: row.revision.createdAt.toISOString(),
      status: row.status as WorkReviewStatus,
      note: row.note,
      reviewer: row.reviewer,
      preview,
      check,
    };
  });
  return {
    totals: {
      pending: rows.filter((row) => row.status === 'PENDING').length,
      approved: rows.filter((row) => row.status === 'APPROVED').length,
      returned: rows.filter((row) => row.status === 'RETURNED').length,
      invalid: rows.filter((row) => row.status === 'INVALID').length,
    },
    people: [...people.values()].sort((a, b) => b.approved - a.approved || a.displayName.localeCompare(b.displayName, 'zh-CN')),
    items,
  };
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function workloadCsv() {
  const rows = await currentWorkReviewRows();
  const lines = [
    ['参与者账号', '参与者姓名', '活动', '任务ID', '样本ID', '阶段', '场景', '提交版本', '提交时间', '工作量状态', '审核人', '审核时间', '审核说明'],
    ...rows.map((row) => [
      row.revision.author.username,
      row.revision.author.displayName,
      row.task.campaign.name,
      row.taskId,
      row.task.sample.sourceRecordId,
      row.task.sample.phase,
      row.task.sample.scenario,
      row.revision.version,
      row.revision.createdAt.toISOString(),
      row.status,
      row.reviewer?.displayName ?? '',
      row.reviewedAt?.toISOString() ?? '',
      row.note,
    ]),
  ];
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}`;
}

export async function listExpiredAnnotationTasks() {
  const now = new Date();
  const tasks = await db.annotationTask.findMany({
    where: { status: 'IN_PROGRESS', leaseExpiresAt: { lt: now } },
    orderBy: { leaseExpiresAt: 'asc' },
    include: {
      assignedTo: { select: { displayName: true, username: true } },
      sample: { select: { phase: true, scenario: true, sourceRecordId: true } },
      campaign: { select: { name: true } },
    },
    take: 100,
  });
  return tasks.map((task) => ({
    id: task.id,
    campaignName: task.campaign.name,
    phase: task.sample.phase,
    scenario: task.sample.scenario,
    sourceRecordId: task.sample.sourceRecordId,
    assignedTo: task.assignedTo,
    leaseExpiresAt: task.leaseExpiresAt?.toISOString() ?? null,
    hasDraft: hasMeaningfulDraft(task.draftJson),
  }));
}

export async function releaseExpiredAnnotationTask(taskId: string, user: SessionUser) {
  if (!isAdmin(user.role)) throw new Error('仅管理员可以释放过期任务');
  const now = new Date();
  const task = await db.annotationTask.findUnique({ where: { id: taskId } });
  if (!task || task.status !== 'IN_PROGRESS' || !task.leaseExpiresAt || task.leaseExpiresAt >= now) {
    throw new Error('任务不存在或租约尚未过期');
  }
  await db.$transaction([
    db.annotationTask.update({
      where: { id: taskId },
      data: { status: 'PENDING', assignedToId: null, draftJson: '{}', leaseExpiresAt: null, submittedAt: null },
    }),
    db.dataLabAuditLog.create({
      data: {
        actorId: user.id,
        action: 'ANNOTATION_TASK_RELEASED',
        entityType: 'AnnotationTask',
        entityId: taskId,
        payloadJson: JSON.stringify({ previousAssigneeId: task.assignedToId, discardedDraft: hasMeaningfulDraft(task.draftJson) }),
      },
    }),
  ]);
  return { ok: true };
}

export async function myTasks(userId: string) {
  return db.annotationTask.findMany({
    where: { assignedToId: userId },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: { sample: { select: { phase: true, scenario: true, sourceRecordId: true } }, campaign: { select: { name: true } } },
  });
}

export async function claimReviewCase(user: SessionUser) {
  const active = await db.reviewCase.findFirst({ where: { assignedReviewerId: user.id, status: 'IN_REVIEW' } });
  if (active) return reviewPayload(active.id, user.id);
  const pendingCases = await db.reviewCase.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 100 });
  let candidate: (typeof pendingCases)[number] | undefined;
  for (const item of pendingCases) {
    const candidateIds = parseJson<string[]>(item.candidateRevisionIdsJson, []);
    const approvedCount = candidateIds.length > 0
      ? await db.annotationWorkReview.count({ where: { revisionId: { in: candidateIds }, status: 'APPROVED' } })
      : 0;
    if (approvedCount !== candidateIds.length) continue;
    const authored = await db.annotationRevision.count({ where: { sampleId: item.sampleId, authorId: user.id, task: { campaignId: item.campaignId } } });
    if (authored === 0) { candidate = item; break; }
  }
  if (!candidate) return null;
  const updated = await db.reviewCase.updateMany({
    where: { id: candidate.id, status: 'PENDING', assignedReviewerId: null },
    data: { status: 'IN_REVIEW', assignedReviewerId: user.id, assignedAt: new Date() },
  });
  if (updated.count !== 1) return claimReviewCase(user);
  await audit(user.id, 'REVIEW_CASE_CLAIMED', 'ReviewCase', candidate.id);
  return reviewPayload(candidate.id, user.id);
}

async function reviewPayload(reviewCaseId: string, reviewerId: string) {
  const item = await db.reviewCase.findUnique({
    where: { id: reviewCaseId },
    include: { sample: true, campaign: { select: { status: true } } },
  });
  if (!item || item.assignedReviewerId !== reviewerId) throw new Error('复审任务不存在');
  const ids = parseJson<string[]>(item.candidateRevisionIdsJson, []);
  const revisions = await db.annotationRevision.findMany({
    where: { id: { in: ids } },
    orderBy: { id: 'asc' },
    include: { task: { select: { styleFamily: true, stylePolicyVersion: true } } },
  });
  const anonymize = (record: ShareGPTRecord): ShareGPTRecord => ({
    id: 'anonymous',
    scenario: record.scenario,
    phase: record.phase,
    conversations: record.conversations,
  });
  const candidates = revisions
    .map((revision) => {
      const fullRecord = parseJson<ShareGPTRecord>(revision.fullRecordJson, {} as ShareGPTRecord);
      return { id: revision.id, record: anonymize(fullRecord), check: validateShareGPTRecord(fullRecord, 'submit') };
    })
    .sort((a, b) => sha256(`${item.id}:${a.id}`).localeCompare(sha256(`${item.id}:${b.id}`)))
    .map((candidate, index) => ({ label: String.fromCharCode(65 + index), ...candidate }));
  const styleFamilies = [...new Set(revisions.map((revision) => revision.task.styleFamily).filter(isStyleFamily))];
  const styleVersions = [...new Set(revisions.map((revision) => revision.task.stylePolicyVersion))];
  return {
    id: item.id,
    phase: item.sample.phase,
    scenario: item.sample.scenario,
    original: anonymize(parseJson<ShareGPTRecord>(item.sample.originalRecordJson, {} as ShareGPTRecord)),
    candidates,
    styleFamily: styleFamilies.length === 1 ? styleFamilies[0] : null,
    stylePolicyVersion: styleVersions.length === 1 ? styleVersions[0] : DEFAULT_STYLE_POLICY_VERSION,
    styleTargetMismatch: styleFamilies.length > 1,
    campaignStatus: item.campaign.status,
    autoCheck: parseJson(item.sample.autoCheckJson, {}),
  };
}

export async function decideReview(input: {
  reviewCaseId: string;
  action: 'SELECT' | 'MERGE' | 'RETURN' | 'REJECT';
  selectedRevisionId?: string;
  mergedInput?: RevisionInput;
  finalTier: 'human_gold' | 'reviewed_silver' | 'reject';
  rubric?: Record<string, number>;
  reason: string;
  user: SessionUser;
}) {
  const reviewCase = await db.reviewCase.findUnique({
    where: { id: input.reviewCaseId },
    include: { sample: true, campaign: { select: { status: true } } },
  });
  if (!reviewCase || reviewCase.assignedReviewerId !== input.user.id || reviewCase.status !== 'IN_REVIEW') throw new Error('复审任务不可提交');
  const candidateIds = parseJson<string[]>(reviewCase.candidateRevisionIdsJson, []);
  const selfAuthored = await db.annotationRevision.count({ where: { id: { in: candidateIds }, authorId: input.user.id } });
  if (selfAuthored > 0) throw new Error('不能仲裁自己参与修订的样本');
  if (input.selectedRevisionId && !candidateIds.includes(input.selectedRevisionId)) throw new Error('所选 revision 不属于该复审任务');

  if (input.action === 'RETURN') {
    if (reviewCase.campaign.status !== 'ACTIVE') {
      throw new Error('活动已结束，不能再退回给标注员修改；请选择、合并或拒绝现有版本');
    }
    const tasks = await db.annotationTask.findMany({
      where: { campaignId: reviewCase.campaignId, sampleId: reviewCase.sampleId },
      include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    await db.$transaction(async (tx) => {
      const campaign = await tx.annotationCampaign.findUnique({ where: { id: reviewCase.campaignId }, select: { status: true } });
      if (campaign?.status !== 'ACTIVE') {
        throw new Error('活动已结束，不能再退回给标注员修改；请选择、合并或拒绝现有版本');
      }
      for (const task of tasks) {
        const latest = task.revisions[0];
        const draft: RevisionInput | undefined = latest ? {
          assistantMessages: parseJson(latest.contentJson, []),
          issueTags: parseJson(latest.issueTagsJson, []),
          changeReason: `${latest.changeReason}\n复审退回：${input.reason}`.trim(),
          noChange: false,
        } : undefined;
        await tx.annotationTask.update({
          where: { id: task.id },
          data: { status: 'RETURNED', draftJson: JSON.stringify(draft ?? {}), leaseExpiresAt: null, submittedAt: null },
        });
        if (latest) {
          await tx.annotationWorkReview.updateMany({
            where: { revisionId: latest.id, status: { in: ['PENDING', 'APPROVED'] } },
            data: { status: 'RETURNED', note: `数据仲裁退回：${input.reason}`.trim(), reviewerId: input.user.id, reviewedAt: new Date() },
          });
        }
      }
      await tx.reviewCase.update({
        where: { id: reviewCase.id },
        data: { status: 'RETURNED', assignedReviewerId: null, assignedAt: null, decidedAt: null },
      });
    });
    await audit(input.user.id, 'REVIEW_RETURNED', 'ReviewCase', reviewCase.id, { reason: input.reason });
    return { id: reviewCase.id, action: 'RETURN' };
  }

  let mergedRevisionId: string | undefined;
  if (input.action === 'MERGE') {
    if (!input.mergedInput) throw new Error('合并决策必须提交 mergedInput');
    const original = parseJson<ShareGPTRecord>(reviewCase.sample.originalRecordJson, {} as ShareGPTRecord);
    const syntheticTask = await db.annotationTask.findFirst({ where: { campaignId: reviewCase.campaignId, sampleId: reviewCase.sampleId }, orderBy: { slot: 'asc' } });
    if (!syntheticTask) throw new Error('缺少关联标注任务');
    const style = resolveRecordStyle(original, syntheticTask.styleFamily, syntheticTask.stylePolicyVersion);
    const validation = validateAnnotationRevision(original, input.mergedInput, {
      mode: 'submit',
      styleFamily: style.styleFamily,
      stylePolicyVersion: style.stylePolicyVersion,
    });
    if (validation.check.status === 'error' || !validation.revisedRecord || !validation.transformationType || !validation.transformationMetrics) {
      throw new AnnotationValidationError(validation.check);
    }
    const mergedRecord = validation.revisedRecord;
    const mergedMetrics = validation.transformationMetrics;
    const mergedType = validation.transformationType;
    const revision = await db.annotationRevision.create({
      data: {
        taskId: syntheticTask.id,
        sampleId: reviewCase.sampleId,
        authorId: input.user.id,
        version: (await db.annotationRevision.count({ where: { taskId: syntheticTask.id } })) + 1,
        contentJson: JSON.stringify(input.mergedInput.assistantMessages),
        fullRecordJson: JSON.stringify(mergedRecord),
        issueTagsJson: JSON.stringify(input.mergedInput.issueTags),
        changeReason: input.reason,
        noChange: false,
        styleFamily: style.styleFamily,
        stylePolicyVersion: style.stylePolicyVersion,
        transformationType: mergedType,
        transformationMetricsJson: JSON.stringify(mergedMetrics),
      },
    });
    mergedRevisionId = revision.id;
  }

  if (input.action === 'SELECT' && input.selectedRevisionId) {
    const selected = await db.annotationRevision.findUnique({ where: { id: input.selectedRevisionId } });
    if (!selected) throw new Error('所选 revision 不存在');
    const check = validateShareGPTRecord(parseJson<ShareGPTRecord>(selected.fullRecordJson, {} as ShareGPTRecord), 'submit');
    if (check.status === 'error') {
      throw new Error(`所选版本未通过结构契约：${check.issues.filter((item) => item.severity === 'error').map((item) => item.message).join('；')}`);
    }
  }

  const decision = await db.$transaction(async (tx) => {
    const created = await tx.reviewDecision.create({
      data: {
        reviewCaseId: reviewCase.id,
        reviewerId: input.user.id,
        action: input.action,
        selectedRevisionId: input.selectedRevisionId,
        mergedRevisionId,
        finalTier: input.finalTier,
        rubricJson: JSON.stringify(input.rubric ?? {}),
        reason: input.reason,
      },
    });
    await tx.reviewCase.update({ where: { id: reviewCase.id }, data: { status: 'DECIDED', decidedAt: new Date() } });
    return created;
  });
  await audit(input.user.id, 'REVIEW_DECIDED', 'ReviewDecision', decision.id, input);
  return decision;
}

export async function reviewQueueCount() {
  return db.reviewCase.count({ where: { status: { in: ['PENDING', 'IN_REVIEW'] } } });
}

export async function createDatasetRelease(input: {
  version: string;
  campaignId: string;
  recipe?: Partial<ReleaseRecipe>;
  user: SessionUser;
}) {
  const recipe: ReleaseRecipe = {
    goldWeight: input.recipe?.goldWeight ?? 1.5,
    silverWeight: input.recipe?.silverWeight ?? 1,
    includeHumanGold: input.recipe?.includeHumanGold ?? true,
    includeReviewedSilver: input.recipe?.includeReviewedSilver ?? true,
  };
  const release = await db.datasetRelease.create({
    data: { version: input.version, campaignId: input.campaignId, recipeJson: JSON.stringify(recipe), createdById: input.user.id },
  });
  await audit(input.user.id, 'RELEASE_CREATED', 'DatasetRelease', release.id, recipe);
  return release;
}

async function releaseCandidates(campaignId: string) {
  const withdrawnProductionSamples = new Set((await db.productionCandidate.findMany({
    where: { status: 'WITHDRAWN', convertedSampleId: { not: null } },
    select: { convertedSampleId: true },
  })).map((item) => item.convertedSampleId).filter((id): id is string => Boolean(id)));
  const decisions = await db.reviewDecision.findMany({
    where: { reviewCase: { campaignId }, finalTier: { in: ['human_gold', 'reviewed_silver'] } },
    include: {
      reviewCase: true,
      selectedRevision: { include: { workReview: true, task: { select: { styleFamily: true, stylePolicyVersion: true } } } },
      mergedRevision: { include: { task: { select: { styleFamily: true, stylePolicyVersion: true } } } },
    },
  });
  const result = new Map<string, { sampleId: string; revisionId: string; tier: string; recordJson: string; reason: string } & RecordStyle>();
  for (const decision of decisions) {
    if (withdrawnProductionSamples.has(decision.reviewCase.sampleId)) continue;
    if (decision.selectedRevision && decision.selectedRevision.workReview?.status !== 'APPROVED') continue;
    const revision = decision.mergedRevision ?? decision.selectedRevision;
    if (!revision) continue;
    const record = parseJson<ShareGPTRecord>(revision.fullRecordJson, {} as ShareGPTRecord);
    const style = resolveRecordStyle(record, revision.styleFamily ?? revision.task.styleFamily, revision.stylePolicyVersion ?? revision.task.stylePolicyVersion);
    result.set(decision.reviewCase.sampleId, {
      sampleId: decision.reviewCase.sampleId,
      revisionId: revision.id,
      tier: decision.finalTier,
      recordJson: JSON.stringify(withStyleMetadata(record, style)),
      reason: `review:${decision.id}`,
      ...style,
    });
  }

  const singleTasks = await db.annotationTask.findMany({
    where: { campaignId, status: 'SUBMITTED' },
    include: { sample: true, revisions: { orderBy: { version: 'desc' }, take: 1, include: { workReview: true } }, campaign: true },
  });
  const grouped = new Map<string, typeof singleTasks>();
  for (const task of singleTasks) {
    if (!grouped.has(task.sampleId)) grouped.set(task.sampleId, []);
    grouped.get(task.sampleId)?.push(task);
  }
  for (const [sampleId, tasks] of grouped) {
    if (withdrawnProductionSamples.has(sampleId)) continue;
    if (result.has(sampleId) || tasks.length !== 1 || tasks[0].sample.candidateTier === 'gold_candidate') continue;
    const revision = tasks[0].revisions[0];
    if (!revision || revision.workReview?.status !== 'APPROVED') continue;
    const record = parseJson<ShareGPTRecord>(revision.fullRecordJson, {} as ShareGPTRecord);
    const style = resolveRecordStyle(record, revision.styleFamily ?? tasks[0].styleFamily, revision.stylePolicyVersion ?? tasks[0].stylePolicyVersion);
    result.set(sampleId, {
      sampleId,
      revisionId: revision.id,
      tier: 'reviewed_silver',
      recordJson: JSON.stringify(withStyleMetadata(record, style)),
      reason: `single-review:${tasks[0].id}`,
      ...style,
    });
  }
  return [...result.values()];
}

export async function freezeDatasetRelease(releaseId: string, user: SessionUser) {
  const release = await db.datasetRelease.findUnique({ where: { id: releaseId } });
  if (!release || !release.campaignId) throw new Error('数据集版本不存在或未关联活动');
  if (release.status !== 'DRAFT') throw new Error('只有草稿版本可以冻结');
  const recipe = parseJson<ReleaseRecipe>(release.recipeJson, {
    goldWeight: 1.5,
    silverWeight: 1,
    includeHumanGold: true,
    includeReviewedSilver: true,
  });
  const candidates = await releaseCandidates(release.campaignId);
  const selected = candidates.filter((item) => item.tier === 'human_gold' ? recipe.includeHumanGold : recipe.includeReviewedSilver);
  if (selected.length === 0) throw new Error('没有符合发布条件的人工审定样本');
  const selectedSamples = await db.datasetSample.findMany({
    where: { id: { in: selected.map((item) => item.sampleId) } },
    include: { batch: { select: { name: true, status: true } } },
  });
  const quarantined = selectedSamples.filter((sample) => !isTrainableBatchStatus(sample.batch.status));
  if (quarantined.length > 0) {
    throw new Error(`发布集中包含 ${quarantined.length} 条隔离数据，来源批次：${[...new Set(quarantined.map((sample) => sample.batch.name))].join('、')}`);
  }
  const invalid = selected.flatMap((item) => {
    const check = validateShareGPTRecord(parseJson<ShareGPTRecord>(item.recordJson, {} as ShareGPTRecord), 'release');
    return check.issues
      .filter((checkIssue) => checkIssue.severity === 'error')
      .map((checkIssue) => `${item.sampleId}: ${checkIssue.message}`);
  });
  if (invalid.length > 0) {
    throw new Error(`发布集中有 ${invalid.length} 个结构契约错误：${invalid.slice(0, 5).join('；')}`);
  }
  const gold = selected.filter((item) => item.tier === 'human_gold').map((item) => parseJson<ShareGPTRecord>(item.recordJson, {} as ShareGPTRecord));
  const silver = selected.filter((item) => item.tier === 'reviewed_silver').map((item) => parseJson<ShareGPTRecord>(item.recordJson, {} as ShareGPTRecord));
  const clean = [...gold, ...silver];
  const eligibilityItems = await Promise.all(selected.map(async (item) => {
    const [sample, revision] = await Promise.all([
      db.datasetSample.findUnique({
        where: { id: item.sampleId },
        include: {
          batch: { select: { status: true } },
          productionCandidate: {
            include: { generationTrace: { include: { conversation: { include: { studentAssignment: true } } } } },
          },
        },
      }),
      db.annotationRevision.findUnique({ where: { id: item.revisionId }, include: { workReview: true } }),
    ]);
    if (!sample || !revision) throw new Error('发布候选缺少样本或修订血缘');
    const candidate = sample.productionCandidate;
    const leakage = candidate ? parseJson<{ blocked?: boolean }>(candidate.leakageCheckJson, {}) : {};
    const metrics = parseJson<import('@/app/lib/trainingEligibility').TransformationMetrics>(revision.transformationMetricsJson, {} as import('@/app/lib/trainingEligibility').TransformationMetrics);
    const result = evaluateTrainingEligibility({
      sourceKind: sample.sourceKind,
      batchStatus: sample.batch.status,
      stageContractVersion: parseJson<ShareGPTRecord>(item.recordJson, {} as ShareGPTRecord).meta?.stageContractVersion as string | undefined,
      candidateStatus: candidate?.status,
      consentStatus: candidate?.generationTrace.conversation.studentAssignment?.dataConsentStatus,
      leakageBlocked: leakage.blocked,
      transformationType: revision.transformationType,
      metrics,
      workReviewApproved: revision.workReview?.status === 'APPROVED' || Boolean(candidate),
      finallySelected: true,
    });
    return { item, sample, revision, candidate, metrics, ...result };
  }));
  const eligibleSelected = eligibilityItems.filter((entry) => entry.eligibility === 'SFT_ALLOWED');
  const training = eligibleSelected.flatMap(({ item }) => toTrainingShareGPTRecords(
    parseJson<ShareGPTRecord>(item.recordJson, {} as ShareGPTRecord),
    { styleFamily: item.styleFamily, stylePolicyVersion: item.stylePolicyVersion },
  ));
  const preference = eligibilityItems.filter((entry) => entry.preferenceAllowed).map(({ item, sample, candidate }) => {
    const chosen = parseJson<ShareGPTRecord>(item.recordJson, {} as ShareGPTRecord);
    const rejected = parseJson<ShareGPTRecord>(sample.originalRecordJson, {} as ShareGPTRecord);
    return buildPreferenceRecord({
      id: `preference-${item.sampleId}`,
      original: rejected,
      chosen,
      meta: {
        sourceKind: sample.sourceKind,
        sourceModelVersionId: candidate?.generationTrace.modelVersionId ?? null,
        styleFamily: item.styleFamily,
        stylePolicyVersion: item.stylePolicyVersion,
      },
    });
  });
  await mkdir(RELEASE_DIR, { recursive: true });
  const safeVersion = release.version.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const cleanPath = path.join(RELEASE_DIR, `sharegpt-${safeVersion}-all.json`);
  const goldPath = path.join(RELEASE_DIR, `sharegpt-${safeVersion}-gold.json`);
  const silverPath = path.join(RELEASE_DIR, `sharegpt-${safeVersion}-silver.json`);
  const trainingPath = path.join(RELEASE_DIR, `sharegpt-${safeVersion}-training.json`);
  const preferencePath = path.join(RELEASE_DIR, `preference-${safeVersion}.json`);
  const manifestPath = path.join(RELEASE_DIR, `manifest-${safeVersion}.json`);
  const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const cleanText = serialize(clean);
  const goldText = serialize(gold);
  const silverText = serialize(silver);
  const trainingText = serialize(training);
  const preferenceText = serialize(preference);
  const byPhase: Record<string, number> = {};
  for (const record of clean) byPhase[`P${record.phase}`] = (byPhase[`P${record.phase}`] ?? 0) + 1;
  const byStyle = summarizeStyles(selected.map((item) => ({ styleFamily: item.styleFamily, stylePolicyVersion: item.stylePolicyVersion })));
  const stylePolicyVersions = [...new Set(selected.map((item) => item.stylePolicyVersion))].sort();
  const manifest = {
    schemaVersion: 3,
    version: release.version,
    frozenAt: new Date().toISOString(),
    recipe,
    trainingExport: {
      format: 'sharegpt-with-system-v1',
      description: '每条记录首条 system 消息包含与在线推理一致的版本化导师风格指令。',
    },
    preferenceExport: { format: 'chosen-rejected-v1', records: preference.length },
    eligibility: {
      policyVersion: TRAINING_POLICY_VERSION,
      sftAllowed: eligibilityItems.filter((item) => item.eligibility === 'SFT_ALLOWED').length,
      monitoringOnly: eligibilityItems.filter((item) => item.eligibility === 'MONITORING_ONLY').length,
      blocked: eligibilityItems.filter((item) => item.eligibility === 'BLOCKED').length,
    },
    summary: { clean: clean.length, training: training.length, preference: preference.length, humanGold: gold.length, reviewedSilver: silver.length, byPhase, byStyle, stylePolicyVersions },
    items: selected.map((item) => ({
      sampleId: item.sampleId,
      revisionId: item.revisionId,
      tier: item.tier,
      reason: item.reason,
      styleFamily: item.styleFamily,
      stylePolicyVersion: item.stylePolicyVersion,
      trainingEligibility: eligibilityItems.find((entry) => entry.item.sampleId === item.sampleId)?.eligibility,
      eligibilityReasons: eligibilityItems.find((entry) => entry.item.sampleId === item.sampleId)?.reasons,
    })),
  };
  const manifestText = serialize(manifest);
  await Promise.all([
    writeFile(cleanPath, cleanText, 'utf8'),
    writeFile(goldPath, goldText, 'utf8'),
    writeFile(silverPath, silverText, 'utf8'),
    writeFile(trainingPath, trainingText, 'utf8'),
    writeFile(preferencePath, preferenceText, 'utf8'),
    writeFile(manifestPath, manifestText, 'utf8'),
  ]);
  await db.$transaction(async (tx) => {
    for (const item of selected) {
      await tx.datasetReleaseItem.create({
        data: {
          releaseId,
          sampleId: item.sampleId,
          revisionId: item.revisionId,
          tier: item.tier,
          weight: item.tier === 'human_gold' ? recipe.goldWeight : recipe.silverWeight,
          inclusionReason: item.reason,
          recordJson: item.recordJson,
          styleFamily: item.styleFamily,
          stylePolicyVersion: item.stylePolicyVersion,
          trainingEligibility: eligibilityItems.find((entry) => entry.item.sampleId === item.sampleId)?.eligibility ?? 'BLOCKED',
          eligibilityReasonJson: JSON.stringify(eligibilityItems.find((entry) => entry.item.sampleId === item.sampleId)?.reasons ?? []),
        },
      });
    }
    await tx.datasetRelease.update({
      where: { id: releaseId },
      data: {
        status: 'FROZEN',
        frozenAt: new Date(),
        summaryJson: JSON.stringify(manifest.summary),
        cleanPath,
        cleanSha256: sha256(cleanText),
        goldPath,
        goldSha256: sha256(goldText),
        silverPath,
        silverSha256: sha256(silverText),
        trainingPath,
        trainingSha256: sha256(trainingText),
        preferencePath,
        preferenceSha256: sha256(preferenceText),
        eligibilityReportJson: JSON.stringify(manifest.eligibility),
        manifestPath,
        manifestSha256: sha256(manifestText),
      },
    });
  });
  await audit(user.id, 'RELEASE_FROZEN', 'DatasetRelease', releaseId, manifest.summary);
  return manifest.summary;
}

export async function listReleases() {
  return db.datasetRelease.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { items: true, trainingRuns: true } } } });
}

export async function releaseForDownload(id: string, kind: 'clean' | 'gold' | 'silver' | 'training' | 'preference' | 'manifest') {
  const release = await db.datasetRelease.findUnique({ where: { id } });
  if (!release || release.status !== 'FROZEN') throw new Error('数据集版本不存在或尚未冻结');
  const filePath = kind === 'clean'
    ? release.cleanPath
    : kind === 'gold'
      ? release.goldPath
      : kind === 'silver'
        ? release.silverPath
        : kind === 'training'
          ? release.trainingPath
          : kind === 'preference'
            ? release.preferencePath
          : release.manifestPath;
  if (!filePath) throw new Error('导出文件不存在');
  return { filePath, fileName: path.basename(filePath) };
}

export async function createTrainingRun(input: {
  name: string;
  releaseId: string;
  baseModel: string;
  externalTaskId?: string;
  parameters?: unknown;
  status?: string;
  modelTag?: string;
  notes?: string;
  parentModelVersionId?: string;
  user: SessionUser;
}) {
  const requestedStatus = input.status ?? 'DRAFT';
  const release = await db.datasetRelease.findUnique({
    where: { id: input.releaseId },
    include: { items: { include: {
      sample: { include: { batch: true, productionCandidate: { include: { generationTrace: { include: { conversation: { include: { studentAssignment: true } } } } } } } },
      finalizedTutorTurn: { include: { case: true } },
      revision: { include: { workReview: true } },
    } } },
  });
  if (!release || release.status !== 'FROZEN') throw new Error('训练只能使用已冻结数据版本');
  if (requestedStatus !== 'DRAFT' && !input.parentModelVersionId) throw new Error('提交或运行训练前必须选择父模型版本');
  if (input.parentModelVersionId && !(await db.modelVersion.findUnique({ where: { id: input.parentModelVersionId } }))) throw new Error('父模型版本不存在');
  const results = release.items.map((item) => {
    if (item.finalizedTutorTurn) {
      const reasons: string[] = [];
      if (item.finalizedTutorTurn.trainingEligibility !== 'SFT_ALLOWED') reasons.push('FINALIZED_TURN_NOT_ELIGIBLE');
      if (item.finalizedTutorTurn.case.split !== 'TRAIN') reasons.push('NON_TRAIN_SPLIT_BLOCKED');
      if (item.finalizedTutorTurn.case.contractVersion !== TUTOR_LANGUAGE_CONTRACT_VERSION) reasons.push('TUTOR_CONTRACT_STALE');
      if (!TUTOR_LANGUAGE_PROMPT_VERSIONS.includes(item.finalizedTutorTurn.case.promptVersion as TutorLanguagePromptVersion)) reasons.push('TUTOR_PROMPT_UNSUPPORTED');
      if (item.finalizedTutorTurn.case.extractorVersion !== EXTRACTOR_VERSION) reasons.push('EXTRACTOR_VERSION_STALE');
      return { eligibility: reasons.length ? 'BLOCKED' as const : 'SFT_ALLOWED' as const, reasons };
    }
    if (!item.sample) return { eligibility: 'BLOCKED' as const, reasons: ['RELEASE_ITEM_SOURCE_XOR_INVALID'] };
    const candidate = item.sample.productionCandidate;
    const leakage = candidate ? parseJson<{ blocked?: boolean }>(candidate.leakageCheckJson, {}) : {};
    const metrics = parseJson<import('@/app/lib/trainingEligibility').TransformationMetrics>(item.revision?.transformationMetricsJson ?? '{}', {} as import('@/app/lib/trainingEligibility').TransformationMetrics);
    const record = parseJson<ShareGPTRecord>(item.recordJson, {} as ShareGPTRecord);
    return evaluateTrainingEligibility({ sourceKind: item.sample.sourceKind, batchStatus: item.sample.batch.status, stageContractVersion: record.meta?.stageContractVersion as string | undefined, candidateStatus: candidate?.status, consentStatus: candidate?.generationTrace.conversation.studentAssignment?.dataConsentStatus, leakageBlocked: leakage.blocked, transformationType: item.revision?.transformationType, metrics, workReviewApproved: item.revision?.workReview?.status === 'APPROVED' || Boolean(candidate), finallySelected: true });
  });
  const report = { policyVersion: TRAINING_POLICY_VERSION, checkedAt: new Date().toISOString(), parentModelVersionId: input.parentModelVersionId ?? null, sftAllowed: results.filter((result) => result.eligibility === 'SFT_ALLOWED').length, monitoringOnly: results.filter((result) => result.eligibility === 'MONITORING_ONLY').length, blocked: results.filter((result) => result.eligibility === 'BLOCKED').length, reasons: [...new Set(results.flatMap((result) => result.reasons))] };
  if (requestedStatus !== 'DRAFT' && (report.blocked > 0 || report.sftAllowed === 0)) throw new Error(`训练资格检查未通过：可训练 ${report.sftAllowed}，阻断 ${report.blocked}；${report.reasons.join('、')}`);
  const run = await db.trainingRun.create({
    data: {
      name: input.name,
      releaseId: input.releaseId,
      baseModel: input.baseModel,
      externalTaskId: input.externalTaskId,
      parametersJson: JSON.stringify(input.parameters ?? {}),
      status: requestedStatus,
      modelTag: input.modelTag,
      notes: input.notes ?? '',
      parentModelVersionId: input.parentModelVersionId || null,
      eligibilityReportJson: JSON.stringify(report),
      policyVersion: TRAINING_POLICY_VERSION,
      createdById: input.user.id,
    },
  });
  await audit(input.user.id, 'TRAINING_RUN_CREATED', 'TrainingRun', run.id, input);
  return run;
}

export async function listTrainingRuns() {
  return db.trainingRun.findMany({ orderBy: { createdAt: 'desc' }, include: { release: { select: { version: true } }, parentModelVersion: { select: { tag: true } }, createdBy: { select: { displayName: true } } } });
}

interface ImportedArtifact {
  schemaVersion?: number;
  tag?: string;
  scope?: string;
  tags?: { A?: string; B?: string };
  summary?: unknown;
  styleFamily?: string;
  stylePolicyVersion?: string;
}

export async function importEvaluation(input: {
  name: string;
  files: Array<{ fileName: string; raw: string }>;
  user: SessionUser;
}) {
  if (input.files.length === 0) throw new Error('至少导入一个 transcript 或 verdict 文件');
  const parsed = input.files.map((file) => ({ ...file, json: JSON.parse(file.raw) as ImportedArtifact }));
  for (const file of parsed) {
    if (typeof file.json.schemaVersion !== 'number') throw new Error(`${file.fileName} 缺少 schemaVersion`);
    if (file.json.styleFamily && !isStyleFamily(file.json.styleFamily)) throw new Error(`${file.fileName} 包含未知目标风格`);
  }
  const styleFamilies = [...new Set(parsed.map((file) => file.json.styleFamily).filter(isStyleFamily))];
  const stylePolicyVersions = [...new Set(parsed.map((file) => file.json.stylePolicyVersion).filter((value): value is string => typeof value === 'string' && !!value.trim()))];
  if (styleFamilies.length > 1) throw new Error('同一次导入不能混合不同目标风格的评测产物');
  if (stylePolicyVersions.length > 1) throw new Error('同一次导入不能混合不同风格规范版本的评测产物');
  const verdict = parsed.find((file) => file.json.tags?.A && file.json.tags?.B);
  const transcripts = parsed.filter((file) => typeof file.json.tag === 'string');
  const modelATag = verdict?.json.tags?.A ?? transcripts[0]?.json.tag ?? 'A';
  const modelBTag = verdict?.json.tags?.B ?? transcripts[1]?.json.tag ?? 'B';
  const [modelAVersion, modelBVersion] = await Promise.all([
    db.modelVersion.findUnique({ where: { tag: modelATag }, select: { id: true } }),
    db.modelVersion.findUnique({ where: { tag: modelBTag }, select: { id: true } }),
  ]);
  if (!verdict || transcripts.length < 2) throw new Error('评测导入必须同时包含完整 verdict 和两个模型 transcript');
  if (!modelAVersion || !modelBVersion) throw new Error('评测产物中的 A/B 模型身份必须能解析到 ModelVersion');
  const collectScenarioIds = (value: unknown, ids = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) for (const item of value) collectScenarioIds(item, ids);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'scenarioId' && typeof child === 'string' && child.trim()) ids.add(child);
      collectScenarioIds(child, ids);
    }
    return ids;
  };
  const scenarioIds = [...new Set(transcripts.flatMap((file) => [...collectScenarioIds(file.json)]))];
  if (scenarioIds.length === 0) throw new Error('transcript 缺少可核验 scenarioId');
  const rawSummary = verdict.json.summary && typeof verdict.json.summary === 'object' ? verdict.json.summary as Record<string, unknown> : {};
  const summary = { ...rawSummary, artifactValidation: { complete: true, invalidArtifacts: 0, scenarioIdsComplete: true, modelIdentitiesVerified: true, scenarioCount: scenarioIds.length } };
  const scope = verdict?.json.scope ?? transcripts[0]?.json.scope ?? 'unknown';
  const run = await db.$transaction(async (tx) => {
    const created = await tx.evaluationRun.create({
      data: {
        name: input.name,
        modelATag,
        modelBTag,
        scope,
        summaryJson: JSON.stringify(summary),
        styleFamily: styleFamilies[0],
        stylePolicyVersion: stylePolicyVersions[0],
        modelAVersionId: modelAVersion?.id,
        modelBVersionId: modelBVersion?.id,
        createdById: input.user.id,
      },
    });
    for (const file of parsed) {
      const kind = file.json.tags ? 'verdict' : 'transcript';
      const tag = file.json.tag ?? `${file.json.tags?.A}-vs-${file.json.tags?.B}`;
      await tx.evaluationArtifact.create({
        data: { runId: created.id, kind, tag, sha256: sha256(file.raw), jsonData: file.raw },
      });
    }
    return created;
  });
  await audit(input.user.id, 'EVALUATION_IMPORTED', 'EvaluationRun', run.id, { files: input.files.map((file) => file.fileName) });
  if (modelBVersion) await refreshModelDeploymentGate(modelBVersion.id);
  return run;
}

export async function listEvaluations() {
  return db.evaluationRun.findMany({ orderBy: { createdAt: 'desc' }, include: { modelAVersion: { select: { tag: true } }, modelBVersion: { select: { tag: true } }, _count: { select: { artifacts: true } }, createdBy: { select: { displayName: true } } } });
}

export async function evaluationDetail(id: string) {
  return db.evaluationRun.findUnique({ where: { id }, include: { artifacts: true, createdBy: { select: { displayName: true } } } });
}

export async function listDataLabUsers() {
  const [users, activeTasks, activeReviews, approvedWork] = await Promise.all([
    db.user.findMany({
      where: { role: { in: DATA_LAB_ROLES } },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isActive: true,
        disabledAt: true,
        disabledReason: true,
        lastLoginAt: true,
        createdAt: true,
        _count: {
          select: {
            ownedClasses: true,
            classMemberships: true,
            studentAssignments: true,
            conversations: true,
            importedDatasetBatches: true,
            createdCampaigns: true,
            campaignParticipations: true,
            annotationTasks: true,
            annotationRevisions: true,
            completedWorkReviews: true,
            assignedReviewCases: true,
            reviewDecisions: true,
            createdDatasetReleases: true,
            createdTrainingRuns: true,
            createdEvaluationRuns: true,
            dataLabAuditLogs: true,
            createdTopicCards: true,
            approvedTopicCards: true,
            createdBootstrapRuns: true,
            assignedTutorReviews: true,
            operatedTutorReviews: true,
            finalizedFirstReviews: true,
            finalizedSecondReviews: true,
          },
        },
      },
    }),
    db.annotationTask.groupBy({ by: ['assignedToId'], where: { assignedToId: { not: null }, status: { in: ['IN_PROGRESS', 'RETURNED'] } }, _count: { _all: true } }),
    db.reviewCase.groupBy({ by: ['assignedReviewerId'], where: { assignedReviewerId: { not: null }, status: 'IN_REVIEW' }, _count: { _all: true } }),
    db.annotationWorkReview.findMany({ where: { status: 'APPROVED' }, select: { revision: { select: { authorId: true } } } }),
  ]);
  const taskCounts = new Map(activeTasks.map((item) => [item.assignedToId, item._count._all]));
  const reviewCounts = new Map(activeReviews.map((item) => [item.assignedReviewerId, item._count._all]));
  const workCounts = new Map<string, number>();
  for (const item of approvedWork) workCounts.set(item.revision.authorId, (workCounts.get(item.revision.authorId) ?? 0) + 1);
  return users.map(({ _count, ...user }) => ({
    ...user,
    activeTaskCount: taskCounts.get(user.id) ?? 0,
    activeReviewCount: reviewCounts.get(user.id) ?? 0,
    effectiveWorkCount: workCounts.get(user.id) ?? 0,
    canDelete: Object.values(_count).every((count) => count === 0),
  }));
}

async function assertLastActiveAdmin(target: { id: string; role: string; isActive: boolean }, actor: SessionUser, next: { role?: UserRole; isActive?: boolean }) {
  if (target.id === actor.id && (next.isActive === false || (next.role && next.role !== 'admin'))) {
    throw new Error('管理员不能停用自己或移除自己的管理员权限');
  }
  const removesAdmin = target.role === 'admin' && target.isActive && (next.isActive === false || (next.role && next.role !== 'admin'));
  if (removesAdmin && await db.user.count({ where: { role: 'admin', isActive: true } }) <= 1) {
    throw new Error('必须至少保留一个启用中的管理员');
  }
}

async function activeAccountWork(targetUserId: string) {
  const [tasks, reviews, tutorEdits, tutorConfirms] = await Promise.all([
    db.annotationTask.count({ where: { assignedToId: targetUserId, status: { in: ['IN_PROGRESS', 'RETURNED'] } } }),
    db.reviewCase.count({ where: { assignedReviewerId: targetUserId, status: 'IN_REVIEW' } }),
    db.tutorReviewTask.count({ where: { assignedToId: targetUserId, type: 'EDIT', status: { in: ['IN_PROGRESS', 'RETURNED'] } } }),
    db.tutorReviewTask.count({ where: { assignedToId: targetUserId, type: 'CONFIRM', status: 'IN_PROGRESS' } }),
  ]);
  return { tasks: tasks + tutorEdits, reviews: reviews + tutorConfirms };
}

export async function updateDataLabUser(input: { targetUserId: string; username: string; displayName: string; role: UserRole; actor: SessionUser }) {
  if (!isAdmin(input.actor.role)) throw new Error('仅管理员可以编辑后台账号');
  if (!DATA_LAB_ROLES.includes(input.role)) throw new Error('后台账号角色无效');
  const username = input.username.trim();
  const displayName = input.displayName.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) throw new Error('用户名需为 3-32 位字母、数字、点、下划线或短横线');
  if (!displayName || displayName.length > 50) throw new Error('显示名称需为 1-50 个字符');
  const target = await db.user.findUnique({ where: { id: input.targetUserId } });
  if (!target || !DATA_LAB_ROLES.includes(target.role as UserRole)) throw new Error('后台账号不存在');
  const duplicate = await db.user.findFirst({ where: { username, id: { not: target.id } }, select: { id: true } });
  if (duplicate) throw new Error('该用户名已被使用');
  if (target.role !== input.role) {
    await assertLastActiveAdmin(target, input.actor, { role: input.role });
    const active = await activeAccountWork(target.id);
    if (active.tasks > 0 || active.reviews > 0) throw new Error(`该账户仍有 ${active.tasks} 条进行中标注和 ${active.reviews} 条进行中仲裁，请先处理后再修改角色`);
  }
  const user = await db.user.update({ where: { id: target.id }, data: { username, displayName, role: input.role } });
  await audit(input.actor.id, 'DATA_LAB_USER_UPDATED', 'User', target.id, {
    before: { username: target.username, displayName: target.displayName, role: target.role },
    after: { username, displayName, role: input.role },
  });
  return user;
}

export async function updateUserRole(targetUserId: string, role: UserRole, actor: SessionUser) {
  const target = await db.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new Error('后台账号不存在');
  return updateDataLabUser({ targetUserId, username: target.username, displayName: target.displayName, role, actor });
}

export async function resetDataLabUserPassword(input: { targetUserId: string; passwordHash: string; actor: SessionUser }) {
  if (!isAdmin(input.actor.role)) throw new Error('仅管理员可以重置密码');
  const target = await db.user.findUnique({ where: { id: input.targetUserId }, select: { id: true } });
  if (!target) throw new Error('后台账号不存在');
  await db.user.update({ where: { id: target.id }, data: { passwordHash: input.passwordHash, sessionVersion: { increment: 1 } } });
  await audit(input.actor.id, 'DATA_LAB_USER_PASSWORD_RESET', 'User', target.id);
  return { ok: true };
}

export async function setDataLabUserActive(input: { targetUserId: string; isActive: boolean; reason?: string; actor: SessionUser }) {
  if (!isAdmin(input.actor.role)) throw new Error('仅管理员可以调整账户状态');
  const target = await db.user.findUnique({ where: { id: input.targetUserId } });
  if (!target || !DATA_LAB_ROLES.includes(target.role as UserRole)) throw new Error('后台账号不存在');
  if (target.isActive === input.isActive) return { ok: true };
  if (!input.isActive) {
    await assertLastActiveAdmin(target, input.actor, { isActive: false });
    const active = await activeAccountWork(target.id);
    if (active.tasks > 0 || active.reviews > 0) throw new Error(`该账户仍有 ${active.tasks} 条进行中标注和 ${active.reviews} 条进行中仲裁，请先处理后再停用`);
  }
  const reason = input.reason?.trim() ?? '';
  await db.$transaction([
    db.user.update({
      where: { id: target.id },
      data: input.isActive
        ? { isActive: true, disabledAt: null, disabledReason: '', sessionVersion: { increment: 1 } }
        : { isActive: false, disabledAt: new Date(), disabledReason: reason, sessionVersion: { increment: 1 } },
    }),
    ...(!input.isActive ? [db.campaignParticipant.updateMany({ where: { userId: target.id, active: true }, data: { active: false } })] : []),
  ]);
  await audit(input.actor.id, input.isActive ? 'DATA_LAB_USER_ENABLED' : 'DATA_LAB_USER_DISABLED', 'User', target.id, { reason });
  return { ok: true };
}

export async function deleteUnusedDataLabUser(targetUserId: string, actor: SessionUser) {
  if (!isAdmin(actor.role)) throw new Error('仅管理员可以删除后台账号');
  if (targetUserId === actor.id) throw new Error('管理员不能删除自己');
  const listed = (await listDataLabUsers()).find((item) => item.id === targetUserId);
  if (!listed) throw new Error('后台账号不存在');
  await assertLastActiveAdmin(listed, actor, { isActive: false });
  if (!listed.canDelete) throw new Error('该账户已有业务或审计记录，只能停用，不能永久删除');
  await db.user.delete({ where: { id: targetUserId } });
  await audit(actor.id, 'UNUSED_DATA_LAB_USER_DELETED', 'User', targetUserId, { username: listed.username, displayName: listed.displayName });
  return { ok: true };
}

export async function createDataLabUser(input: { username: string; passwordHash: string; displayName: string; role: UserRole; actor: SessionUser }) {
  if (!DATA_LAB_ROLES.includes(input.role)) throw new Error('只能创建 Data Lab 后台角色');
  const username = input.username.trim();
  const displayName = input.displayName.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) throw new Error('用户名需为 3-32 位字母、数字、点、下划线或短横线');
  if (!displayName || displayName.length > 50) throw new Error('显示名称需为 1-50 个字符');
  const user = await db.user.create({ data: { username, passwordHash: input.passwordHash, displayName, role: input.role } });
  await audit(input.actor.id, 'DATA_LAB_USER_CREATED', 'User', user.id, { role: input.role });
  return user;
}

export function newEvaluationName(prefix = 'evaluation') {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
