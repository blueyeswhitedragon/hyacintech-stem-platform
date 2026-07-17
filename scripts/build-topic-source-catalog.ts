/**
 * 从 basic.smartedu.cn.har 与 data/topic-library.json 生成轻量、可审计的 Topic 素材目录。
 * 不调用模型，不修改数据库。输出可由 Data Lab 管理员页面幂等导入。
 */
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { topicResourceFamilyKey, topicSourceKey } from '@/app/lib/dataLab/bootstrap/topicCardV2';

interface HarEntry {
  request?: { url?: string };
  response?: { content?: { text?: string; encoding?: string } };
}

interface TopicExample {
  id: string;
  paradigm: string;
  title: string;
  sourceTitle: string;
  subjectTags?: string[];
  gradeBand?: string;
  questionStem?: string;
  independentVariable?: string;
  dependentVariable?: string;
  engineeringTranslation?: string;
  safetyNote?: string;
  source: { platform?: string; api?: string; resourceId?: string; url?: string };
}

interface TopicSourceCuration {
  schemaVersion: number;
  reviewedAt: string;
  reviewPolicy: string;
  shortlistedFamilies: Array<{ familyKey: string; label: string; resourceType: string; reason: string; topicLibraryIds: string[] }>;
  reviewTopicLibraryIds: string[];
  reviewReason: string;
  defaultRejectedReason: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function candidateIds(value: Record<string, unknown>): string[] {
  return ['unit_id', 'resource_id', 'src_content_id', 'id']
    .map((key) => String(value[key] ?? '').trim())
    .filter(Boolean);
}

function collectItems(value: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectItems(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  if (typeof object.title === 'string' && candidateIds(object).length) out.push(object);
  if (Array.isArray(object.items)) collectItems(object.items, out);
  if (object.data && typeof object.data === 'object') collectItems(object.data, out);
}

function shortResource(raw: Record<string, unknown>) {
  return {
    title: String(raw.title ?? '').replace(/<[^>]+>/g, '').trim(),
    description: String(raw.description ?? '').replace(/<[^>]+>/g, '').trim(),
    resourceType: String(raw.resource_type ?? raw.search_resource_type ?? raw.type ?? ''),
    tags: strings(raw.tags).slice(0, 20),
    unitId: String(raw.unit_id ?? ''),
    resourceId: String(raw.resource_id ?? raw.src_content_id ?? raw.id ?? ''),
    coverUrl: String(raw.cover_url ?? raw.cover ?? ''),
  };
}

async function main() {
  const root = process.cwd();
  const har = JSON.parse(await readFile(path.join(root, 'basic.smartedu.cn.har'), 'utf8')) as { log?: { entries?: HarEntry[] } };
  const library = JSON.parse(await readFile(path.join(root, 'data/topic-library.json'), 'utf8')) as { examples?: TopicExample[] };
  const curation = JSON.parse(await readFile(path.join(root, 'data/topic-source-curation-v1.json'), 'utf8')) as TopicSourceCuration;
  const curatedFamilies = new Map(curation.shortlistedFamilies.flatMap((family) => family.topicLibraryIds.map((id) => [id, family] as const)));
  const reviewIds = new Set(curation.reviewTopicLibraryIds);
  const resources = new Map<string, Record<string, unknown>>();

  for (const entry of har.log?.entries ?? []) {
    const content = entry.response?.content;
    if (!content?.text || content.encoding === 'base64') continue;
    try {
      const parsed = JSON.parse(content.text) as unknown;
      const items: Record<string, unknown>[] = [];
      collectItems(parsed, items);
      for (const item of items) for (const id of candidateIds(item)) if (!resources.has(id)) resources.set(id, item);
    } catch {
      // 非 JSON 响应与目录生成无关。
    }
  }

  const catalog = (library.examples ?? []).map((example) => {
    const resourceId = String(example.source?.resourceId ?? '');
    const raw = resources.get(resourceId) ?? {};
    const enriched = shortResource(raw);
    const title = enriched.title || example.sourceTitle || example.title;
    const summary = enriched.description;
    const qualitySignals = [
      ...(!summary ? ['MISSING_SOURCE_SUMMARY'] : []),
      ...(title === example.title ? ['DERIVED_TITLE_MATCHES_SOURCE'] : []),
      ...(/课件|视频|任务单|教学设计|课程手册/.test(title) ? ['RESOURCE_VARIANT_OR_TEACHER_MATERIAL'] : []),
    ];
    const platform = example.source?.platform || 'basic.smartedu.cn';
    const curatedFamily = curatedFamilies.get(example.id);
    const decision = curatedFamily ? 'SHORTLISTED' : reviewIds.has(example.id) ? 'REVIEW' : 'REJECTED';
    const curationReason = curatedFamily?.reason ?? (decision === 'REVIEW' ? curation.reviewReason : curation.defaultRejectedReason);
    const suggestedResourceType = curatedFamily?.resourceType ?? 'UNCLASSIFIED';
    return {
      sourceKey: topicSourceKey(platform, resourceId, title),
      familyKey: curatedFamily?.familyKey ?? topicResourceFamilyKey(title),
      title,
      summary,
      resourceType: suggestedResourceType,
      status: decision === 'SHORTLISTED' ? 'SHORTLISTED' : decision === 'REJECTED' ? 'REJECTED' : 'NEW',
      sourcePlatform: platform,
      sourceResourceId: resourceId,
      sourceUrl: example.source?.url || '',
      rawSource: {
        title,
        summary,
        resourceType: enriched.resourceType,
        subjectTags: example.subjectTags ?? [],
        gradeBand: example.gradeBand ?? '',
        sourceApi: example.source?.api ?? '',
        sourceResourceId: resourceId,
      },
      legacyHints: {
        topicLibraryId: example.id,
        paradigm: example.paradigm,
        derivedTitle: example.title,
        questionStem: example.questionStem ?? '',
        independentVariable: example.independentVariable ?? '',
        dependentVariable: example.dependentVariable ?? '',
        engineeringTranslation: example.engineeringTranslation ?? '',
        safetyNote: example.safetyNote ?? '',
        trust: 'LEGACY_DERIVED_HINTS_ONLY',
        initialCuration: {
          version: curation.schemaVersion,
          reviewedAt: curation.reviewedAt,
          decision,
          reason: curationReason,
          projectLabel: curatedFamily?.label ?? '',
          suggestedResourceType,
        },
      },
      qualitySignals: [...qualitySignals, `INITIAL_CURATION_${decision}`],
    };
  });

  const out = path.join(root, 'data/topic-source-catalog.json');
  await writeFile(out, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), source: 'basic.smartedu.cn.har + data/topic-library.json', curation: { version: curation.schemaVersion, reviewedAt: curation.reviewedAt, policy: curation.reviewPolicy }, items: catalog }, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${out}: ${catalog.length} items, ${resources.size} HAR resources indexed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
