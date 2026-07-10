import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { db } from '@/app/lib/db';
import type { SessionUser } from '@/app/lib/session';
import type { UserRole } from '@/app/lib/roles';
import {
  STYLE_FAMILIES,
  type AnnotationPayload,
  type CampaignSelection,
  type ReleaseRecipe,
  type RevisionInput,
  type ShareGPTRecord,
  type StyleQuota,
  type StyleFamily,
} from './types';
import {
  applyRevision,
  canonicalizeRecord,
  familyKey,
  parseAssistantResponse,
  parseJson,
  parseShareGPTDataset,
  sha256,
  validateShareGPTRecord,
} from './validation';

const DATA_LAB_ROLES: UserRole[] = ['annotator', 'reviewer', 'admin'];
const REVIEW_ROLES: UserRole[] = ['reviewer', 'admin'];
const ADMIN_ROLES: UserRole[] = ['admin'];
const LEASE_MS = 45 * 60 * 1000;
const RELEASE_DIR = path.join(process.cwd(), 'data/releases');

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
  user: SessionUser;
}) {
  const records = parseShareGPTDataset(input.raw).map(canonicalizeRecord);
  const fileSha = sha256(input.raw);
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
  const [batches, samples, campaigns, pendingTasks, pendingReviews, releases, trainingRuns, evaluations] = await Promise.all([
    db.datasetBatch.count(),
    db.datasetSample.count(),
    db.annotationCampaign.count(),
    isAdmin(user.role) ? db.annotationTask.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] } } }) : db.annotationTask.count({ where: { assignedToId: user.id, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
    canReview(user.role) ? db.reviewCase.count({ where: { status: { in: ['PENDING', 'IN_REVIEW'] } } }) : Promise.resolve(0),
    db.datasetRelease.count(),
    db.trainingRun.count(),
    db.evaluationRun.count(),
  ]);
  return { batches, samples, campaigns, pendingTasks, pendingReviews, releases, trainingRuns, evaluations };
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

function weightedStyleSequence(quota: StyleQuota): StyleFamily[] {
  const sequence = STYLE_FAMILIES.flatMap((style) => Array.from({ length: Math.max(0, Math.round(quota[style] ?? 0)) }, () => style));
  return sequence.length > 0 ? sequence : [...STYLE_FAMILIES];
}

function styleFor(index: number, slot: number, quota: StyleQuota): StyleFamily {
  const sequence = weightedStyleSequence(quota);
  return sequence[(index + slot - 1) % sequence.length];
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
  user: SessionUser;
}) {
  const campaign = await db.annotationCampaign.create({
    data: {
      name: input.name,
      selectionJson: JSON.stringify(input.selection),
      styleQuotaJson: JSON.stringify(input.styleQuota ?? Object.fromEntries(STYLE_FAMILIES.map((style) => [style, 1]))),
      goldSlots: Math.min(3, Math.max(1, input.goldSlots ?? 2)),
      silverDoubleReviewPercent: Math.min(100, Math.max(0, input.silverDoubleReviewPercent ?? 30)),
      maxActivePerAnnotator: Math.max(1, input.maxActivePerAnnotator ?? 1),
      createdById: input.user.id,
    },
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
  const matchedSamples = (await db.datasetSample.findMany({ orderBy: [{ phase: 'asc' }, { sourceRecordId: 'asc' }] }))
    .filter((sample) => selectedByCampaign(sample, selection));
  const samples = stratifiedCampaignSamples(matchedSamples, selection.limit);
  if (samples.length === 0) throw new Error('筛选条件没有匹配样本');

  await db.$transaction(async (tx) => {
    let styleIndex = 0;
    for (const sample of samples) {
      const gold = sample.candidateTier === 'gold_candidate';
      const slots = gold ? campaign.goldSlots : (doubleReviewSilver(sample.id, campaign.silverDoubleReviewPercent) ? 2 : 1);
      for (let slot = 1; slot <= slots; slot++) {
        await tx.annotationTask.create({
          data: {
            campaignId: campaign.id,
            sampleId: sample.id,
            slot,
            styleFamily: styleFor(styleIndex, slot, styles),
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

async function taskPayload(taskId: string, userId: string): Promise<AnnotationPayload> {
  const task = await db.annotationTask.findUnique({
    where: { id: taskId },
    include: { sample: true },
  });
  if (!task || task.assignedToId !== userId) throw new Error('任务不存在或未分配给当前用户');
  const record = parseJson<ShareGPTRecord>(task.sample.originalRecordJson, {} as ShareGPTRecord);
  return {
    taskId: task.id,
    sampleId: task.sampleId,
    sourceRecordId: task.sample.sourceRecordId,
    phase: task.sample.phase,
    scenario: task.sample.scenario,
    styleFamily: task.styleFamily as StyleFamily | null,
    conversations: record.conversations.map((message, index) => ({
      index,
      from: message.from,
      value: message.from === 'human' ? message.value : '',
      response: message.from === 'gpt' ? parseAssistantResponse(message.value) : undefined,
    })),
    draft: parseJson<RevisionInput | undefined>(task.draftJson, undefined),
    leaseExpiresAt: task.leaseExpiresAt?.toISOString() ?? null,
  };
}

export async function claimAnnotationTask(user: SessionUser) {
  const active = await db.annotationTask.findFirst({
    where: {
      assignedToId: user.id,
      OR: [
        { status: 'IN_PROGRESS', leaseExpiresAt: { gt: new Date() } },
        { status: 'RETURNED' },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (active) {
    if (active.status === 'RETURNED') {
      await db.annotationTask.update({ where: { id: active.id }, data: { status: 'IN_PROGRESS', leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
    }
    return taskPayload(active.id, user.id);
  }

  const handled = await db.annotationTask.findMany({
    where: { assignedToId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: { campaignId: true, sampleId: true, sample: { select: { familyKey: true } } },
  });
  const handledPairs = new Set(handled.map((item) => `${item.campaignId}:${item.sampleId}`));
  const excludedFamilies = new Set(handled.slice(0, 5).map((item) => item.sample.familyKey));
  const now = new Date();
  const candidates = await db.annotationTask.findMany({
    where: {
      campaign: { status: 'ACTIVE' },
      OR: [
        { status: 'PENDING', assignedToId: null },
        { status: 'IN_PROGRESS', leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: [{ sample: { phase: 'asc' } }, { createdAt: 'asc' }],
    include: { sample: { select: { familyKey: true } } },
    take: 200,
  });
  const fallback = candidates.find((item) => !handledPairs.has(`${item.campaignId}:${item.sampleId}`) && !excludedFamilies.has(item.sample.familyKey))
    ?? candidates.find((item) => !handledPairs.has(`${item.campaignId}:${item.sampleId}`));
  if (!fallback) return null;
  const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
  const updated = await db.annotationTask.updateMany({
    where: {
      id: fallback.id,
      OR: [
        { status: 'PENDING', assignedToId: null },
        { status: 'IN_PROGRESS', leaseExpiresAt: { lt: now } },
      ],
    },
    data: { assignedToId: user.id, status: 'IN_PROGRESS', leaseExpiresAt },
  });
  if (updated.count !== 1) return claimAnnotationTask(user);
  await audit(user.id, 'ANNOTATION_TASK_CLAIMED', 'AnnotationTask', fallback.id);
  return taskPayload(fallback.id, user.id);
}

export async function saveTaskDraft(taskId: string, input: RevisionInput, user: SessionUser) {
  const task = await db.annotationTask.findUnique({ where: { id: taskId } });
  if (!task || task.assignedToId !== user.id || task.status !== 'IN_PROGRESS') throw new Error('任务不可编辑');
  await db.annotationTask.update({
    where: { id: taskId },
    data: { draftJson: JSON.stringify(input), leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
}

export async function submitAnnotationTask(taskId: string, input: RevisionInput, user: SessionUser) {
  const task = await db.annotationTask.findUnique({ where: { id: taskId }, include: { sample: true } });
  if (!task || task.assignedToId !== user.id || task.status !== 'IN_PROGRESS') throw new Error('任务不可提交');
  const original = parseJson<ShareGPTRecord>(task.sample.originalRecordJson, {} as ShareGPTRecord);
  const revised = applyRevision(original, input);
  const check = validateShareGPTRecord(revised);
  if (check.status === 'error') throw new Error(check.issues.filter((item) => item.severity === 'error').map((item) => item.message).join('；'));

  const revision = await db.$transaction(async (tx) => {
    const latest = await tx.annotationRevision.findFirst({ where: { taskId }, orderBy: { version: 'desc' } });
    const created = await tx.annotationRevision.create({
      data: {
        taskId,
        sampleId: task.sampleId,
        authorId: user.id,
        version: (latest?.version ?? 0) + 1,
        contentJson: JSON.stringify(input.assistantMessages),
        fullRecordJson: JSON.stringify(revised),
        issueTagsJson: JSON.stringify(input.issueTags),
        changeReason: input.changeReason,
        noChange: input.noChange,
        parentRevisionId: latest?.id,
      },
    });
    await tx.annotationTask.update({ where: { id: taskId }, data: { status: 'SUBMITTED', submittedAt: new Date(), draftJson: '{}', leaseExpiresAt: null } });
    const siblingTasks = await tx.annotationTask.findMany({ where: { campaignId: task.campaignId, sampleId: task.sampleId } });
    if (siblingTasks.length > 1 && siblingTasks.every((item) => item.id === task.id || item.status === 'SUBMITTED')) {
      const revisions = await tx.annotationRevision.findMany({
        where: { task: { campaignId: task.campaignId, sampleId: task.sampleId } },
        orderBy: { createdAt: 'asc' },
      });
      await tx.reviewCase.upsert({
        where: { campaignId_sampleId: { campaignId: task.campaignId, sampleId: task.sampleId } },
        update: { candidateRevisionIdsJson: JSON.stringify(revisions.map((item) => item.id)), status: 'PENDING' },
        create: {
          campaignId: task.campaignId,
          sampleId: task.sampleId,
          triggerReason: 'MULTI_ANNOTATION',
          candidateRevisionIdsJson: JSON.stringify(revisions.map((item) => item.id)),
        },
      });
    }
    return created;
  });
  await audit(user.id, 'ANNOTATION_SUBMITTED', 'AnnotationRevision', revision.id, { check });
  return { revision, check };
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
  const item = await db.reviewCase.findUnique({ where: { id: reviewCaseId }, include: { sample: true } });
  if (!item || item.assignedReviewerId !== reviewerId) throw new Error('复审任务不存在');
  const ids = parseJson<string[]>(item.candidateRevisionIdsJson, []);
  const revisions = await db.annotationRevision.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
  const anonymize = (record: ShareGPTRecord): ShareGPTRecord => ({
    id: 'anonymous',
    scenario: record.scenario,
    phase: record.phase,
    conversations: record.conversations,
  });
  const candidates = revisions
    .map((revision) => ({ id: revision.id, record: anonymize(parseJson<ShareGPTRecord>(revision.fullRecordJson, {} as ShareGPTRecord)) }))
    .sort((a, b) => sha256(`${item.id}:${a.id}`).localeCompare(sha256(`${item.id}:${b.id}`)))
    .map((candidate, index) => ({ label: String.fromCharCode(65 + index), ...candidate }));
  return {
    id: item.id,
    phase: item.sample.phase,
    scenario: item.sample.scenario,
    original: anonymize(parseJson<ShareGPTRecord>(item.sample.originalRecordJson, {} as ShareGPTRecord)),
    candidates,
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
  const reviewCase = await db.reviewCase.findUnique({ where: { id: input.reviewCaseId }, include: { sample: true } });
  if (!reviewCase || reviewCase.assignedReviewerId !== input.user.id || reviewCase.status !== 'IN_REVIEW') throw new Error('复审任务不可提交');
  const candidateIds = parseJson<string[]>(reviewCase.candidateRevisionIdsJson, []);
  if (input.selectedRevisionId && !candidateIds.includes(input.selectedRevisionId)) throw new Error('所选 revision 不属于该复审任务');

  if (input.action === 'RETURN') {
    const tasks = await db.annotationTask.findMany({
      where: { campaignId: reviewCase.campaignId, sampleId: reviewCase.sampleId },
      include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    await db.$transaction(async (tx) => {
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
    const mergedRecord = applyRevision(original, input.mergedInput);
    const check = validateShareGPTRecord(mergedRecord);
    if (check.status === 'error') throw new Error('合并版本未通过自动检查');
    const syntheticTask = await db.annotationTask.findFirst({ where: { campaignId: reviewCase.campaignId, sampleId: reviewCase.sampleId }, orderBy: { slot: 'asc' } });
    if (!syntheticTask) throw new Error('缺少关联标注任务');
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
      },
    });
    mergedRevisionId = revision.id;
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
  const decisions = await db.reviewDecision.findMany({
    where: { reviewCase: { campaignId }, finalTier: { in: ['human_gold', 'reviewed_silver'] } },
    include: { reviewCase: true, selectedRevision: true, mergedRevision: true },
  });
  const result = new Map<string, { sampleId: string; revisionId: string; tier: string; recordJson: string; reason: string }>();
  for (const decision of decisions) {
    const revision = decision.mergedRevision ?? decision.selectedRevision;
    if (!revision) continue;
    result.set(decision.reviewCase.sampleId, {
      sampleId: decision.reviewCase.sampleId,
      revisionId: revision.id,
      tier: decision.finalTier,
      recordJson: revision.fullRecordJson,
      reason: `review:${decision.id}`,
    });
  }

  const singleTasks = await db.annotationTask.findMany({
    where: { campaignId, status: 'SUBMITTED' },
    include: { sample: true, revisions: { orderBy: { version: 'desc' }, take: 1 }, campaign: true },
  });
  const grouped = new Map<string, typeof singleTasks>();
  for (const task of singleTasks) {
    if (!grouped.has(task.sampleId)) grouped.set(task.sampleId, []);
    grouped.get(task.sampleId)?.push(task);
  }
  for (const [sampleId, tasks] of grouped) {
    if (result.has(sampleId) || tasks.length !== 1 || tasks[0].sample.candidateTier === 'gold_candidate') continue;
    const revision = tasks[0].revisions[0];
    if (!revision) continue;
    result.set(sampleId, {
      sampleId,
      revisionId: revision.id,
      tier: 'reviewed_silver',
      recordJson: revision.fullRecordJson,
      reason: `single-review:${tasks[0].id}`,
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
  const gold = selected.filter((item) => item.tier === 'human_gold').map((item) => parseJson<ShareGPTRecord>(item.recordJson, {} as ShareGPTRecord));
  const silver = selected.filter((item) => item.tier === 'reviewed_silver').map((item) => parseJson<ShareGPTRecord>(item.recordJson, {} as ShareGPTRecord));
  const clean = [...gold, ...silver];
  await mkdir(RELEASE_DIR, { recursive: true });
  const safeVersion = release.version.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const cleanPath = path.join(RELEASE_DIR, `sharegpt-${safeVersion}-all.json`);
  const goldPath = path.join(RELEASE_DIR, `sharegpt-${safeVersion}-gold.json`);
  const silverPath = path.join(RELEASE_DIR, `sharegpt-${safeVersion}-silver.json`);
  const manifestPath = path.join(RELEASE_DIR, `manifest-${safeVersion}.json`);
  const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const cleanText = serialize(clean);
  const goldText = serialize(gold);
  const silverText = serialize(silver);
  const byPhase: Record<string, number> = {};
  for (const record of clean) byPhase[`P${record.phase}`] = (byPhase[`P${record.phase}`] ?? 0) + 1;
  const manifest = {
    schemaVersion: 1,
    version: release.version,
    frozenAt: new Date().toISOString(),
    recipe,
    summary: { clean: clean.length, humanGold: gold.length, reviewedSilver: silver.length, byPhase },
    items: selected.map((item) => ({ sampleId: item.sampleId, revisionId: item.revisionId, tier: item.tier, reason: item.reason })),
  };
  const manifestText = serialize(manifest);
  await Promise.all([
    writeFile(cleanPath, cleanText, 'utf8'),
    writeFile(goldPath, goldText, 'utf8'),
    writeFile(silverPath, silverText, 'utf8'),
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

export async function releaseForDownload(id: string, kind: 'clean' | 'gold' | 'silver' | 'manifest') {
  const release = await db.datasetRelease.findUnique({ where: { id } });
  if (!release || release.status !== 'FROZEN') throw new Error('数据集版本不存在或尚未冻结');
  const filePath = kind === 'clean' ? release.cleanPath : kind === 'gold' ? release.goldPath : kind === 'silver' ? release.silverPath : release.manifestPath;
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
  user: SessionUser;
}) {
  const run = await db.trainingRun.create({
    data: {
      name: input.name,
      releaseId: input.releaseId,
      baseModel: input.baseModel,
      externalTaskId: input.externalTaskId,
      parametersJson: JSON.stringify(input.parameters ?? {}),
      status: input.status ?? 'DRAFT',
      modelTag: input.modelTag,
      notes: input.notes ?? '',
      createdById: input.user.id,
    },
  });
  await audit(input.user.id, 'TRAINING_RUN_CREATED', 'TrainingRun', run.id, input);
  return run;
}

export async function listTrainingRuns() {
  return db.trainingRun.findMany({ orderBy: { createdAt: 'desc' }, include: { release: { select: { version: true } }, createdBy: { select: { displayName: true } } } });
}

interface ImportedArtifact {
  schemaVersion?: number;
  tag?: string;
  scope?: string;
  tags?: { A?: string; B?: string };
  summary?: unknown;
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
  }
  const verdict = parsed.find((file) => file.json.tags?.A && file.json.tags?.B);
  const transcripts = parsed.filter((file) => typeof file.json.tag === 'string');
  const modelATag = verdict?.json.tags?.A ?? transcripts[0]?.json.tag ?? 'A';
  const modelBTag = verdict?.json.tags?.B ?? transcripts[1]?.json.tag ?? 'B';
  const scope = verdict?.json.scope ?? transcripts[0]?.json.scope ?? 'unknown';
  const run = await db.$transaction(async (tx) => {
    const created = await tx.evaluationRun.create({
      data: {
        name: input.name,
        modelATag,
        modelBTag,
        scope,
        summaryJson: JSON.stringify(verdict?.json.summary ?? {}),
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
  return run;
}

export async function listEvaluations() {
  return db.evaluationRun.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { artifacts: true } }, createdBy: { select: { displayName: true } } } });
}

export async function evaluationDetail(id: string) {
  return db.evaluationRun.findUnique({ where: { id }, include: { artifacts: true, createdBy: { select: { displayName: true } } } });
}

export async function listDataLabUsers() {
  return db.user.findMany({ where: { role: { in: DATA_LAB_ROLES } }, orderBy: { createdAt: 'asc' }, select: { id: true, username: true, displayName: true, role: true, createdAt: true } });
}

export async function updateUserRole(targetUserId: string, role: UserRole, actor: SessionUser) {
  if (!DATA_LAB_ROLES.includes(role) && role !== 'student' && role !== 'teacher') throw new Error('角色无效');
  if (targetUserId === actor.id && role !== 'admin') throw new Error('管理员不能移除自己的 admin 权限');
  const user = await db.user.update({ where: { id: targetUserId }, data: { role } });
  await audit(actor.id, 'USER_ROLE_UPDATED', 'User', targetUserId, { role });
  return user;
}

export async function createDataLabUser(input: { username: string; passwordHash: string; displayName: string; role: UserRole; actor: SessionUser }) {
  if (!DATA_LAB_ROLES.includes(input.role)) throw new Error('只能创建 Data Lab 后台角色');
  const user = await db.user.create({ data: { username: input.username, passwordHash: input.passwordHash, displayName: input.displayName, role: input.role } });
  await audit(input.actor.id, 'DATA_LAB_USER_CREATED', 'User', user.id, { role: input.role });
  return user;
}

export function newEvaluationName(prefix = 'evaluation') {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
