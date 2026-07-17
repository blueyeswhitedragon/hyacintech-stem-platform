import { readFile } from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { db } from '@/app/lib/db';
import type { SessionUser } from '@/app/lib/session';
import {
  TOPIC_RESOURCE_TYPES,
  TOPIC_SOURCE_STATUSES,
  effectiveFamilyKey,
  topicResourceFamilyKey,
  topicSourceKey,
  type TopicResourceType,
  type TopicSourceStatus,
} from './topicCardV2';

export const TOPIC_SOURCE_AUTHORIZATION_STATUSES = ['UNCONFIRMED', 'CONFIRMED'] as const;
export type TopicSourceAuthorizationStatus = (typeof TOPIC_SOURCE_AUTHORIZATION_STATUSES)[number];

export interface TopicSourceImportInput {
  sourceKey?: string;
  familyKey?: string;
  title: string;
  summary?: string;
  resourceType?: string;
  sourcePlatform?: string;
  sourceResourceId?: string;
  sourceUrl?: string;
  rawSource?: Record<string, unknown>;
  legacyHints?: Record<string, unknown>;
  qualitySignals?: string[];
  authorizationStatus?: TopicSourceAuthorizationStatus;
  status?: TopicSourceStatus;
}

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function audit(actorId: string, action: string, entityType: string, entityId: string, payload: unknown = {}) {
  return db.dataLabAuditLog.create({ data: { actorId, action, entityType, entityId, payloadJson: JSON.stringify(payload) } });
}

function normalizedResourceType(value: string | undefined): TopicResourceType {
  return TOPIC_RESOURCE_TYPES.includes(value as TopicResourceType) ? value as TopicResourceType : 'UNCLASSIFIED';
}

function sourceCreateData(input: TopicSourceImportInput, actorId: string): Prisma.TopicSourceCandidateCreateInput {
  const title = input.title.trim();
  const platform = input.sourcePlatform?.trim() || 'manual';
  const resourceId = input.sourceResourceId?.trim() || '';
  return {
    sourceKey: input.sourceKey?.trim() || topicSourceKey(platform, resourceId, title),
    familyKey: input.familyKey?.trim() || topicResourceFamilyKey(title),
    title,
    summary: input.summary?.trim() || '',
    resourceType: normalizedResourceType(input.resourceType),
    sourcePlatform: platform,
    sourceResourceId: resourceId,
    sourceUrl: input.sourceUrl?.trim() || '',
    authorizationStatus: input.authorizationStatus === 'CONFIRMED' ? 'CONFIRMED' : 'UNCONFIRMED',
    rawSourceJson: JSON.stringify(input.rawSource ?? {}),
    legacyHintsJson: JSON.stringify(input.legacyHints ?? {}),
    qualitySignalsJson: JSON.stringify((input.qualitySignals ?? []).map(String).filter(Boolean)),
    status: input.status && TOPIC_SOURCE_STATUSES.includes(input.status) ? input.status : 'NEW',
    createdBy: { connect: { id: actorId } },
  };
}

export async function importTopicSources(inputs: TopicSourceImportInput[], user: SessionUser) {
  if (!inputs.length) throw new Error('没有可导入的素材');
  let created = 0;
  let updated = 0;
  for (const input of inputs) {
    if (!input.title?.trim()) continue;
    const data = sourceCreateData(input, user.id);
    const existing = await db.topicSourceCandidate.findUnique({ where: { sourceKey: data.sourceKey } });
    if (existing) {
      const untouchedCuration = existing.authorizationStatus === 'UNCONFIRMED' && existing.status === 'NEW';
      await db.topicSourceCandidate.update({
        where: { id: existing.id },
        data: {
          title: data.title,
          familyKey: existing.familyOverrideKey ? existing.familyKey : data.familyKey,
          summary: existing.summary || data.summary,
          sourceUrl: existing.sourceUrl || data.sourceUrl,
          rawSourceJson: data.rawSourceJson,
          legacyHintsJson: data.legacyHintsJson,
          qualitySignalsJson: data.qualitySignalsJson,
          ...(untouchedCuration ? { status: data.status, resourceType: existing.resourceType === 'UNCLASSIFIED' ? data.resourceType : existing.resourceType } : {}),
        },
      });
      updated += 1;
    } else {
      await db.topicSourceCandidate.create({ data });
      created += 1;
    }
  }
  await audit(user.id, 'TOPIC_SOURCES_IMPORTED', 'TopicSourceCandidate', 'bulk', { requested: inputs.length, created, updated });
  return { created, updated, total: inputs.length };
}

export async function importBuiltInTopicSources(user: SessionUser) {
  const file = path.join(process.cwd(), 'data/topic-source-catalog.json');
  const catalog = JSON.parse(await readFile(file, 'utf8')) as { items?: TopicSourceImportInput[] };
  return importTopicSources(catalog.items ?? [], user);
}

export async function listTopicSources(input: { status?: string; familyKey?: string; search?: string } = {}) {
  const where: Prisma.TopicSourceCandidateWhereInput = {};
  if (input.status && TOPIC_SOURCE_STATUSES.includes(input.status as TopicSourceStatus)) where.status = input.status;
  if (input.familyKey) where.OR = [{ familyKey: input.familyKey }, { familyOverrideKey: input.familyKey }];
  if (input.search?.trim()) {
    const search = input.search.trim();
    where.AND = [{ OR: [{ title: { contains: search } }, { summary: { contains: search } }, { sourceResourceId: { contains: search } }] }];
  }
  const sources = await db.topicSourceCandidate.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { title: 'asc' }],
    include: { _count: { select: { cards: true } } },
  });
  return sources.map((source) => ({ ...source, effectiveFamilyKey: effectiveFamilyKey(source) }));
}

export async function updateTopicSource(id: string, input: {
  title?: string;
  summary?: string;
  resourceType?: string;
  sourceUrl?: string;
  authorizationStatus?: string;
  status?: string;
  familyOverrideKey?: string;
}, user: SessionUser) {
  const existing = await db.topicSourceCandidate.findUnique({ where: { id } });
  if (!existing) throw new Error('素材不存在');
  if (input.resourceType && !TOPIC_RESOURCE_TYPES.includes(input.resourceType as TopicResourceType)) throw new Error('素材类型无效');
  if (input.authorizationStatus && !TOPIC_SOURCE_AUTHORIZATION_STATUSES.includes(input.authorizationStatus as TopicSourceAuthorizationStatus)) throw new Error('授权状态无效');
  if (input.status && !TOPIC_SOURCE_STATUSES.includes(input.status as TopicSourceStatus)) throw new Error('素材状态无效');
  const updated = await db.topicSourceCandidate.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
      ...(input.resourceType !== undefined ? { resourceType: input.resourceType } : {}),
      ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl.trim() } : {}),
      ...(input.authorizationStatus !== undefined ? { authorizationStatus: input.authorizationStatus } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.familyOverrideKey !== undefined ? { familyOverrideKey: input.familyOverrideKey.trim() } : {}),
    },
  });
  await audit(user.id, 'TOPIC_SOURCE_UPDATED', 'TopicSourceCandidate', id, { fields: Object.keys(input), effectiveFamilyKey: effectiveFamilyKey(updated) });
  return { ...updated, effectiveFamilyKey: effectiveFamilyKey(updated) };
}

export async function setTopicSourceFamily(ids: string[], familyKey: string, user: SessionUser) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) throw new Error('至少选择一个素材');
  const normalized = familyKey.trim() || `manual-${Date.now()}`;
  const result = await db.topicSourceCandidate.updateMany({ where: { id: { in: uniqueIds } }, data: { familyOverrideKey: normalized } });
  await audit(user.id, 'TOPIC_SOURCE_FAMILY_CHANGED', 'TopicSourceCandidate', normalized, { ids: uniqueIds, count: result.count });
  return { familyKey: normalized, count: result.count };
}

export async function sourcePackagesForCompilation(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const sources = await db.topicSourceCandidate.findMany({ where: { id: { in: uniqueIds } }, orderBy: { createdAt: 'asc' } });
  if (sources.length !== uniqueIds.length) throw new Error('部分素材不存在或已被删除');
  for (const source of sources) {
    if (source.authorizationStatus !== 'CONFIRMED') throw new Error(`素材“${source.title}”尚未确认授权`);
    if (source.summary.trim().length < 20) throw new Error(`素材“${source.title}”摘要不足 20 字，无法可靠编译`);
    if (source.status === 'REJECTED') throw new Error(`素材“${source.title}”已被拒绝`);
  }
  const groups = new Map<string, typeof sources>();
  for (const source of sources) {
    const key = effectiveFamilyKey(source);
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  return [...groups.entries()].map(([familyKey, members]) => {
    const primary = members[0];
    return {
      sourceCandidateId: primary.id,
      sourceCandidateIds: members.map((item) => item.id),
      familyKey,
      title: primary.title,
      summary: members.map((item) => item.summary.trim()).filter(Boolean).join('\n'),
      resourceType: primary.resourceType,
      sourcePlatform: primary.sourcePlatform,
      sourceResourceIds: members.map((item) => item.sourceResourceId).filter(Boolean),
      sourceUrls: members.map((item) => item.sourceUrl).filter(Boolean),
      memberTitles: members.map((item) => item.title),
      rawSources: members.map((item) => parseJson(item.rawSourceJson, {})),
      legacyHints: members.map((item) => parseJson(item.legacyHintsJson, {})),
      authorizationStatus: 'CONFIRMED',
    } satisfies Record<string, unknown>;
  });
}
