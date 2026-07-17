import { createHash } from 'crypto';

export const TOPIC_CARD_SCHEMA_V2 = 2 as const;

export const TOPIC_ACTIVITY_MODES = [
  'SCIENTIFIC_INQUIRY',
  'ENGINEERING_DESIGN',
  'HYBRID',
] as const;
export type TopicActivityMode = (typeof TOPIC_ACTIVITY_MODES)[number];

export const TOPIC_CONTEXT_MODULES = [
  'LIFE_HEALTH',
  'ENERGY_ENVIRONMENT',
  'INTELLIGENT_INFORMATION',
  'AEROSPACE',
  'DEEP_EARTH_OCEAN',
] as const;
export type TopicContextModule = (typeof TOPIC_CONTEXT_MODULES)[number];

export const TOPIC_DISCIPLINE_ANCHORS = [
  'biology',
  'chemistry',
  'physics',
  'earth_science',
  'mathematics',
  'information_technology',
  'engineering',
] as const;
export type TopicDisciplineAnchor = (typeof TOPIC_DISCIPLINE_ANCHORS)[number];

export const TOPIC_METRIC_KINDS = [
  'COUNT',
  'PERCENTAGE',
  'TIME',
  'DISTANCE',
  'MASS',
  'TEMPERATURE',
  'OTHER',
] as const;
export type TopicMetricKind = (typeof TOPIC_METRIC_KINDS)[number];

export const TOPIC_RESOURCE_TYPES = [
  'UNCLASSIFIED',
  'STUDENT_INQUIRY_RESOURCE',
  'STUDENT_ENGINEERING_RESOURCE',
  'HYBRID_RESOURCE',
  'TEACHER_RESOURCE',
  'SCIENCE_POPULARIZATION',
  'INSUFFICIENT_SOURCE',
] as const;
export type TopicResourceType = (typeof TOPIC_RESOURCE_TYPES)[number];

export const TOPIC_SOURCE_STATUSES = ['NEW', 'SHORTLISTED', 'REJECTED', 'COMPILED'] as const;
export type TopicSourceStatus = (typeof TOPIC_SOURCE_STATUSES)[number];

export interface TopicInquiryBridge {
  label: string;
  retainedFeature: string;
  researchQuestion: string;
  factor: string;
  phenomenon: string;
  testScaffold: {
    levels: string[];
    measurement: string;
    unit: string;
    metricKind: TopicMetricKind;
    safeValueRange?: [number, number];
    controlledConditions: string[];
  };
  returnToDesign?: string;
}

export interface TopicCardV2Fields {
  schemaVersion: 2;
  activityMode: TopicActivityMode;
  contextModule: TopicContextModule;
  disciplineAnchors: TopicDisciplineAnchor[];
  authenticNeed: string;
  stakeholder?: string;
  engineeringGoal?: string;
  constraints: string[];
  performanceCriteria: string[];
  inquiryBridges: TopicInquiryBridge[];
  sourceCandidateId?: string;
}

function cleanList(values: unknown): string[] {
  return Array.isArray(values) ? values.map(String).map((value) => value.trim()).filter(Boolean) : [];
}

export function normalizeInquiryBridge(value: unknown): TopicInquiryBridge | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const scaffoldRaw = raw.testScaffold && typeof raw.testScaffold === 'object' && !Array.isArray(raw.testScaffold)
    ? raw.testScaffold as Record<string, unknown>
    : {};
  const metricKind = TOPIC_METRIC_KINDS.includes(scaffoldRaw.metricKind as TopicMetricKind)
    ? scaffoldRaw.metricKind as TopicMetricKind
    : 'OTHER';
  const range = Array.isArray(scaffoldRaw.safeValueRange)
    && scaffoldRaw.safeValueRange.length === 2
    && scaffoldRaw.safeValueRange.every((item) => Number.isFinite(Number(item)))
    ? [Number(scaffoldRaw.safeValueRange[0]), Number(scaffoldRaw.safeValueRange[1])] as [number, number]
    : undefined;
  return {
    label: String(raw.label ?? '').trim(),
    retainedFeature: String(raw.retainedFeature ?? '').trim(),
    researchQuestion: String(raw.researchQuestion ?? '').trim(),
    factor: String(raw.factor ?? '').trim(),
    phenomenon: String(raw.phenomenon ?? '').trim(),
    testScaffold: {
      levels: cleanList(scaffoldRaw.levels),
      measurement: String(scaffoldRaw.measurement ?? '').trim(),
      unit: String(scaffoldRaw.unit ?? '').trim(),
      metricKind,
      ...(range ? { safeValueRange: range } : {}),
      controlledConditions: cleanList(scaffoldRaw.controlledConditions),
    },
    returnToDesign: String(raw.returnToDesign ?? '').trim() || undefined,
  };
}

export function normalizeInquiryBridges(value: unknown): TopicInquiryBridge[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeInquiryBridge).filter((item): item is TopicInquiryBridge => Boolean(item));
}

export function deriveAcceptableDirections(bridges: TopicInquiryBridge[]): string[] {
  return [...new Set(bridges.map((bridge) => bridge.researchQuestion.trim()).filter(Boolean))];
}

export function validateTopicCardV2(input: Partial<TopicCardV2Fields>): string[] {
  const errors: string[] = [];
  if (input.schemaVersion !== TOPIC_CARD_SCHEMA_V2) return errors;
  if (!TOPIC_ACTIVITY_MODES.includes(input.activityMode as TopicActivityMode)) errors.push('活动模式无效');
  if (!TOPIC_CONTEXT_MODULES.includes(input.contextModule as TopicContextModule)) errors.push('情境模块无效');
  const anchors = cleanList(input.disciplineAnchors);
  if (!anchors.length || anchors.some((item) => !TOPIC_DISCIPLINE_ANCHORS.includes(item as TopicDisciplineAnchor))) errors.push('至少需要一个有效学科锚点');
  if (!String(input.authenticNeed ?? '').trim()) errors.push('真实需求或可观察情境必填');
  const bridges = normalizeInquiryBridges(input.inquiryBridges);
  if (bridges.length < 2) errors.push('至少需要两条研究路线，避免唯一答案');
  bridges.forEach((bridge, index) => {
    const prefix = `研究路线 ${index + 1}`;
    if (!bridge.label || !bridge.retainedFeature || !bridge.researchQuestion || !bridge.factor || !bridge.phenomenon) errors.push(`${prefix} 的名称、保留机制、研究问题、因素和现象均必填`);
    if (bridge.testScaffold.levels.length < 2) errors.push(`${prefix} 至少需要两个测试水平`);
    if (!bridge.testScaffold.measurement || !bridge.testScaffold.unit) errors.push(`${prefix} 的测量方式和单位必填`);
    if (!TOPIC_METRIC_KINDS.includes(bridge.testScaffold.metricKind)) errors.push(`${prefix} 的指标类型无效`);
    const range = bridge.testScaffold.safeValueRange;
    if (range && (!(range[0] < range[1]))) errors.push(`${prefix} 的安全数值范围必须递增`);
  });
  const engineering = input.activityMode === 'ENGINEERING_DESIGN' || input.activityMode === 'HYBRID';
  if (engineering) {
    if (!String(input.engineeringGoal ?? '').trim()) errors.push('工程或混合型话题必须填写工程目标');
    if (!cleanList(input.constraints).length) errors.push('工程或混合型话题至少需要一个约束');
    if (!cleanList(input.performanceCriteria).length) errors.push('工程或混合型话题至少需要一个性能标准');
    if (bridges.some((bridge) => !bridge.returnToDesign)) errors.push('工程或混合型话题的每条研究路线都必须说明证据如何返回设计');
  }
  return errors;
}

export function normalizeResourceTitle(title: string): string {
  return title
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\.(mp4|mov|avi|pdf|pptx?|docx?)$/i, '')
    .replace(/(?:微课)?视频|学习任务单|任务单|教学设计|课堂实录|课件|教案|素材包/gi, '')
    .replace(/第\s*[一二三四五六七八九十\d]+\s*(?:课时|学时|课)/g, '')
    .replace(/(?:第|任务)\s*[一二三四五六七八九十\d]+/g, '')
    .replace(/[（(]\s*(?:上|下|一|二|三|四|\d+)\s*[)）]/g, '')
    .replace(/[-—_：:|·]+/g, ' ')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function topicResourceFamilyKey(title: string): string {
  const normalized = normalizeResourceTitle(title) || title.trim().toLowerCase() || 'untitled';
  return `family-${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

export function topicSourceKey(platform: string, resourceId: string, title: string): string {
  const identity = resourceId.trim() || normalizeResourceTitle(title) || title.trim();
  return `${platform.trim().toLowerCase()}:${identity}`;
}

export function effectiveFamilyKey(source: { familyKey: string; familyOverrideKey?: string | null }): string {
  return source.familyOverrideKey?.trim() || source.familyKey;
}
