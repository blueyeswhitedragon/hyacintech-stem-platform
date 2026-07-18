import { createHash } from 'crypto';
import type { Prisma, TopicCard } from '@prisma/client';
import { db } from '@/app/lib/db';
import type { SessionUser } from '@/app/lib/session';
import { createLLMProvider } from '@/app/lib/llm/provider';
import type { LLMCompletion } from '@/app/lib/llm/types';
import { repairJson } from '@/app/lib/llm/jsonRepair';
import { CALIBRATION_12_SCENARIOS, compileCases, compileScenarioCases, EVAL_CASE_COUNTS, FULL_CASE_COUNTS, SMOKE_6_SCENARIOS, TRIAL_CASE_COUNTS } from './caseCompiler';
import {
  assertIndependentModelFamilies,
  BOOTSTRAP_SUBJECTS,
  buildCaseTutorPrompt,
  casePromptLeaksPrivate,
  checkTutorCandidate,
  normalizeModelFamily,
  sha256,
  TUTOR_CASE_SPLITS,
  validateTopicCardInput,
  topicCardV2Fields,
  type CandidateCheck,
  type CandidateModelConfig,
  type DeterministicIssue,
  type TopicCardInput,
  type TutorCaseSplit,
  validateTutorCritiqueIssues,
} from './contracts';
import { DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION, parseTutorLanguageResponse, TUTOR_LANGUAGE_CONTRACT_VERSION, TUTOR_LANGUAGE_PROMPT_VERSIONS, type TutorLanguagePromptVersion, type TutorLanguageResponse } from '@/app/lib/tutorLanguage';
import { EXTRACTOR_VERSION } from '@/app/lib/stateExtractor';
import { deriveAcceptableDirections, effectiveFamilyKey, normalizeInquiryBridges, TOPIC_ACTIVITY_MODES, TOPIC_CARD_SCHEMA_V2, TOPIC_CONTEXT_MODULES, TOPIC_DISCIPLINE_ANCHORS, type TopicActivityMode, type TopicContextModule, type TopicDisciplineAnchor, type TopicInquiryBridge } from './topicCardV2';
import { isLegacyTutorWarningClosure, isTutorWarningAssessment, isTutorWarningAssessmentV2, isTutorWarningClosed, sanitizeTutorWarningClosures, tutorWarningBlocksFinal, TUTOR_WARNING_SEVERITIES, type TutorWarningClosureMap, type TutorWarningDetectorVerdict, type TutorWarningFinalRelation, type TutorWarningSeverity } from './warningClosure';

export const REVIEW_LEASE_MS = 30 * 60 * 1000;
export const TUTOR_CRITIC_PROMPT_VERSION = 'tutor-critic-prompt-v2.1';

export const TUTOR_REVIEW_POLICIES = ['HUMAN_ANNOTATOR_REQUIRED', 'AI_DIRECT_TO_REVIEWER'] as const;
export type TutorReviewPolicy = (typeof TUTOR_REVIEW_POLICIES)[number];
export const TUTOR_DRAFT_PROVENANCES = ['HUMAN', 'AI_ASSISTED_HUMAN_SUBMIT', 'AI_DIRECT_ADMIN_AUTHORIZED'] as const;
export type TutorDraftProvenance = (typeof TUTOR_DRAFT_PROVENANCES)[number];
export const TUTOR_CASE_ISSUE_CATEGORIES = ['UNNATURAL_STUDENT_MESSAGE', 'KNOWLEDGE_STATE_CONTRADICTION', 'DATA_PROMPT_MISMATCH', 'PHASE_MISMATCH', 'INVALID_SCENARIO', 'LOW_DISCRIMINATION_VALUE', 'OTHER'] as const;
export type TutorCaseIssueCategory = (typeof TUTOR_CASE_ISSUE_CATEGORIES)[number];

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function audit(actorId: string, action: string, entityType: string, entityId: string, payload: unknown = {}) {
  return db.dataLabAuditLog.create({ data: { actorId, action, entityType, entityId, payloadJson: JSON.stringify(payload) } });
}

function cleanStrings(values: unknown): string[] {
  return Array.isArray(values) ? values.map(String).map((value) => value.trim()).filter(Boolean) : [];
}

function cardData(input: TopicCardInput, actorId?: string): Prisma.TopicCardCreateInput {
  const v2 = topicCardV2Fields(input);
  const bridges = v2?.inquiryBridges ?? [];
  const acceptableDirections = v2 ? deriveAcceptableDirections(bridges) : cleanStrings(input.acceptableDirections);
  return {
    displayTitle: input.displayTitle.trim(),
    studentOpening: input.studentOpening.trim(),
    internalArchetype: input.internalArchetype.trim(),
    subject: input.subject,
    gradeBand: input.gradeBand.trim(),
    coreMechanism: input.coreMechanism.trim(),
    acceptableDirectionsJson: JSON.stringify(acceptableDirections),
    forbiddenDirectionsJson: JSON.stringify(cleanStrings(input.forbiddenDirections)),
    curriculumAnchorsJson: JSON.stringify(cleanStrings(input.curriculumAnchors)),
    sourceJson: JSON.stringify(input.source),
    compilerEvidenceJson: JSON.stringify(input.criticOverrideReason?.trim() ? { ...(input.compilerEvidence ?? {}), adminOverride: { reason: input.criticOverrideReason.trim() } } : input.compilerEvidence ?? {}),
    schemaVersion: v2 ? TOPIC_CARD_SCHEMA_V2 : 1,
    activityMode: v2?.activityMode ?? '',
    contextModule: v2?.contextModule ?? '',
    disciplineAnchorsJson: JSON.stringify(v2?.disciplineAnchors ?? []),
    authenticNeed: v2?.authenticNeed.trim() ?? '',
    stakeholder: v2?.stakeholder?.trim() ?? '',
    engineeringGoal: v2?.engineeringGoal?.trim() ?? '',
    constraintsJson: JSON.stringify(cleanStrings(v2?.constraints)),
    performanceCriteriaJson: JSON.stringify(cleanStrings(v2?.performanceCriteria)),
    inquiryBridgesJson: JSON.stringify(bridges),
    ...(input.sourceCandidateId ? { sourceCandidate: { connect: { id: input.sourceCandidateId } } } : {}),
    ...(actorId ? { createdBy: { connect: { id: actorId } } } : {}),
  };
}

function cardUpdateData(input: TopicCardInput): Prisma.TopicCardUpdateInput {
  const data = cardData(input);
  const { createdBy, ...update } = data;
  void createdBy;
  return {
    ...update,
    sourceCandidate: input.sourceCandidateId ? { connect: { id: input.sourceCandidateId } } : { disconnect: true },
    status: 'DRAFT', approvedAt: null, approvedBy: { disconnect: true }, rejectionReason: '',
  };
}

function topicCardInputFromRecord(card: TopicCard): TopicCardInput {
  return {
    displayTitle: card.displayTitle,
    studentOpening: card.studentOpening,
    internalArchetype: card.internalArchetype,
    subject: card.subject as TopicCardInput['subject'],
    gradeBand: card.gradeBand,
    coreMechanism: card.coreMechanism,
    acceptableDirections: parseJson(card.acceptableDirectionsJson, []),
    forbiddenDirections: parseJson(card.forbiddenDirectionsJson, []),
    curriculumAnchors: parseJson(card.curriculumAnchorsJson, []),
    source: parseJson(card.sourceJson, {}),
    compilerEvidence: parseJson(card.compilerEvidenceJson, {}),
    criticOverrideReason: String(parseJson<{ adminOverride?: { reason?: unknown } }>(card.compilerEvidenceJson, {}).adminOverride?.reason ?? ''),
    schemaVersion: card.schemaVersion === TOPIC_CARD_SCHEMA_V2 ? TOPIC_CARD_SCHEMA_V2 : 1,
    activityMode: TOPIC_ACTIVITY_MODES.includes(card.activityMode as TopicActivityMode) ? card.activityMode as TopicActivityMode : undefined,
    contextModule: TOPIC_CONTEXT_MODULES.includes(card.contextModule as TopicContextModule) ? card.contextModule as TopicContextModule : undefined,
    disciplineAnchors: cleanStrings(parseJson(card.disciplineAnchorsJson, [])).filter((value): value is TopicDisciplineAnchor => TOPIC_DISCIPLINE_ANCHORS.includes(value as TopicDisciplineAnchor)),
    authenticNeed: card.authenticNeed,
    stakeholder: card.stakeholder,
    engineeringGoal: card.engineeringGoal,
    constraints: parseJson(card.constraintsJson, []),
    performanceCriteria: parseJson(card.performanceCriteriaJson, []),
    inquiryBridges: normalizeInquiryBridges(parseJson(card.inquiryBridgesJson, [])),
    sourceCandidateId: card.sourceCandidateId ?? undefined,
  };
}

function starterV2For(card: TopicCard): TopicCardInput {
  const original = topicCardInputFromRecord(card);
  const mode: TopicActivityMode = card.subject === 'engineering'
    ? 'ENGINEERING_DESIGN'
    : card.subject === 'high_concept_interdisciplinary'
      ? 'HYBRID'
      : 'SCIENTIFIC_INQUIRY';
  const inferredContextModule: TopicContextModule = card.subject === 'biology_ecology'
    ? 'LIFE_HEALTH'
    : card.subject === 'chemistry'
      ? 'ENERGY_ENVIRONMENT'
      : card.subject === 'physics'
        ? 'AEROSPACE'
        : card.subject === 'engineering'
          ? 'ENERGY_ENVIRONMENT'
          : 'AEROSPACE';
  const anchorMap: Record<string, TopicDisciplineAnchor[]> = {
    biology_ecology: ['biology'], chemistry: ['chemistry'], physics: ['physics'], engineering: ['physics', 'engineering'], high_concept_interdisciplinary: ['biology', 'engineering'],
  };
  const bridges: TopicInquiryBridge[] = cleanStrings(original.acceptableDirections).map((direction, index) => ({
    label: `候选方向 ${index + 1}`,
    retainedFeature: card.coreMechanism,
    researchQuestion: direction,
    factor: '',
    phenomenon: '',
    testScaffold: { levels: [], measurement: '', unit: '', metricKind: 'OTHER', controlledConditions: [] },
    ...(mode === 'SCIENTIFIC_INQUIRY' ? {} : { returnToDesign: '' }),
  }));
  return {
    ...original,
    schemaVersion: TOPIC_CARD_SCHEMA_V2,
    activityMode: mode,
    contextModule: inferredContextModule,
    disciplineAnchors: anchorMap[card.subject] ?? ['engineering'],
    authenticNeed: card.studentOpening,
    engineeringGoal: mode === 'SCIENTIFIC_INQUIRY' ? '' : card.displayTitle,
    constraints: mode === 'SCIENTIFIC_INQUIRY' ? [] : cleanStrings(original.forbiddenDirections),
    performanceCriteria: [],
    inquiryBridges: bridges,
  };
}

export async function createTopicCard(input: TopicCardInput, user: SessionUser) {
  const errors = validateTopicCardInput(input);
  if (errors.length) throw new Error(errors.join('；'));
  const card = await db.topicCard.create({ data: cardData(input, user.id) });
  await audit(user.id, 'TOPIC_CARD_CREATED', 'TopicCard', card.id, { subject: card.subject, schemaVersion: card.schemaVersion, sourceCandidateId: card.sourceCandidateId });
  return card;
}

export async function updateTopicCard(id: string, input: TopicCardInput, user: SessionUser) {
  const existing = await db.topicCard.findUnique({ where: { id } });
  if (!existing) throw new Error('话题卡不存在');
  if (existing.status === 'APPROVED' && await db.tutorTurnCase.count({ where: { topicCardId: id } }) > 0) {
    throw new Error('已用于案例生成的批准卡不可原地覆盖；请创建 V2 修订');
  }
  const errors = validateTopicCardInput(input);
  if (errors.length) throw new Error(errors.join('；'));
  const card = await db.topicCard.update({ where: { id }, data: cardUpdateData(input) });
  await audit(user.id, 'TOPIC_CARD_UPDATED', 'TopicCard', id, { schemaVersion: card.schemaVersion, revision: card.revision, criticOverrideReason: input.criticOverrideReason?.trim() || null });
  return card;
}

export async function createTopicCardRevision(id: string, user: SessionUser) {
  const existing = await db.topicCard.findUnique({ where: { id } });
  if (!existing) throw new Error('话题卡不存在');
  const rootId = existing.revisionOfId ?? existing.id;
  const latest = await db.topicCard.findFirst({
    where: { OR: [{ id: rootId }, { revisionOfId: rootId }] },
    orderBy: { revision: 'desc' },
  });
  const input = existing.schemaVersion === TOPIC_CARD_SCHEMA_V2 ? topicCardInputFromRecord(existing) : starterV2For(existing);
  const revision = await db.topicCard.create({
    data: {
      ...cardData(input, user.id),
      revision: (latest?.revision ?? existing.revision) + 1,
      revisionOf: { connect: { id: rootId } },
      status: 'DRAFT',
    },
  });
  await audit(user.id, 'TOPIC_CARD_REVISION_CREATED', 'TopicCard', revision.id, { revisionOfId: rootId, sourceCardId: id, revision: revision.revision });
  return revision;
}

function blockingTopicCardCritique(raw: string) {
  const evidence = parseJson<{ critique?: { issues?: Array<{ category?: unknown; message?: unknown; confidence?: unknown }> }; adminOverride?: { reason?: unknown } }>(raw, {});
  const blockingCategories = new Set(['RESOURCE_TYPE_MISMATCH', 'ENGINEERING_CONTEXT_LOST', 'PROXY_DRIFT', 'GENERIC_PARAMETER_TEMPLATE', 'NO_MEASURABLE_PERFORMANCE', 'NO_RETURN_TO_DESIGN', 'SOURCE_TITLE_COPY', 'SAFETY']);
  const issues = (evidence.critique?.issues ?? []).filter((issue) => issue.confidence === 'high' && blockingCategories.has(String(issue.category ?? '')));
  return { issues, overrideReason: String(evidence.adminOverride?.reason ?? '').trim() };
}

export async function deleteTopicCard(id: string, user: SessionUser) {
  const card = await db.topicCard.findUnique({ where: { id }, include: { cases: true } });
  if (!card) throw new Error('话题卡不存在');
  if (!['DRAFT', 'REJECTED'].includes(card.status)) throw new Error('只能删除草稿或已拒绝的话题卡');
  if (card.cases.length > 0) throw new Error('已被案例引用的话题卡不能删除');
  await db.topicCard.delete({ where: { id } });
  await audit(user.id, 'TOPIC_CARD_DELETED', 'TopicCard', id, { status: card.status, displayTitle: card.displayTitle });
}

export async function decideTopicCard(id: string, decision: 'APPROVE' | 'REJECT', reason: string, user: SessionUser) {
  const card = await db.topicCard.findUnique({ where: { id } });
  if (!card) throw new Error('话题卡不存在');
  const parsed = topicCardInputFromRecord(card);
  if (decision === 'APPROVE') {
    const errors = validateTopicCardInput(parsed);
    if (errors.length) throw new Error(errors.join('；'));
    const critique = blockingTopicCardCritique(card.compilerEvidenceJson);
    if (critique.issues.length && !critique.overrideReason) throw new Error(`存在 ${critique.issues.length} 条高置信度模型复核问题；请编辑修订并填写人工覆盖说明`);
  } else if (!reason.trim()) {
    throw new Error('拒绝必须填写理由');
  }
  const updated = await db.$transaction(async (tx) => {
    if (decision === 'APPROVE' && card.revisionOfId) {
      await tx.topicCard.updateMany({
        where: {
          id: { not: id },
          status: 'APPROVED',
          OR: [{ id: card.revisionOfId }, { revisionOfId: card.revisionOfId }],
        },
        data: { status: 'SUPERSEDED' },
      });
    }
    const next = await tx.topicCard.update({
      where: { id },
      data: decision === 'APPROVE'
        ? { status: 'APPROVED', approvedById: user.id, approvedAt: new Date(), rejectionReason: '' }
        : { status: 'REJECTED', approvedById: null, approvedAt: null, rejectionReason: reason.trim() },
    });
    if (decision === 'APPROVE' && next.sourceCandidateId) {
      await tx.topicSourceCandidate.update({ where: { id: next.sourceCandidateId }, data: { status: 'COMPILED' } });
    }
    return next;
  });
  await audit(user.id, `TOPIC_CARD_${updated.status}`, 'TopicCard', id, { reason, schemaVersion: updated.schemaVersion, revision: updated.revision, revisionOfId: updated.revisionOfId });
  return updated;
}

export async function listTopicCards(status?: string) {
  return db.topicCard.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ createdAt: 'desc' }, { revision: 'desc' }],
    include: {
      approvedBy: { select: { displayName: true } },
      revisionOf: { select: { id: true, displayTitle: true, revision: true, status: true } },
      sourceCandidate: { select: { id: true, title: true, familyKey: true, familyOverrideKey: true, sourcePlatform: true } },
      _count: { select: { cases: true, revisions: true } },
    },
  });
}

function objectFromRaw(raw: string): Record<string, unknown> | null {
  const candidates = [raw.trim(), raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()].filter(Boolean) as string[];
  for (const candidate of candidates) {
    for (const value of [candidate, repairJson(candidate)]) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch { /* continue */ }
    }
  }
  return null;
}

async function compileCardWithModel(source: Record<string, unknown>, config: CandidateModelConfig) {
  const provider = createLLMProvider({ provider: config.provider, model: config.model, role: 'EVALUATOR' });
  const system = `你是 TopicCard V2 编译器。根据管理员已确认授权、并补充了摘要的课程资源，设计一个新的初中 STEM 话题卡。
先判断资源类型，只能使用 STUDENT_INQUIRY_RESOURCE、STUDENT_ENGINEERING_RESOURCE、HYBRID_RESOURCE；若属于 TEACHER_RESOURCE、SCIENCE_POPULARIZATION、INSUFFICIENT_SOURCE，输出 {"rejected":true,"reason":"...","resourceAssessment":{"type":"...","reason":"..."}}。
不得直接复制资源标题，不得回退到泡腾片、纸飞机等无关通用模板。工程资源必须保留真实需求、功能和机制，不能只抽取一个无关控制变量实验。
subject 只能是 biology_ecology、chemistry、physics、engineering、high_concept_interdisciplinary。
activityMode 只能是 SCIENTIFIC_INQUIRY、ENGINEERING_DESIGN、HYBRID。
contextModule 只能是 LIFE_HEALTH、ENERGY_ENVIRONMENT、INTELLIGENT_INFORMATION、AEROSPACE、DEEP_EARTH_OCEAN。
disciplineAnchors 只能从 biology、chemistry、physics、earth_science、mathematics、information_technology、engineering 中选择。
必须给出至少两个同一主题机制下的 inquiryBridges。每个桥包含 label、retainedFeature、researchQuestion、factor、phenomenon、testScaffold；testScaffold 包含至少两个 levels、measurement、unit、metricKind、controlledConditions，可选 safeValueRange。工程或混合型还必须填写 engineeringGoal、constraints、performanceCriteria，并为每个桥填写 returnToDesign。
学生开场应自然表达困惑或需求，不得列出桥、变量或答案菜单。
只输出一个 JSON 对象：
{"resourceAssessment":{"type":"STUDENT_INQUIRY_RESOURCE|STUDENT_ENGINEERING_RESOURCE|HYBRID_RESOURCE","reason":""},"displayTitle":"","studentOpening":"","subject":"","gradeBand":"初中","coreMechanism":"","activityMode":"","contextModule":"","disciplineAnchors":[],"authenticNeed":"","stakeholder":"","engineeringGoal":"","constraints":[],"performanceCriteria":[],"inquiryBridges":[],"forbiddenDirections":[],"curriculumAnchors":[]}。不要输出 internalArchetype。`;
  const completion = await provider.complete([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(source) }], { useJsonFormat: true, maxTokens: 8000 });
  return { raw: completion.content, parsed: objectFromRaw(completion.content), promptSha256: sha256(system), params: { ...completion.request, usage: completion.usage } };
}

async function critiqueCompiledCard(source: Record<string, unknown>, target: Record<string, unknown>, config?: CandidateModelConfig) {
  const provider = createLLMProvider(config ? { provider: config.provider, model: config.model, role: 'EVALUATOR' } : { role: 'EVALUATOR' });
  const system = `你是 TopicCard V2 审核者。不要改写卡片，不打 Gold 分数。检查：RESOURCE_TYPE_MISMATCH、ENGINEERING_CONTEXT_LOST、PROXY_DRIFT、GENERIC_PARAMETER_TEMPLATE、NO_MEASURABLE_PERFORMANCE、NO_RETURN_TO_DESIGN、UNIQUE_ANSWER、GRADE_OR_CURRICULUM_MISMATCH、SAFETY、SOURCE_TITLE_COPY、INTERNAL_TERM、PROJECT_FAMILY_DUPLICATE。
只输出 JSON：{"issues":[{"quote":"目标原文","category":"上述类别","message":"具体问题","confidence":"high|medium|low"}]}。没有问题时 issues 为空。`;
  const completion = await provider.complete([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ source, target }) }], { useJsonFormat: true, maxTokens: 4000 });
  return objectFromRaw(completion.content) ?? { issues: [{ category: 'CRITIQUE_PARSE_FAILED', message: '批评输出无法解析', confidence: 'low', rawSnippet: completion.content.slice(0, 300) }] };
}

function compiledResourceAssessment(parsed: Record<string, unknown>) {
  const assessment = parsed.resourceAssessment && typeof parsed.resourceAssessment === 'object' && !Array.isArray(parsed.resourceAssessment)
    ? parsed.resourceAssessment as Record<string, unknown>
    : {};
  return { type: String(assessment.type ?? ''), reason: String(assessment.reason ?? '') };
}

export async function compileTopicCardsWithModels(input: {
  sources: Array<Record<string, unknown>>;
  modelA: CandidateModelConfig;
  modelB: CandidateModelConfig;
  internalArchetype?: string;
  user: SessionUser;
}, deps: { compileCard?: typeof compileCardWithModel; critiqueCard?: typeof critiqueCompiledCard } = {}) {
  const compileCard = deps.compileCard ?? compileCardWithModel;
  const critiqueCard = deps.critiqueCard ?? critiqueCompiledCard;
  const families = assertIndependentModelFamilies(input.modelA, input.modelB);
  const run = await db.bootstrapGenerationRun.create({
    data: {
      kind: 'TOPIC_CARD_COMPILATION', status: 'RUNNING', totalItems: input.sources.length * 2,
      modelConfigJson: JSON.stringify({ A: input.modelA, B: input.modelB, families }), parametersJson: JSON.stringify({ sourceCount: input.sources.length, sources: input.sources }), createdById: input.user.id, startedAt: new Date(),
    },
  });
  let completed = 0;
  let failed = 0;
  const cards: TopicCard[] = [];
  const acceptedResourceTypes = new Set(['STUDENT_INQUIRY_RESOURCE', 'STUDENT_ENGINEERING_RESOURCE', 'HYBRID_RESOURCE']);
  const failureDetails: Array<{ sourceIndex: number; sourceTitle: string; slot: 'A' | 'B'; kind: 'PARSE_FAILED' | 'MODEL_REJECTED' | 'VALIDATION_REJECTED'; reason: string; raw?: string; cardId?: string }> = [];
  try {
    for (const [sourceIndex, source] of input.sources.entries()) {
      const requestedSourceCandidateId = typeof source.sourceCandidateId === 'string' ? source.sourceCandidateId : '';
      const linkedSourceCandidate = requestedSourceCandidateId ? await db.topicSourceCandidate.findUnique({ where: { id: requestedSourceCandidateId }, select: { id: true } }) : null;
      const [a, b] = await Promise.all([compileCard(source, input.modelA), compileCard(source, input.modelB)]);
      const pairs = [
        { slot: 'A', own: a, critic: input.modelB },
        { slot: 'B', own: b, critic: input.modelA },
      ] as const;
      for (const pair of pairs) {
        const sourceTitle = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : `资源 ${sourceIndex + 1}`;
        if (!pair.own.parsed) {
          failed += 1;
          failureDetails.push({ sourceIndex, sourceTitle, slot: pair.slot, kind: 'PARSE_FAILED', reason: '模型输出无法解析为 JSON 对象', raw: pair.own.raw.slice(0, 4000) });
          continue;
        }
        const assessment = compiledResourceAssessment(pair.own.parsed);
        if (pair.own.parsed.rejected === true || !acceptedResourceTypes.has(assessment.type)) {
          failed += 1;
          failureDetails.push({
            sourceIndex, sourceTitle, slot: pair.slot, kind: 'MODEL_REJECTED',
            reason: String(pair.own.parsed.reason ?? assessment.reason ?? (assessment.type ? `资源类型 ${assessment.type} 不可编译` : '模型未给出有效资源类型判断')),
            raw: pair.own.raw.slice(0, 4000),
          });
          continue;
        }
        const critique = await critiqueCard(source, pair.own.parsed, pair.critic);
        const bridges = normalizeInquiryBridges(pair.own.parsed.inquiryBridges);
        const candidate: TopicCardInput = {
          displayTitle: String(pair.own.parsed.displayTitle ?? ''),
          studentOpening: String(pair.own.parsed.studentOpening ?? ''),
          internalArchetype: input.internalArchetype?.trim() || 'bootstrap_v2',
          subject: String(pair.own.parsed.subject ?? '') as TopicCardInput['subject'],
          gradeBand: String(pair.own.parsed.gradeBand ?? '初中'),
          coreMechanism: String(pair.own.parsed.coreMechanism ?? ''),
          acceptableDirections: deriveAcceptableDirections(bridges),
          forbiddenDirections: cleanStrings(pair.own.parsed.forbiddenDirections),
          curriculumAnchors: cleanStrings(pair.own.parsed.curriculumAnchors),
          source,
          compilerEvidence: { runId: run.id, slot: pair.slot, model: pair.slot === 'A' ? input.modelA : input.modelB, promptSha256: pair.own.promptSha256, params: pair.own.params, raw: pair.own.raw, resourceAssessment: assessment, critique },
          schemaVersion: TOPIC_CARD_SCHEMA_V2,
          activityMode: String(pair.own.parsed.activityMode ?? '') as TopicActivityMode,
          contextModule: String(pair.own.parsed.contextModule ?? '') as TopicContextModule,
          disciplineAnchors: cleanStrings(pair.own.parsed.disciplineAnchors) as TopicDisciplineAnchor[],
          authenticNeed: String(pair.own.parsed.authenticNeed ?? ''),
          stakeholder: String(pair.own.parsed.stakeholder ?? ''),
          engineeringGoal: String(pair.own.parsed.engineeringGoal ?? ''),
          constraints: cleanStrings(pair.own.parsed.constraints),
          performanceCriteria: cleanStrings(pair.own.parsed.performanceCriteria),
          inquiryBridges: bridges,
          sourceCandidateId: linkedSourceCandidate?.id,
        };
        const errors = validateTopicCardInput(candidate);
        const card = await db.topicCard.create({ data: { ...cardData(candidate, input.user.id), status: errors.length ? 'REJECTED' : 'DRAFT', rejectionReason: errors.join('；') } });
        cards.push(card);
        if (candidate.sourceCandidateId) await db.topicSourceCandidate.updateMany({ where: { id: candidate.sourceCandidateId }, data: { status: 'SHORTLISTED' } });
        if (errors.length) { failed += 1; failureDetails.push({ sourceIndex, sourceTitle, slot: pair.slot, kind: 'VALIDATION_REJECTED', reason: errors.join('；'), cardId: card.id }); } else completed += 1;
      }
    }
    await db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { status: failed && !completed ? 'FAILED' : 'COMPLETED', completedItems: completed, failedItems: failed, failureReason: failureDetails.length ? JSON.stringify(failureDetails) : '', completedAt: new Date() } });
  } catch (error) {
    await db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { status: 'FAILED', completedItems: completed, failedItems: failed + 1, failureReason: error instanceof Error ? error.message : String(error), completedAt: new Date() } });
    throw error;
  }
  await audit(input.user.id, 'TOPIC_CARD_COMPILATION_COMPLETED', 'BootstrapGenerationRun', run.id, { completed, failed, failureDetails, schemaVersion: TOPIC_CARD_SCHEMA_V2 });
  return { runId: run.id, cards, completed, failed, failures: failureDetails };
}

export type TutorCaseProfile = 'SMOKE_6' | 'CALIBRATION_12' | 'TRIAL_36' | 'FULL_180' | 'EVAL_80' | 'CUSTOM';

export function minTopicCardRequirement(profile: TutorCaseProfile): { total: number; description: string } {
  switch (profile) {
    case 'SMOKE_6': return { total: 3, description: '至少 3 张已批准话题卡' };
    case 'CALIBRATION_12': return { total: 6, description: '至少 6 张已批准话题卡' };
    case 'TRIAL_36': return { total: 10, description: '至少 10 张已批准话题卡，建议覆盖多个情境模块' };
    case 'FULL_180': return { total: 15, description: '满足正式集覆盖要求' };
    case 'EVAL_80': return { total: 10, description: '至少 10 张已批准话题卡' };
    default: return { total: 1, description: '至少 1 张已批准话题卡' };
  }
}

export class ExistingTutorCaseRunError extends Error {
  code = 'EXISTING_PROFILE_RUN' as const;

  constructor(public existingRun: { id: string; createdAt: Date }) {
    super('该类型已有有效案例批次，确认后才能创建新批次');
    this.name = 'ExistingTutorCaseRunError';
  }
}

export const TOPIC_CARD_IDEATION_PROMPT_VERSION = 'topic-card-ideation-v1';

function ideationSystemPrompt() {
  return `你是初中 STEM 话题卡设计师。请原创设计一张新的话题卡：一个真实情境加上多条学生可以在课堂里走完“选题→方案→执行→分析→报告→反思”六阶段的研究路线。
情境必须真实可信、贴近初中生生活或社会议题，材料安全易得；不得使用泡腾片、纸飞机等被过度使用的通用模板，不得与“已有话题”列表中的情境或机制重复。
subject 只能是 biology_ecology、chemistry、physics、engineering、high_concept_interdisciplinary。
activityMode 只能是 SCIENTIFIC_INQUIRY、ENGINEERING_DESIGN、HYBRID。
contextModule 只能是 LIFE_HEALTH、ENERGY_ENVIRONMENT、INTELLIGENT_INFORMATION、AEROSPACE、DEEP_EARTH_OCEAN。
disciplineAnchors 只能从 biology、chemistry、physics、earth_science、mathematics、information_technology、engineering 中选择。
必须给出至少两个同一主题机制下的 inquiryBridges。每个桥包含 label、retainedFeature、researchQuestion、factor、phenomenon、testScaffold；testScaffold 包含至少两个 levels、measurement、unit、metricKind、controlledConditions，可选 safeValueRange。levels 必须是学生实际可设置的具体档位。工程或混合型还必须填写 engineeringGoal、constraints、performanceCriteria，并为每个桥填写 returnToDesign。
curriculumAnchors 至少一条，引用初中科学课程中的真实概念。
学生开场应自然表达困惑或需求，不得列出桥、变量或答案菜单。
只输出一个 JSON 对象：
{"displayTitle":"","studentOpening":"","subject":"","gradeBand":"初中","coreMechanism":"","activityMode":"","contextModule":"","disciplineAnchors":[],"authenticNeed":"","stakeholder":"","engineeringGoal":"","constraints":[],"performanceCriteria":[],"inquiryBridges":[],"forbiddenDirections":[],"curriculumAnchors":[]}。不要输出 internalArchetype。`;
}

export async function generateTopicCardDrafts(input: {
  theme?: string;
  activityMode?: TopicActivityMode;
  contextModule?: TopicContextModule;
  count?: number;
  user: SessionUser;
}, deps: { complete?: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<LLMCompletion>; critiqueCard?: typeof critiqueCompiledCard } = {}) {
  const count = Math.min(Math.max(Math.trunc(input.count ?? 1), 1), 5);
  const critiqueCard = deps.critiqueCard ?? critiqueCompiledCard;
  const provider = createLLMProvider({ role: 'EVALUATOR' });
  const complete = deps.complete ?? ((messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => provider.complete(messages, { useJsonFormat: true, maxTokens: 8000 }));
  const system = ideationSystemPrompt();
  const existing = await db.topicCard.findMany({
    where: { status: { in: ['DRAFT', 'APPROVED'] } },
    orderBy: { createdAt: 'desc' },
    take: 80,
    select: { displayTitle: true, coreMechanism: true },
  });
  const avoidList = existing.map((card) => `${card.displayTitle}（${card.coreMechanism.slice(0, 40)}）`);
  const run = await db.bootstrapGenerationRun.create({
    data: {
      kind: 'TOPIC_CARD_IDEATION', status: 'RUNNING', totalItems: count,
      modelConfigJson: JSON.stringify({ role: 'EVALUATOR', promptVersion: TOPIC_CARD_IDEATION_PROMPT_VERSION }),
      promptHashesJson: JSON.stringify({ system: sha256(system) }),
      parametersJson: JSON.stringify({ theme: input.theme ?? '', activityMode: input.activityMode ?? '', contextModule: input.contextModule ?? '', count }),
      createdById: input.user.id, startedAt: new Date(),
    },
  });
  let completed = 0;
  let failed = 0;
  const cards: TopicCard[] = [];
  const failures: Array<{ index: number; kind: 'PARSE_FAILED' | 'VALIDATION_REJECTED'; reason: string; cardId?: string }> = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const brief = {
        主题方向: input.theme?.trim() || '由你选择一个未被已有话题覆盖的方向',
        指定活动模式: input.activityMode ?? '不限',
        指定情境模块: input.contextModule ?? '不限',
        已有话题: avoidList,
      };
      const completion = await complete([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(brief) }]);
      const parsed = objectFromRaw(completion.content);
      if (!parsed) {
        failed += 1;
        const reason = `模型输出无法解析为 JSON 对象。原始响应前 500 字符：${completion.content.slice(0, 500)}`;
        failures.push({ index, kind: 'PARSE_FAILED', reason });
        // 创建 REJECTED 卡供调试
        const rejectedCard = await db.topicCard.create({
          data: {
            displayTitle: `[解析失败 #${index + 1}]`,
            studentOpening: '模型返回内容无法解析为有效 JSON',
            internalArchetype: 'ai_ideation_parse_failed',
            subject: 'biology_ecology',
            gradeBand: '初中',
            coreMechanism: '解析失败',
            acceptableDirectionsJson: '[]',
            forbiddenDirectionsJson: '[]',
            curriculumAnchorsJson: '[]',
            sourceJson: JSON.stringify({ kind: 'AI_IDEATION', theme: input.theme?.trim() ?? '', promptVersion: TOPIC_CARD_IDEATION_PROMPT_VERSION, runId: run.id }),
            compilerEvidenceJson: JSON.stringify({ runId: run.id, promptSha256: sha256(system), raw: completion.content.slice(0, 2000), parseError: true }),
            schemaVersion: 2,
            activityMode: '',
            contextModule: '',
            disciplineAnchorsJson: '[]',
            authenticNeed: '',
            stakeholder: '',
            engineeringGoal: '',
            constraintsJson: '[]',
            performanceCriteriaJson: '[]',
            inquiryBridgesJson: '[]',
            status: 'REJECTED',
            rejectionReason: reason,
            createdById: input.user.id,
          },
        });
        cards.push(rejectedCard);
        continue;
      }
      const source = { kind: 'AI_IDEATION', theme: input.theme?.trim() ?? '', promptVersion: TOPIC_CARD_IDEATION_PROMPT_VERSION, runId: run.id };
      const critique = await critiqueCard(source, parsed);
      const bridges = normalizeInquiryBridges(parsed.inquiryBridges);
      const candidate: TopicCardInput = {
        displayTitle: String(parsed.displayTitle ?? ''),
        studentOpening: String(parsed.studentOpening ?? ''),
        internalArchetype: 'ai_ideation_v1',
        subject: String(parsed.subject ?? '') as TopicCardInput['subject'],
        gradeBand: String(parsed.gradeBand ?? '初中'),
        coreMechanism: String(parsed.coreMechanism ?? ''),
        acceptableDirections: deriveAcceptableDirections(bridges),
        forbiddenDirections: cleanStrings(parsed.forbiddenDirections),
        curriculumAnchors: cleanStrings(parsed.curriculumAnchors),
        source,
        compilerEvidence: { runId: run.id, promptSha256: sha256(system), params: { ...completion.request, usage: completion.usage }, raw: completion.content, critique, criticSameFamily: true },
        schemaVersion: TOPIC_CARD_SCHEMA_V2,
        activityMode: (input.activityMode ?? String(parsed.activityMode ?? '')) as TopicActivityMode,
        contextModule: (input.contextModule ?? String(parsed.contextModule ?? '')) as TopicContextModule,
        disciplineAnchors: cleanStrings(parsed.disciplineAnchors) as TopicDisciplineAnchor[],
        authenticNeed: String(parsed.authenticNeed ?? ''),
        stakeholder: String(parsed.stakeholder ?? ''),
        engineeringGoal: String(parsed.engineeringGoal ?? ''),
        constraints: cleanStrings(parsed.constraints),
        performanceCriteria: cleanStrings(parsed.performanceCriteria),
        inquiryBridges: bridges,
      };
      const errors = validateTopicCardInput(candidate);
      const card = await db.topicCard.create({ data: { ...cardData(candidate, input.user.id), status: errors.length ? 'REJECTED' : 'DRAFT', rejectionReason: errors.join('；') } });
      cards.push(card);
      if (errors.length) {
        failed += 1;
        failures.push({ index, kind: 'VALIDATION_REJECTED', reason: errors.join('；'), cardId: card.id });
      } else {
        completed += 1;
        avoidList.push(`${card.displayTitle}（${card.coreMechanism.slice(0, 40)}）`);
      }
    }
    await db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { status: failed && !completed ? 'FAILED' : 'COMPLETED', completedItems: completed, failedItems: failed, failureReason: failures.length ? JSON.stringify(failures) : '', completedAt: new Date() } });
  } catch (error) {
    await db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { status: 'FAILED', completedItems: completed, failedItems: failed + 1, failureReason: error instanceof Error ? error.message : String(error), completedAt: new Date() } });
    throw error;
  }
  await audit(input.user.id, 'TOPIC_CARD_IDEATION_COMPLETED', 'BootstrapGenerationRun', run.id, { completed, failed, failures, theme: input.theme ?? '' });
  return { runId: run.id, cards, completed, failed, failures };
}

export interface TopicCardCoverageCard {
  id?: string;
  subject: string;
  schemaVersion?: number;
  contextModule?: string;
  activityMode?: string;
  sourceCandidate?: { familyKey: string; familyOverrideKey: string } | null;
}

export function tutorTopicCardCoverage(cards: TopicCardCoverageCard[]) {
  const subjects = Object.fromEntries(BOOTSTRAP_SUBJECTS.map((subject) => [subject, cards.filter((card) => card.subject === subject).length]));
  const contextModules = Object.fromEntries(TOPIC_CONTEXT_MODULES.map((contextModule) => [contextModule, cards.filter((card) => card.contextModule === contextModule).length]));
  const v2Count = cards.filter((card) => card.schemaVersion === TOPIC_CARD_SCHEMA_V2).length;
  const engineeringCards = cards.filter((card) => card.activityMode === 'ENGINEERING_DESIGN' || card.activityMode === 'HYBRID');
  const engineeringByModule = Object.fromEntries(TOPIC_CONTEXT_MODULES.map((contextModule) => [contextModule, engineeringCards.filter((card) => card.contextModule === contextModule).length]));
  const familyCounts = new Map<string, number>();
  for (const card of cards) {
    const family = card.sourceCandidate ? effectiveFamilyKey(card.sourceCandidate) : card.id ? `card:${card.id}` : '';
    if (family) familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }
  const duplicateFamilies = [...familyCounts.entries()].filter(([, count]) => count > 1).map(([familyKey, count]) => ({ familyKey, count }));
  return {
    total: cards.length,
    v2Count,
    v1Count: cards.length - v2Count,
    subjects,
    contextModules,
    engineeringOrHybrid: engineeringCards.length,
    engineeringByModule,
    duplicateFamilies,
  };
}

export function tutorTopicCardDiversityFailures(cards: TopicCardCoverageCard[]) {
  const coverage = tutorTopicCardCoverage(cards);
  const failures: string[] = [];
  if (coverage.total < 15) failures.push(`FULL_REQUIRES_AT_LEAST_15_APPROVED_TOPIC_CARDS:${coverage.total}`);
  if (coverage.v2Count !== coverage.total) failures.push(`FULL_REQUIRES_ALL_V2_TOPIC_CARDS:${coverage.v2Count}/${coverage.total}`);
  for (const subject of BOOTSTRAP_SUBJECTS) {
    const count = coverage.subjects[subject];
    if (count < 3) failures.push(`FULL_REQUIRES_3_TOPIC_CARDS_PER_SUBJECT:${subject}:${count}`);
  }
  for (const contextModule of TOPIC_CONTEXT_MODULES) {
    const count = coverage.contextModules[contextModule];
    if (count < 3) failures.push(`FULL_REQUIRES_3_TOPIC_CARDS_PER_CONTEXT_MODULE:${contextModule}:${count}`);
    if (coverage.engineeringByModule[contextModule] < 1) failures.push(`FULL_REQUIRES_ENGINEERING_OR_HYBRID_PER_CONTEXT_MODULE:${contextModule}:0`);
  }
  if (coverage.engineeringOrHybrid < 6) failures.push(`FULL_REQUIRES_6_ENGINEERING_OR_HYBRID_TOPIC_CARDS:${coverage.engineeringOrHybrid}`);
  for (const duplicate of coverage.duplicateFamilies) failures.push(`FULL_DUPLICATE_PROJECT_FAMILY:${duplicate.familyKey}:${duplicate.count}`);
  return failures;
}

export async function approvedTopicCardCoverage() {
  const cards = await db.topicCard.findMany({
    where: { status: 'APPROVED' },
    include: { sourceCandidate: { select: { familyKey: true, familyOverrideKey: true } } },
    orderBy: { approvedAt: 'asc' },
  });
  return { coverage: tutorTopicCardCoverage(cards), fullFailures: tutorTopicCardDiversityFailures(cards) };
}

export async function compileTutorTurnCases(input: {
  profile: TutorCaseProfile;
  counts?: Record<number, number>;
  split: TutorCaseSplit;
  topicCardIds?: string[];
  promptVersion?: TutorLanguagePromptVersion;
  reviewPolicy?: TutorReviewPolicy;
  allowExistingRun?: boolean;
  user: SessionUser;
}) {
  if (!TUTOR_CASE_SPLITS.includes(input.split)) throw new Error('split 无效');
  const promptVersion = input.promptVersion ?? DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION;
  if (!TUTOR_LANGUAGE_PROMPT_VERSIONS.includes(promptVersion)) throw new Error('promptVersion 无效');
  const reviewPolicy = input.reviewPolicy ?? 'HUMAN_ANNOTATOR_REQUIRED';
  if (!TUTOR_REVIEW_POLICIES.includes(reviewPolicy)) throw new Error('reviewPolicy 无效');
  if (input.profile !== 'CUSTOM' && !input.allowExistingRun) {
    const existingRun = await db.bootstrapGenerationRun.findFirst({
      where: {
        kind: 'CASE_COMPILATION',
        status: 'COMPLETED',
        parametersJson: { contains: `"profile":"${input.profile}"` },
        cases: { some: { status: { not: 'SUPERSEDED' } } },
      },
      orderBy: { completedAt: 'desc' },
      select: { id: true, createdAt: true },
    });
    if (existingRun) throw new ExistingTutorCaseRunError(existingRun);
  }
  const where: Prisma.TopicCardWhereInput = { status: 'APPROVED', ...(input.topicCardIds?.length ? { id: { in: input.topicCardIds } } : {}) };
  const cards = await db.topicCard.findMany({ where, orderBy: { approvedAt: 'asc' }, include: { sourceCandidate: { select: { familyKey: true, familyOverrideKey: true } } } });
  const topicCoverage = tutorTopicCardCoverage(cards);
  const counts = input.profile === 'TRIAL_36' ? TRIAL_CASE_COUNTS : input.profile === 'FULL_180' ? FULL_CASE_COUNTS : input.profile === 'EVAL_80' ? EVAL_CASE_COUNTS : input.counts ?? {};
  if (input.profile === 'SMOKE_6' && input.split !== 'PILOT') throw new Error('SMOKE_6 profile 必须使用 PILOT split');
  if (input.profile === 'CALIBRATION_12' && input.split !== 'PILOT') throw new Error('CALIBRATION_12 profile 必须使用 PILOT split');
  if (input.profile === 'EVAL_80' && input.split !== 'EVAL') throw new Error('EVAL_80 profile 必须使用 EVAL split');
  if (input.profile === 'CALIBRATION_12') {
    const smoke = await smokeQualityReport();
    if (!smoke.pass) throw new Error(`Calibration 12 必须先通过最新 Smoke 6：${smoke.failures.join('、')}`);
  }
  if (input.profile === 'TRIAL_36') {
    const calibration = await calibrationQualityReport();
    if (!calibration.pass) throw new Error(`36 案例试验必须先通过最新 Calibration 12：${calibration.failures.join('、')}`);
  }
  if (input.profile === 'FULL_180') {
    const latestTrial = await db.bootstrapGenerationRun.findFirst({ where: { kind: 'CASE_COMPILATION', parametersJson: { contains: '"profile":"TRIAL_36"' }, status: 'COMPLETED', cases: { some: { status: { not: 'SUPERSEDED' } } } }, orderBy: { completedAt: 'desc' } });
    const signoff = latestTrial ? await db.bootstrapGenerationRun.findFirst({ where: { kind: 'TRIAL_SIGNOFF', status: 'COMPLETED', parametersJson: { contains: `"trialRunId":"${latestTrial.id}"` } }, orderBy: { completedAt: 'desc' } }) : null;
    if (!latestTrial || !signoff) throw new Error('180 正式集必须在最新 36 案例试验通过自动指标并完成人工逐条复盘签署后生成');
    const diversityFailures = tutorTopicCardDiversityFailures(cards);
    if (diversityFailures.length) throw new Error(`180 条正式集的话题多样性门槛未通过：${diversityFailures.join('、')}`);
  }
  const requirement = minTopicCardRequirement(input.profile);
  if (cards.length < requirement.total) {
    throw new Error(`${requirement.description}，当前只有 ${cards.length} 张`);
  }
  const fixedScenarios = input.profile === 'SMOKE_6'
    ? SMOKE_6_SCENARIOS
    : input.profile === 'CALIBRATION_12'
      ? CALIBRATION_12_SCENARIOS
      : null;
  const total = fixedScenarios ? fixedScenarios.length : Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (!total) throw new Error('案例数量必须大于 0');
  const parameters = { profile: input.profile, counts: fixedScenarios ? undefined : counts, split: input.split, promptVersion, reviewPolicy, topicCoverage };
  const run = await db.bootstrapGenerationRun.create({
    data: { kind: 'CASE_COMPILATION', status: 'RUNNING', totalItems: total, parametersJson: JSON.stringify(parameters), reviewPolicy, ...(reviewPolicy === 'AI_DIRECT_TO_REVIEWER' ? { aiDirectAuthorizedById: input.user.id, aiDirectAuthorizedAt: new Date() } : {}), createdById: input.user.id, startedAt: new Date() },
  });
  try {
    const compiled = fixedScenarios
      ? compileScenarioCases(cards, fixedScenarios, input.split, promptVersion)
      : compileCases(cards, counts, input.split, promptVersion);
    const created = await db.$transaction(compiled.map((item) => db.tutorTurnCase.create({
      data: {
        topicCardId: item.topicCardId,
        generationRunId: run.id,
        phase: item.phase,
        triggerType: item.triggerType,
        studentMessage: item.studentMessage,
        historyJson: JSON.stringify(item.history),
        stageStateJson: JSON.stringify(item.stageState),
        visibleFactsJson: JSON.stringify(item.visibleFacts),
        privateReviewSpecJson: JSON.stringify(item.privateReviewSpec),
        dataSource: 'BOOTSTRAP', split: item.split,
        contractVersion: TUTOR_LANGUAGE_CONTRACT_VERSION,
        extractorVersion: EXTRACTOR_VERSION,
        promptVersion: item.promptVersion,
        systemPrompt: item.systemPrompt,
        promptSha256: item.promptSha256,
        hardCheckJson: JSON.stringify(item.hardCheck),
        status: item.hardCheck.errors.length ? 'BLOCKED' : 'READY',
      },
    })));
    await db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedItems: created.length, completedAt: new Date(), promptHashesJson: JSON.stringify([...new Set(created.map((item) => item.promptSha256))]) } });
    await audit(input.user.id, 'TUTOR_CASES_COMPILED', 'BootstrapGenerationRun', run.id, { profile: input.profile, count: created.length, split: input.split, promptVersion, reviewPolicy, aiDirectAuthorized: reviewPolicy === 'AI_DIRECT_TO_REVIEWER' });
    return { runId: run.id, cases: created, promptVersion, topicCoverage, coverageWarnings: input.profile === 'FULL_180' ? [] : tutorTopicCardDiversityFailures(cards) };
  } catch (error) {
    await db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { status: 'FAILED', failedItems: total, failureReason: error instanceof Error ? error.message : String(error), completedAt: new Date() } });
    throw error;
  }
}

function allowedFocus(caseItem: { visibleFactsJson: string }) {
  const visible = parseJson<{ allowedFocusIds?: unknown }>(caseItem.visibleFactsJson, {});
  return Array.isArray(visible.allowedFocusIds) ? visible.allowedFocusIds.filter((item): item is string => typeof item === 'string') : [];
}

async function reviewPolicyForCase(caseItem: { generationRunId?: string | null }) {
  if (!caseItem.generationRunId) return { policy: 'HUMAN_ANNOTATOR_REQUIRED' as TutorReviewPolicy, authorizedById: null as string | null };
  const run = await db.bootstrapGenerationRun.findUnique({ where: { id: caseItem.generationRunId }, select: { reviewPolicy: true, aiDirectAuthorizedById: true } });
  const policy = TUTOR_REVIEW_POLICIES.includes(run?.reviewPolicy as TutorReviewPolicy)
    ? run!.reviewPolicy as TutorReviewPolicy
    : 'HUMAN_ANNOTATOR_REQUIRED';
  return { policy, authorizedById: run?.aiDirectAuthorizedById ?? null };
}

interface GeneratedCandidatePayload {
  raw: string;
  params: Record<string, unknown>;
}

interface CritiqueInput {
  target: TutorLanguageResponse | null;
  targetRaw: string;
  caseItem: { phase: number; triggerType: string; studentMessage: string; visibleFactsJson: string; privateReviewSpecJson: string };
  config: CandidateModelConfig;
}

interface CritiquePayload {
  status: 'COMPLETED';
  issues: unknown[];
  advisories: unknown[];
  raw: string;
  critic: { provider: string; model: string; family: string };
  params: Record<string, unknown>;
  promptVersion?: string;
  promptSha256?: string;
}

export interface CandidateGenerationDeps {
  generateOne?: (caseItem: { systemPrompt: string; historyJson: string; triggerType: string; studentMessage: string }, config: CandidateModelConfig) => Promise<GeneratedCandidatePayload>;
  critiqueCandidate?: (input: CritiqueInput) => Promise<CritiquePayload>;
}

async function generateOne(caseItem: { systemPrompt: string; historyJson: string; triggerType: string; studentMessage: string }, config: CandidateModelConfig) {
  const provider = createLLMProvider({ provider: config.provider, model: config.model, role: 'TUTOR' });
  const history = parseJson<Array<{ role: 'user' | 'assistant'; content: string }>>(caseItem.historyJson, []);
  const completion = await provider.complete([
    { role: 'system', content: caseItem.systemPrompt },
    ...history,
    { role: 'user', content: caseItem.triggerType === 'SYSTEM_TRIGGER' ? '这是系统触发，不是学生发言。请按合同给出自然引导。' : caseItem.studentMessage },
  ], { useJsonFormat: true, maxTokens: 1200 });
  return { raw: completion.content, params: { ...completion.request, finishReason: completion.finishReason, usage: completion.usage } };
}

async function critiqueCandidate(input: CritiqueInput): Promise<CritiquePayload> {
  const provider = createLLMProvider({ provider: input.config.provider, model: input.config.model, role: 'EVALUATOR' });
  const system = `你是交叉 Critic。只定位候选原文中可验证的问题，不评分、不改写、不判断训练资格。
私有审核规范只能用于识别风险和 forbidden move，绝不能作为 Tutor 可见事实、答案来源或要求候选必须提及的内容。
allowed focus 和 focusDescriptions 是本回合权威教学任务；当学生表达控制变量、因果或安全误解时，候选直接解释并纠正该误解是合适行为，不得因此指责其剥夺探索。
只报告明确违反 grounding、单轮单任务、学生主体性、安全、泄漏或输出合同的问题；不要因为候选省略可选优化信息而报错。
候选可以自然转述可见事实，不要求逐字复述行号或字段；只有转述改变含义、指代不清或加入新事实时才报告 grounding。
grounding 问题必须同时给出候选逐字 quote 和学生消息/visibleFacts 中的逐字 sourceQuote。非 grounding 的 sourceQuote 可为空。
confidence 只有在证据直接、无歧义时才用 high；不确定或仅属优化建议时用 medium/low。
只输出 JSON：{"issues":[{"quote":"候选逐字片段","category":"grounding|pedagogy|safety|leakage|contract","message":"具体问题","sourceQuote":"可见证据逐字片段或空字符串","confidence":"high|medium|low"}]}。没有问题输出空 issues。`;
  const visibleFacts = parseJson(input.caseItem.visibleFactsJson, {});
  const completion = await provider.complete([
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({
      phase: input.caseItem.phase,
      triggerType: input.caseItem.triggerType,
      studentMessage: input.caseItem.studentMessage,
      visibleFacts,
      privateReviewSpec: parseJson(input.caseItem.privateReviewSpecJson, {}),
      candidate: input.target ?? input.targetRaw,
    }) },
  ], { useJsonFormat: true, maxTokens: 1400 });
  const parsed = objectFromRaw(completion.content);
  const candidateText = JSON.stringify(input.target ?? input.targetRaw);
  const visibleEvidenceText = `${input.caseItem.studentMessage}\n${JSON.stringify(visibleFacts)}`;
  const validated = validateTutorCritiqueIssues(parsed?.issues, candidateText, visibleEvidenceText);
  return {
    status: 'COMPLETED' as const,
    issues: validated.blocking,
    advisories: validated.advisories,
    raw: completion.content,
    critic: { provider: input.config.provider, model: input.config.model, family: normalizeModelFamily(input.config) },
    params: { ...completion.request, usage: completion.usage },
    promptVersion: TUTOR_CRITIC_PROMPT_VERSION,
    promptSha256: sha256(system),
  };
}

function errorText(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause) return error.message;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: unknown }).code;
    return `${error.message}: ${cause.message}${typeof code === 'string' ? ` (${code})` : ''}`;
  }
  return `${error.message}: ${String(cause)}`;
}

function candidateCreateData(input: {
  caseId: string;
  runId: string;
  slot: 'A' | 'B';
  attempt: number;
  config: CandidateModelConfig;
  family: string;
  generated: GeneratedCandidatePayload;
  checked: ReturnType<typeof checkTutorCandidate>;
  promptSha256: string;
}): Prisma.TutorCandidateUncheckedCreateInput {
  return {
    caseId: input.caseId,
    generationRunId: input.runId,
    slot: input.slot,
    attempt: input.attempt,
    provider: input.config.provider,
    modelFamily: input.family,
    externalModelId: input.config.model,
    modelVersionTag: input.config.tag ?? `${input.config.provider}:${input.config.model}`,
    rawOutput: input.generated.raw,
    normalizedOutput: input.checked.normalized ? JSON.stringify(input.checked.normalized) : '',
    deterministicCheckJson: JSON.stringify(input.checked.check),
    critiqueJson: JSON.stringify({ status: 'PENDING', issues: [], advisories: [] }),
    generationParamsJson: JSON.stringify(input.generated.params),
    promptSha256: input.promptSha256,
    status: 'CRITIQUE_PENDING',
  };
}

async function completeCandidateReviewFlow(caseId: string, runId: string, actorId: string) {
  await db.$transaction(async (tx) => {
    await tx.tutorReviewTask.upsert({
      where: { caseId_type: { caseId, type: 'EDIT' } },
      create: { caseId, type: 'EDIT', status: 'PENDING' },
      update: { status: 'PENDING', assignedToId: null, leaseExpiresAt: null, operatorId: null, decision: '', selectedCandidateId: null, preferenceRejectedCandidateId: null, draftJson: '{}', reason: '', preferenceReason: '', warningClosureJson: '{}', submissionMode: 'HUMAN', authorizedById: null, caseIssueJson: '{}', submittedAt: null },
    });
    await tx.tutorReviewTask.deleteMany({ where: { caseId, type: 'CONFIRM' } });
    await tx.tutorTurnCase.update({ where: { id: caseId }, data: { status: 'IN_REVIEW' } });
    await tx.bootstrapGenerationRun.update({ where: { id: runId }, data: { status: 'COMPLETED', completedItems: 4, failedItems: 0, failureReason: '', completedAt: new Date() } });
  });
  await audit(actorId, 'TUTOR_CANDIDATES_GENERATED', 'TutorTurnCase', caseId, { runId });
}

export async function generateTutorCandidates(
  input: { caseId: string; modelA: CandidateModelConfig; modelB: CandidateModelConfig; user: SessionUser },
  deps: CandidateGenerationDeps = {},
) {
  const generate = deps.generateOne ?? generateOne;
  const critique = deps.critiqueCandidate ?? critiqueCandidate;
  const families = assertIndependentModelFamilies(input.modelA, input.modelB);
  const caseItem = await db.tutorTurnCase.findUnique({ where: { id: input.caseId } });
  if (!caseItem || !['READY', 'NEEDS_REGEN', 'IN_REVIEW'].includes(caseItem.status)) throw new Error('案例不存在或当前状态不可生成');
  const hard = parseJson<{ errors?: string[] }>(caseItem.hardCheckJson, {});
  if (hard.errors?.length) throw new Error(`案例硬门禁未通过：${hard.errors.join('；')}`);
  const attempt = ((await db.tutorCandidate.aggregate({ where: { caseId: caseItem.id }, _max: { attempt: true } }))._max.attempt ?? 0) + 1;
  const run = await db.bootstrapGenerationRun.create({
    data: { kind: 'CANDIDATE_GENERATION', status: 'RUNNING', totalItems: 4, modelConfigJson: JSON.stringify({ A: input.modelA, B: input.modelB, families }), parametersJson: JSON.stringify({ caseId: caseItem.id, attempt }), createdById: input.user.id, startedAt: new Date() },
  });
  try {
    const generated = await Promise.allSettled([generate(caseItem, input.modelA), generate(caseItem, input.modelB)]);
    const focuses = allowedFocus(caseItem);
    const successful: Array<{ slot: 'A' | 'B'; config: CandidateModelConfig; family: string; generated: GeneratedCandidatePayload; checked: ReturnType<typeof checkTutorCandidate> }> = [];
    const failedStages: Array<{ stage: string; error: string }> = [];
    for (const [index, result] of generated.entries()) {
      const slot = index === 0 ? 'A' as const : 'B' as const;
      const config = slot === 'A' ? input.modelA : input.modelB;
      const family = slot === 'A' ? families.familyA : families.familyB;
      if (result.status === 'rejected') {
        failedStages.push({ stage: `TUTOR_${slot}`, error: errorText(result.reason) });
        continue;
      }
      successful.push({
        slot, config, family, generated: result.value,
        checked: checkTutorCandidate({ rawOutput: result.value.raw, allowedFocusIds: focuses, phase: caseItem.phase, triggerType: caseItem.triggerType, studentMessage: caseItem.studentMessage }),
      });
    }
    const persisted = await db.$transaction(successful.map((item) => db.tutorCandidate.create({ data: candidateCreateData({ caseId: caseItem.id, runId: run.id, slot: item.slot, attempt, config: item.config, family: item.family, generated: item.generated, checked: item.checked, promptSha256: caseItem.promptSha256 }) })));
    await db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { completedItems: persisted.length, promptHashesJson: JSON.stringify([caseItem.promptSha256]) } });
    if (persisted.length !== 2) {
      await db.$transaction([
        db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { status: 'PARTIAL_FAILED', failedItems: 4 - persisted.length, failureReason: JSON.stringify(failedStages), completedAt: new Date() } }),
        db.tutorTurnCase.update({ where: { id: caseItem.id }, data: { status: 'NEEDS_REGEN' } }),
      ]);
      await audit(input.user.id, 'TUTOR_GENERATION_PARTIAL_FAILED', 'BootstrapGenerationRun', run.id, { caseId: caseItem.id, failedStages });
      return { status: 'PARTIAL_FAILED' as const, runId: run.id, candidates: persisted, failedStages, canRetryCritics: false };
    }

    const candidateA = persisted.find((item) => item.slot === 'A')!;
    const candidateB = persisted.find((item) => item.slot === 'B')!;
    const checkedA = successful.find((item) => item.slot === 'A')!.checked;
    const checkedB = successful.find((item) => item.slot === 'B')!.checked;
    const critiques = await Promise.allSettled([
      critique({ target: checkedB.normalized, targetRaw: candidateB.rawOutput, caseItem, config: input.modelA }),
      critique({ target: checkedA.normalized, targetRaw: candidateA.rawOutput, caseItem, config: input.modelB }),
    ]);
    const critiqueTargets = [candidateB, candidateA];
    const critiqueFailures: Array<{ stage: string; error: string }> = [];
    for (const [index, result] of critiques.entries()) {
      const target = critiqueTargets[index];
      const check = target.slot === 'A' ? checkedA.check : checkedB.check;
      if (result.status === 'fulfilled') {
        await db.tutorCandidate.update({ where: { id: target.id }, data: { critiqueJson: JSON.stringify(result.value), status: check.ok ? 'GENERATED' : 'HARD_FAILED' } });
      } else {
        const failure = { status: 'FAILED', issues: [], advisories: [], error: errorText(result.reason) };
        await db.tutorCandidate.update({ where: { id: target.id }, data: { critiqueJson: JSON.stringify(failure), status: 'CRITIQUE_FAILED' } });
        critiqueFailures.push({ stage: `CRITIC_OF_${target.slot}`, error: failure.error });
      }
    }
    if (critiqueFailures.length) {
      const completedItems = 4 - critiqueFailures.length;
      await db.$transaction([
        db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { status: 'PARTIAL_FAILED', completedItems, failedItems: critiqueFailures.length, failureReason: JSON.stringify(critiqueFailures), completedAt: new Date() } }),
        db.tutorTurnCase.update({ where: { id: caseItem.id }, data: { status: 'NEEDS_CRITIC' } }),
      ]);
      await audit(input.user.id, 'TUTOR_CRITIQUE_PARTIAL_FAILED', 'BootstrapGenerationRun', run.id, { caseId: caseItem.id, failedStages: critiqueFailures });
      return { status: 'PARTIAL_FAILED' as const, runId: run.id, candidates: await db.tutorCandidate.findMany({ where: { generationRunId: run.id }, orderBy: { slot: 'asc' } }), failedStages: critiqueFailures, canRetryCritics: true };
    }
    await completeCandidateReviewFlow(caseItem.id, run.id, input.user.id);
    return { status: 'COMPLETED' as const, runId: run.id, candidates: await db.tutorCandidate.findMany({ where: { generationRunId: run.id }, orderBy: { slot: 'asc' } }), failedStages: [], canRetryCritics: false };
  } catch (error) {
    await db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { status: 'FAILED', failureReason: errorText(error), completedAt: new Date() } });
    throw error;
  }
}

export async function retryTutorCandidateCritics(
  input: { caseId: string; user: SessionUser },
  deps: Pick<CandidateGenerationDeps, 'critiqueCandidate'> = {},
) {
  const critique = deps.critiqueCandidate ?? critiqueCandidate;
  const caseItem = await db.tutorTurnCase.findUnique({ where: { id: input.caseId } });
  if (!caseItem || caseItem.status !== 'NEEDS_CRITIC') throw new Error('案例当前不需要重试 Critic');
  const run = await db.bootstrapGenerationRun.findFirst({
    where: { kind: 'CANDIDATE_GENERATION', status: 'PARTIAL_FAILED', candidates: { some: { caseId: input.caseId } } },
    orderBy: { createdAt: 'desc' }, include: { candidates: { orderBy: { slot: 'asc' } } },
  });
  if (!run || run.candidates.length !== 2) throw new Error('最新部分失败批次缺少两个完整候选，必须重新生成候选');
  const models = parseJson<{ A?: CandidateModelConfig; B?: CandidateModelConfig }>(run.modelConfigJson, {});
  if (!models.A || !models.B) throw new Error('部分失败批次缺少模型配置');
  const failedCandidates = run.candidates.filter((candidate) => parseJson<{ status?: string }>(candidate.critiqueJson, {}).status !== 'COMPLETED');
  if (!failedCandidates.length) throw new Error('没有可重试的 Critic');
  const failures: Array<{ stage: string; error: string }> = [];
  for (const candidate of failedCandidates) {
    const config = candidate.slot === 'A' ? models.B : models.A;
    const target = candidate.normalizedOutput ? parseJson<TutorLanguageResponse | null>(candidate.normalizedOutput, null) : null;
    try {
      const result: CritiquePayload = await critique({ target, targetRaw: candidate.rawOutput, caseItem, config });
      const check = parseJson<CandidateCheck>(candidate.deterministicCheckJson, { ok: false, hardErrorCount: 1, warningCount: 0, issues: [] });
      await db.tutorCandidate.update({ where: { id: candidate.id }, data: { critiqueJson: JSON.stringify(result), status: check.ok ? 'GENERATED' : 'HARD_FAILED' } });
    } catch (error) {
      const failure = { status: 'FAILED', issues: [], advisories: [], error: errorText(error) };
      await db.tutorCandidate.update({ where: { id: candidate.id }, data: { critiqueJson: JSON.stringify(failure), status: 'CRITIQUE_FAILED' } });
      failures.push({ stage: `CRITIC_OF_${candidate.slot}`, error: failure.error });
    }
  }
  if (failures.length) {
    await db.bootstrapGenerationRun.update({ where: { id: run.id }, data: { status: 'PARTIAL_FAILED', completedItems: 4 - failures.length, failedItems: failures.length, failureReason: JSON.stringify(failures), completedAt: new Date() } });
    await audit(input.user.id, 'TUTOR_CRITIQUE_RETRY_FAILED', 'BootstrapGenerationRun', run.id, { caseId: input.caseId, failures });
    return { status: 'PARTIAL_FAILED' as const, runId: run.id, candidates: await db.tutorCandidate.findMany({ where: { generationRunId: run.id }, orderBy: { slot: 'asc' } }), failedStages: failures, canRetryCritics: true };
  }
  await completeCandidateReviewFlow(input.caseId, run.id, input.user.id);
  await audit(input.user.id, 'TUTOR_CRITIQUE_RETRY_COMPLETED', 'BootstrapGenerationRun', run.id, { caseId: input.caseId });
  return { status: 'COMPLETED' as const, runId: run.id, candidates: await db.tutorCandidate.findMany({ where: { generationRunId: run.id }, orderBy: { slot: 'asc' } }), failedStages: [], canRetryCritics: false };
}

function critiqueIssues(raw: string): DeterministicIssue[] {
  const critique = parseJson<{ issues?: Array<{ quote?: unknown; category?: unknown; message?: unknown }> }>(raw, {});
  return (critique.issues ?? []).map((item, index) => ({
    id: `CRITIQUE:${index}:${sha256(`${item.quote ?? ''}:${item.message ?? ''}`).slice(0, 10)}`,
    code: `CRITIQUE_${String(item.category ?? 'REVIEW').toUpperCase()}`,
    severity: 'warning',
    message: String(item.message ?? '交叉 Critic 提醒'),
    evidence: String(item.quote ?? ''),
  }));
}

type TutorReviewWarning = DeterministicIssue & {
  candidateId: string;
  candidateSlot: string;
  source: 'DETERMINISTIC' | 'CRITIC';
};

function warningsForCandidates(candidates: Array<{ id: string; slot: string; deterministicCheckJson: string; critiqueJson: string }>): TutorReviewWarning[] {
  return candidates.flatMap((candidate) => {
    const check = parseJson<CandidateCheck>(candidate.deterministicCheckJson, { ok: false, hardErrorCount: 1, warningCount: 0, issues: [] });
    const attachSource = (item: DeterministicIssue, source: TutorReviewWarning['source']): TutorReviewWarning => ({
      ...item,
      id: `${candidate.id}:${item.id}`,
      candidateId: candidate.id,
      candidateSlot: candidate.slot,
      source,
    });
    return [
      ...check.issues.map((item) => attachSource(item, 'DETERMINISTIC')),
      ...critiqueIssues(candidate.critiqueJson).map((item) => attachSource(item, 'CRITIC')),
    ];
  });
}

async function latestPair(caseId: string) {
  const latestRun = await db.bootstrapGenerationRun.findFirst({ where: { kind: 'CANDIDATE_GENERATION', candidates: { some: { caseId } }, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' } });
  if (!latestRun) return [];
  return db.tutorCandidate.findMany({ where: { caseId, generationRunId: latestRun.id }, orderBy: { slot: 'asc' } });
}

export async function listTutorCases() {
  return db.tutorTurnCase.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      phase: true,
      triggerType: true,
      studentMessage: true,
      split: true,
      status: true,
      promptVersion: true,
      hardCheckJson: true,
      topicCard: { select: { displayTitle: true, subject: true, status: true } },
      generationRun: { select: { id: true, status: true, reviewPolicy: true, parametersJson: true, createdAt: true, completedAt: true, failureReason: true } },
      _count: { select: { candidates: true, reviewTasks: true } },
      finalizedTurn: { select: { id: true, trainingEligibility: true } },
    },
  });
}

export async function supersedeTutorCaseRun(runId: string, reason: string, user: SessionUser) {
  if (!reason.trim()) throw new Error('请填写替代此批次的原因');
  const run = await db.bootstrapGenerationRun.findUnique({
    where: { id: runId },
    include: {
      cases: {
        include: {
          finalizedTurn: { select: { id: true } },
          reviewTasks: { select: { status: true } },
          _count: { select: { candidates: true } },
        },
      },
    },
  });
  if (!run || run.kind !== 'CASE_COMPILATION') throw new Error('案例编译批次不存在');
  if (run.status === 'SUPERSEDED') return { runId, status: 'SUPERSEDED', cases: run.cases.length };
  if (run.status !== 'COMPLETED') throw new Error('只有已完成的案例编译批次可以标记为历史批次');
  if (run.cases.some((item) => item.finalizedTurn || item.reviewTasks.some((task) => task.status === 'SUBMITTED'))) {
    throw new Error('已有定稿或已提交审核记录的批次不能整体标记为已替代');
  }
  const preservedCandidates = run.cases.reduce((sum, item) => sum + item._count.candidates, 0);
  await db.$transaction([
    db.tutorTurnCase.updateMany({ where: { generationRunId: runId, status: { not: 'SUPERSEDED' } }, data: { status: 'SUPERSEDED' } }),
    db.tutorReviewTask.updateMany({ where: { case: { generationRunId: runId }, status: { in: ['PENDING', 'RETURNED', 'IN_PROGRESS'] } }, data: { status: 'SUPERSEDED', assignedToId: null, leaseExpiresAt: null } }),
    db.bootstrapGenerationRun.update({ where: { id: runId }, data: { status: 'SUPERSEDED', failureReason: reason.trim() } }),
    db.dataLabAuditLog.create({ data: {
      actorId: user.id,
      action: 'TUTOR_CASE_RUN_SUPERSEDED',
      entityType: 'BootstrapGenerationRun',
      entityId: runId,
      payloadJson: JSON.stringify({ reason: reason.trim(), cases: run.cases.length, preservedCandidates }),
    } }),
  ]);
  return { runId, status: 'SUPERSEDED', cases: run.cases.length, preservedCandidates };
}

export async function overrideBlockedCases(runId: string, reason: string, user: SessionUser) {
  if (!reason.trim()) throw new Error('请填写忽略阻断的理由');
  const run = await db.bootstrapGenerationRun.findUnique({ where: { id: runId }, include: { cases: { where: { status: 'BLOCKED' } } } });
  if (!run || run.kind !== 'CASE_COMPILATION') throw new Error('案例编译批次不存在');
  if (!run.cases.length) throw new Error('该批次没有被阻断的案例');
  await db.$transaction([
    ...run.cases.map((item) => db.tutorTurnCase.update({ where: { id: item.id }, data: { status: 'READY', hardCheckJson: JSON.stringify({ errors: [], overrideReason: reason.trim(), overriddenAt: new Date().toISOString() }) } })),
    db.dataLabAuditLog.create({ data: { actorId: user.id, action: 'TUTOR_CASES_BLOCK_OVERRIDDEN', entityType: 'BootstrapGenerationRun', entityId: runId, payloadJson: JSON.stringify({ reason: reason.trim(), count: run.cases.length, originalErrors: run.cases.map((item) => ({ id: item.id, errors: item.hardCheckJson })) }) } }),
  ]);
  return { runId, unblocked: run.cases.length };
}

export async function deleteGenerationRun(runId: string, user: SessionUser) {
  const run = await db.bootstrapGenerationRun.findUnique({
    where: { id: runId },
    include: { cases: { include: { finalizedTurn: { select: { id: true } }, _count: { select: { candidates: true, reviewTasks: true } } } } },
  });
  if (!run || run.kind !== 'CASE_COMPILATION') throw new Error('案例编译批次不存在');
  const hasData = run.cases.some((item) => item.finalizedTurn || item._count.candidates > 0 || item._count.reviewTasks > 0);
  if (hasData) throw new Error('该批次下的案例已有候选、审核记录或定稿，无法删除；请改为"标记为已替代"');
  await db.$transaction([
    db.tutorTurnCase.deleteMany({ where: { generationRunId: runId } }),
    db.bootstrapGenerationRun.delete({ where: { id: runId } }),
    db.dataLabAuditLog.create({ data: { actorId: user.id, action: 'TUTOR_CASE_RUN_DELETED', entityType: 'BootstrapGenerationRun', entityId: runId, payloadJson: JSON.stringify({ cases: run.cases.length, profile: run.parametersJson }) } }),
  ]);
  return { runId, deleted: run.cases.length };
}

export async function tutorWorkflowCounts() {
  const [latestProfileRuns, topicDrafts, approvedTopics, editPending, confirmPending, caseQualityPending, finalized] = await Promise.all([
    Promise.all((['SMOKE_6', 'CALIBRATION_12', 'TRIAL_36', 'FULL_180', 'EVAL_80'] as TutorCaseProfile[]).map((profile) => latestCaseCompilationRun(profile))),
    db.topicCard.count({ where: { status: 'DRAFT' } }),
    db.topicCard.count({ where: { status: 'APPROVED' } }),
    db.tutorReviewTask.count({ where: { type: 'EDIT', status: { in: ['PENDING', 'RETURNED'] }, case: { status: 'IN_REVIEW' } } }),
    db.tutorReviewTask.count({ where: { type: 'CONFIRM', status: 'PENDING', case: { status: 'AWAITING_CONFIRMATION' } } }),
    db.tutorReviewTask.count({ where: { type: 'CASE', status: 'PENDING', case: { status: 'CASE_NEEDS_REVISION' } } }),
    db.finalizedTutorTurn.count(),
  ]);
  const latestRunIds = latestProfileRuns.flatMap((run) => run ? [run.id] : []);
  const casesReady = await db.tutorTurnCase.count({
    where: {
      status: { in: ['READY', 'NEEDS_REGEN'] },
      OR: [
        { generationRunId: { in: latestRunIds } },
        { generationRunId: null },
        { generationRun: { kind: 'CASE_COMPILATION', status: 'COMPLETED', parametersJson: { contains: '"profile":"CUSTOM"' } } },
      ],
    },
  });
  return { topicDrafts, approvedTopics, casesReady, editPending, confirmPending, caseQualityPending, finalized };
}

export async function tutorPersonalQueueCount(user: SessionUser) {
  const now = new Date();
  if (user.role === 'annotator') {
    return db.tutorReviewTask.count({
      where: {
        type: 'EDIT',
        status: { in: ['PENDING', 'RETURNED', 'IN_PROGRESS'] },
        case: { status: 'IN_REVIEW' },
        OR: [
          { assignedToId: user.id },
          { assignedToId: null },
          { leaseExpiresAt: { lt: now } },
        ],
      },
    });
  }
  if (user.role === 'reviewer') {
    return db.tutorReviewTask.count({
      where: {
        type: 'CONFIRM',
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        case: {
          status: 'AWAITING_CONFIRMATION',
          reviewTasks: { some: { type: 'EDIT', status: 'SUBMITTED', operatorId: { not: user.id } } },
        },
        OR: [
          { assignedToId: user.id },
          { assignedToId: null },
          { leaseExpiresAt: { lt: now } },
        ],
      },
    });
  }
  return 0;
}

export async function claimTutorReviewTask(type: 'EDIT' | 'CONFIRM', user: SessionUser) {
  if (type === 'EDIT' && !['annotator', 'admin'].includes(user.role)) throw new Error('只有标注员或管理员可以进行初审');
  if (type === 'CONFIRM' && !['reviewer', 'admin'].includes(user.role)) throw new Error('只有定稿人或管理员可以进行最终确认');
  const now = new Date();
  const lease = new Date(now.getTime() + REVIEW_LEASE_MS);
  const claimed = await db.$transaction(async (tx) => {
    const task = await tx.tutorReviewTask.findFirst({
      where: {
        type,
        status: { in: type === 'EDIT' ? ['PENDING', 'RETURNED', 'IN_PROGRESS'] : ['PENDING', 'IN_PROGRESS'] },
        OR: [{ assignedToId: null }, { leaseExpiresAt: { lt: now } }, { assignedToId: user.id }],
        case: type === 'CONFIRM'
          ? { status: 'AWAITING_CONFIRMATION', reviewTasks: { some: { type: 'EDIT', status: 'SUBMITTED', OR: [{ submissionMode: 'AI_DIRECT_ADMIN_AUTHORIZED' }, { operatorId: { not: user.id } }] } } }
          : { status: 'IN_REVIEW' },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!task) return null;
    return tx.tutorReviewTask.update({ where: { id: task.id }, data: { assignedToId: user.id, leaseExpiresAt: lease, status: 'IN_PROGRESS' } });
  });
  if (!claimed) return null;
  const caseItem = await db.tutorTurnCase.findUniqueOrThrow({ where: { id: claimed.caseId }, include: { topicCard: true, reviewTasks: true, finalizedTurn: true } });
  const candidates = await latestPair(claimed.caseId);
  const editTask = caseItem.reviewTasks.find((item) => item.type === 'EDIT');
  const confirmTask = caseItem.reviewTasks.find((item) => item.type === 'CONFIRM');
  const warnings = warningsForCandidates(candidates);
  const editDraft = editTask ? parseJson<{ finalOutput?: TutorLanguageResponse }>(editTask.draftJson, {}) : {};
  const selectedCandidate = editTask?.selectedCandidateId ? candidates.find((candidate) => candidate.id === editTask.selectedCandidateId) : undefined;
  const draftCheck = editDraft.finalOutput ? checkTutorCandidate({ rawOutput: JSON.stringify(editDraft.finalOutput), allowedFocusIds: allowedFocus(caseItem), phase: caseItem.phase, triggerType: caseItem.triggerType, studentMessage: caseItem.studentMessage }).check : null;
  const reviewPolicy = await reviewPolicyForCase(caseItem);
  return {
    task: claimed,
    case: {
      id: caseItem.id, phase: caseItem.phase, triggerType: caseItem.triggerType,
      studentMessage: caseItem.studentMessage, history: parseJson(caseItem.historyJson, []),
      visibleFacts: parseJson(caseItem.visibleFactsJson, {}), privateReviewSpec: type === 'EDIT' ? parseJson(caseItem.privateReviewSpecJson, {}) : undefined,
      split: caseItem.split,
      revision: caseItem.revision,
      revisionOfId: caseItem.revisionOfId,
      reviewPolicy: reviewPolicy.policy,
    },
    candidates: candidates.map((candidate) => type === 'CONFIRM'
      ? { id: candidate.id, slot: candidate.slot, normalizedOutput: candidate.normalizedOutput, deterministicCheck: parseJson(candidate.deterministicCheckJson, {}), critique: parseJson(candidate.critiqueJson, {}) }
      : { ...candidate, deterministicCheck: parseJson(candidate.deterministicCheckJson, {}), critique: parseJson(candidate.critiqueJson, {}) }),
    firstReview: editTask && (type === 'CONFIRM' || (confirmTask?.status === 'RETURNED' && confirmTask.decision === 'RETURN_TUTOR')) ? {
      draft: editDraft,
      decision: editTask.decision,
      selectedCandidateId: editTask.selectedCandidateId,
      reason: editTask.reason,
      submissionMode: editTask.submissionMode,
      warningIds: warnings.map((item) => item.id),
      returnReason: type === 'EDIT' ? confirmTask?.reason ?? '' : '',
      reviewerProposedOutput: type === 'EDIT' ? parseJson<{ reviewerProposedOutput?: TutorLanguageResponse }>(confirmTask?.draftJson ?? '{}', {}).reviewerProposedOutput : undefined,
    } : undefined,
    warnings: warnings.map((warning) => ({
      ...warning,
      computedFinalRelation: type === 'CONFIRM' && editDraft.finalOutput && draftCheck
        ? derivedWarningRelation({ warning, selectedCandidateId: editTask?.selectedCandidateId, selectedCandidateOutput: selectedCandidate?.normalizedOutput, final: editDraft.finalOutput, finalCheck: draftCheck })
        : undefined,
    })),
  };
}

export async function renewTutorReviewLease(taskId: string, user: SessionUser) {
  const now = new Date();
  const task = await db.tutorReviewTask.findUnique({ where: { id: taskId } });
  if (!task || task.assignedToId !== user.id || task.status !== 'IN_PROGRESS') throw new Error('任务不在你的处理中队列，无法续租');
  if (!task.leaseExpiresAt || task.leaseExpiresAt <= now) throw new Error('任务租约已过期，请返回队列重新领取');
  const leaseExpiresAt = new Date(now.getTime() + REVIEW_LEASE_MS);
  const renewed = await db.tutorReviewTask.update({ where: { id: task.id }, data: { leaseExpiresAt } });
  await audit(user.id, 'TUTOR_REVIEW_LEASE_RENEWED', 'TutorReviewTask', task.id, { previousLeaseExpiresAt: task.leaseExpiresAt, leaseExpiresAt });
  return { taskId: renewed.id, leaseExpiresAt: renewed.leaseExpiresAt };
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return prev[b.length];
}

export function computeEditMetrics(original: string, final: string) {
  const distance = editDistance(original, final);
  const ratio = distance / Math.max(1, original.length, final.length);
  return { distance, ratio, type: ratio === 0 ? 'NO_CHANGE' : ratio <= 0.15 ? 'LIGHT_EDIT' : 'MATERIAL_CORRECTION' };
}

function parseFinalOutput(raw: string, focuses: string[]): TutorLanguageResponse {
  const parsed = parseTutorLanguageResponse(raw, focuses);
  if (!parsed) throw new Error('导师回复结构不完整，或所选教学焦点不适用于当前案例');
  return parsed;
}

export async function submitEditReview(input: {
  taskId: string;
  decision: 'SELECT_A' | 'SELECT_B' | 'MERGE' | 'EDIT' | 'RETURN_CASE' | 'REGENERATE' | 'REGRESSION' | 'NEGATIVE' | 'REJECT';
  selectedCandidateId?: string;
  finalOutput?: string;
  reason: string;
  preferenceRejectedCandidateId?: string;
  preferenceReason?: string;
  submissionMode?: TutorDraftProvenance;
  caseIssue?: unknown;
  user: SessionUser;
}) {
  if (!input.reason.trim()) throw new Error('导师草稿初审必须填写决定理由');
  const task = await db.tutorReviewTask.findUnique({ where: { id: input.taskId }, include: { case: true } });
  if (!task || task.type !== 'EDIT' || task.assignedToId !== input.user.id || task.status !== 'IN_PROGRESS') throw new Error('任务不存在、租约失效或无权提交');
  if (task.leaseExpiresAt && task.leaseExpiresAt < new Date()) throw new Error('任务租约已过期');

  const submissionMode = input.submissionMode ?? 'HUMAN';
  if (!TUTOR_DRAFT_PROVENANCES.includes(submissionMode)) throw new Error('草稿来源无效');
  const reviewPolicy = await reviewPolicyForCase(task.case);
  let authorizedById: string | null = null;
  if (submissionMode === 'AI_DIRECT_ADMIN_AUTHORIZED') {
    if (input.user.role !== 'admin') throw new Error('只有管理员可以提交 AI 直送草稿');
    if (reviewPolicy.policy !== 'AI_DIRECT_TO_REVIEWER' || !reviewPolicy.authorizedById) throw new Error('当前批次没有明确授权 AI 初审后直送定稿人');
    if (!/AI[_ -]?ASSISTED/i.test(input.reason)) throw new Error('AI 直送必须在理由中明确说明使用了 AI 辅助');
    authorizedById = reviewPolicy.authorizedById;
  }

  const taskAuditData = { submissionMode, authorizedById, reviewPolicy: reviewPolicy.policy };
  if (input.decision === 'RETURN_CASE') {
    const caseIssue = normalizeCaseIssue(input.caseIssue, input.reason);
    await db.$transaction(async (tx) => {
      await tx.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'RETURNED', operatorId: input.user.id, decision: 'RETURN_CASE', reason: input.reason.trim(), caseIssueJson: JSON.stringify(caseIssue), submissionMode, authorizedById, submittedAt: new Date(), leaseExpiresAt: null } });
      await tx.tutorReviewTask.upsert({ where: { caseId_type: { caseId: task.caseId, type: 'CASE' } }, create: { caseId: task.caseId, type: 'CASE', status: 'PENDING', reason: input.reason.trim(), caseIssueJson: JSON.stringify(caseIssue) }, update: { status: 'PENDING', assignedToId: null, leaseExpiresAt: null, operatorId: null, decision: '', reason: input.reason.trim(), caseIssueJson: JSON.stringify(caseIssue), submittedAt: null } });
      await tx.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: 'CASE_NEEDS_REVISION' } });
    });
    await audit(input.user.id, 'TUTOR_CASE_QUALITY_RETURNED_BY_ANNOTATOR', 'TutorReviewTask', task.id, caseIssue);
    return { status: 'CASE_NEEDS_REVISION' };
  }
  if (input.decision === 'REGENERATE') {
    await db.$transaction([
      db.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'REGEN_REQUESTED', operatorId: input.user.id, decision: input.decision, reason: input.reason.trim(), submissionMode, authorizedById, submittedAt: new Date(), leaseExpiresAt: null } }),
      db.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: 'NEEDS_REGEN' } }),
    ]);
    await audit(input.user.id, 'TUTOR_EDIT_REGENERATE', 'TutorReviewTask', task.id, { reason: input.reason, ...taskAuditData });
    return { status: 'REGEN_REQUESTED' };
  }
  if (['REGRESSION', 'NEGATIVE', 'REJECT'].includes(input.decision)) {
    await db.$transaction([
      db.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'SUBMITTED', operatorId: input.user.id, decision: input.decision, reason: input.reason.trim(), submissionMode, authorizedById, submittedAt: new Date(), leaseExpiresAt: null } }),
      db.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: input.decision } }),
    ]);
    await audit(input.user.id, `TUTOR_EDIT_${input.decision}`, 'TutorReviewTask', task.id, { reason: input.reason, ...taskAuditData });
    return { status: input.decision };
  }

  const candidates = await latestPair(task.caseId);
  if (candidates.length !== 2) throw new Error('缺少最新 A/B 候选');
  const selected = input.selectedCandidateId ? candidates.find((item) => item.id === input.selectedCandidateId) : undefined;
  if (!selected && ['SELECT_A', 'SELECT_B'].includes(input.decision)) throw new Error('采用候选时必须先选择一份候选稿');
  if (input.decision === 'SELECT_A' && selected?.slot !== 'A') throw new Error('采用候选 A 时必须选择候选 A');
  if (input.decision === 'SELECT_B' && selected?.slot !== 'B') throw new Error('采用候选 B 时必须选择候选 B');
  const finalRaw = input.finalOutput?.trim() || selected?.normalizedOutput || '';
  const focuses = allowedFocus(task.case);
  const final = parseFinalOutput(finalRaw, focuses);
  const finalCheck = checkTutorCandidate({ rawOutput: JSON.stringify(final), allowedFocusIds: focuses, phase: task.case.phase, triggerType: task.case.triggerType, studentMessage: task.case.studentMessage });
  if (!finalCheck.check.ok) throw new Error(`最终草稿存在硬错误：${finalCheck.check.issues.filter((item) => item.severity === 'error').map((item) => item.message).join('；')}`);
  const original = selected?.normalizedOutput || '';
  const metrics = computeEditMetrics(original, JSON.stringify(final));
  const rejected = input.preferenceRejectedCandidateId ? candidates.find((item) => item.id === input.preferenceRejectedCandidateId) : undefined;
  if (rejected && rejected.id === selected?.id) throw new Error('偏好对中的采用稿和未采用稿不能相同');
  if (rejected) {
    const rejectedCheck = parseJson<CandidateCheck>(rejected.deterministicCheckJson, { ok: false, hardErrorCount: 1, warningCount: 0, issues: [] });
    if (rejectedCheck.hardErrorCount > 0 || !rejected.normalizedOutput) throw new Error('存在硬错误或缺少规范输出的候选不能作为偏好对中的未采用稿');
  }
  if (rejected && !input.preferenceReason?.trim()) throw new Error('创建偏好对时，必须填写采用稿优于未采用稿的明确理由');
  const candidateWarnings = warningsForCandidates(candidates);
  const draft = { finalOutput: final, editMetrics: metrics, finalCheck: finalCheck.check, warningIds: candidateWarnings.map((item) => item.id), provenance: submissionMode };
  await db.$transaction(async (tx) => {
    await tx.tutorReviewTask.update({ where: { id: task.id }, data: {
      status: 'SUBMITTED', operatorId: input.user.id, decision: input.decision,
      selectedCandidateId: selected?.id, preferenceRejectedCandidateId: rejected?.id,
      draftJson: JSON.stringify(draft), reason: input.reason.trim(), preferenceReason: input.preferenceReason?.trim() ?? '',
      submissionMode, authorizedById, caseIssueJson: '{}', submittedAt: new Date(), leaseExpiresAt: null,
    } });
    await tx.tutorReviewTask.upsert({
      where: { caseId_type: { caseId: task.caseId, type: 'CONFIRM' } },
      create: { caseId: task.caseId, type: 'CONFIRM', status: 'PENDING' },
      update: { status: 'PENDING', assignedToId: null, leaseExpiresAt: null, operatorId: null, decision: '', draftJson: '{}', reason: '', warningClosureJson: '{}', caseIssueJson: '{}', submittedAt: null },
    });
    await tx.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: 'AWAITING_CONFIRMATION' } });
  });
  await audit(input.user.id, 'TUTOR_EDIT_SUBMITTED', 'TutorReviewTask', task.id, { decision: input.decision, selectedCandidateId: selected?.id, preferenceRejectedCandidateId: rejected?.id, editType: metrics.type, ...taskAuditData });
  return { status: 'AWAITING_CONFIRMATION', editMetrics: metrics, submissionMode };
}


export async function generateAiAssistedTutorDraft(input: { caseId: string; provider?: string; model?: string; user: SessionUser }, deps: { complete?: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<LLMCompletion> } = {}) {
  if (input.user.role !== 'admin') throw new Error('只有管理员可以启动 AI 辅助导师初审');
  const caseItem = await db.tutorTurnCase.findUnique({ where: { id: input.caseId }, include: { reviewTasks: true } });
  if (!caseItem || caseItem.status !== 'IN_REVIEW') throw new Error('案例当前不在导师初审状态');
  const policy = await reviewPolicyForCase(caseItem);
  if (policy.policy !== 'AI_DIRECT_TO_REVIEWER' || !policy.authorizedById) throw new Error('当前批次没有明确授权 AI 初审后直送定稿人');
  const task = caseItem.reviewTasks.find((item) => item.type === 'EDIT');
  if (!task || !['PENDING', 'RETURNED', 'IN_PROGRESS'].includes(task.status)) throw new Error('案例没有可用的导师初审任务');
  if (task.status === 'IN_PROGRESS' && task.assignedToId && task.assignedToId !== input.user.id && task.leaseExpiresAt && task.leaseExpiresAt > new Date()) throw new Error('该案例正在由其他标注员处理');
  const candidates = await latestPair(caseItem.id);
  if (candidates.length !== 2) throw new Error('缺少最新 A/B 候选');
  const lease = new Date(Date.now() + REVIEW_LEASE_MS);
  await db.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'IN_PROGRESS', assignedToId: input.user.id, leaseExpiresAt: lease } });
  const providerName = input.provider ?? process.env.DATA_LAB_AI_CURATOR_PROVIDER ?? process.env.LLM_PROVIDER ?? 'deepseek';
  const model = input.model ?? process.env.DATA_LAB_AI_CURATOR_MODEL ?? process.env.LLM_MODEL ?? (providerName === 'deepseek' ? 'deepseek-v4-pro' : 'gpt-4o');
  try {
    const llm = createLLMProvider({ provider: providerName, model, role: 'EVALUATOR' });
    const system = `你是 Tutor 数据草稿整理助手。比较候选 A/B，并生成一个供正式 Human Reviewer 审核的建议稿。你不是最终审核人。
只依据学生消息、visibleFacts、privateReviewSpec、候选原文和检查结果判断。最终输出必须符合 tutor-language-v1，不得添加事实或服务器产物。
只输出 JSON：{"selectedSlot":"A|B","finalOutput":{"dialogue":"...","interactionType":"open_question|clarification|explanation|checkpoint|information","focus":"allowed focus id","hints":[]},"reason":"具体比较理由","preferenceRejectedSlot":"A|B|null","preferenceReason":"若创建 preference，说明 chosen 为什么明确优于 rejected，否则空字符串"}。`;
    const curatorMessages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: JSON.stringify({
        phase: caseItem.phase,
        triggerType: caseItem.triggerType,
        studentMessage: caseItem.studentMessage,
        visibleFacts: parseJson(caseItem.visibleFactsJson, {}),
        privateReviewSpec: parseJson(caseItem.privateReviewSpecJson, {}),
        candidates: candidates.map((candidate) => ({ slot: candidate.slot, output: parseJson(candidate.normalizedOutput, candidate.rawOutput), deterministicCheck: parseJson(candidate.deterministicCheckJson, {}), critique: parseJson(candidate.critiqueJson, {}) })),
      }) },
    ];
    const completion = deps.complete ? await deps.complete(curatorMessages) : await llm.complete(curatorMessages, { useJsonFormat: true, maxTokens: 1800 });
    const parsed = objectFromRaw(completion.content);
    const selectedSlot = parsed?.selectedSlot === 'A' || parsed?.selectedSlot === 'B' ? parsed.selectedSlot : null;
    if (!selectedSlot) throw new Error('AI 初审没有返回有效 selectedSlot');
    const selected = candidates.find((candidate) => candidate.slot === selectedSlot)!;
    const finalRaw = JSON.stringify(parsed?.finalOutput ?? {});
    const final = parseFinalOutput(finalRaw, allowedFocus(caseItem));
    const exactSelected = selected.normalizedOutput === JSON.stringify(final);
    const rejectedSlot = parsed?.preferenceRejectedSlot === 'A' || parsed?.preferenceRejectedSlot === 'B' ? parsed.preferenceRejectedSlot : null;
    const rejected = rejectedSlot && rejectedSlot !== selectedSlot ? candidates.find((candidate) => candidate.slot === rejectedSlot) : undefined;
    const preferenceReason = typeof parsed?.preferenceReason === 'string' ? parsed.preferenceReason.trim() : '';
    const reason = typeof parsed?.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : `选择候选 ${selectedSlot} 作为建议稿基底。`;
    const result = await submitEditReview({
      taskId: task.id,
      decision: exactSelected ? selectedSlot === 'A' ? 'SELECT_A' : 'SELECT_B' : 'EDIT',
      selectedCandidateId: selected.id,
      finalOutput: JSON.stringify(final),
      reason: `AI_ASSISTED_DRAFT：管理员授权平台 AI Curator（${providerName}/${model}）完成 Tutor 初审并直送 Reviewer。\n${reason}`,
      preferenceRejectedCandidateId: rejected && preferenceReason ? rejected.id : undefined,
      preferenceReason: rejected && preferenceReason ? preferenceReason : undefined,
      submissionMode: 'AI_DIRECT_ADMIN_AUTHORIZED',
      user: input.user,
    });
    await audit(input.user.id, 'TUTOR_AI_DRAFT_PREPARED', 'TutorTurnCase', caseItem.id, { provider: providerName, model, selectedSlot, editType: result.editMetrics?.type, usage: completion.usage });
    return { ...result, provider: providerName, model, selectedSlot };
  } catch (error) {
    await db.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'PENDING', assignedToId: null, leaseExpiresAt: null } });
    await audit(input.user.id, 'TUTOR_AI_DRAFT_FAILED', 'TutorTurnCase', caseItem.id, { error: error instanceof Error ? error.message : String(error), provider: providerName, model });
    throw error;
  }
}

export function characterShingles(value: string, size = 3): Set<string> {
  const compact = value.replace(/\s+/g, '');
  const set = new Set<string>();
  for (let index = 0; index <= compact.length - size; index += 1) set.add(compact.slice(index, index + size));
  return set;
}

export function shingleJaccard(a: string, b: string): number {
  const left = characterShingles(a);
  const right = characterShingles(b);
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function warningText(final: TutorLanguageResponse) {
  return `${final.dialogue}\n${final.hints.join('\n')}`;
}

function derivedWarningRelation(input: {
  warning: TutorReviewWarning;
  selectedCandidateId?: string | null;
  selectedCandidateOutput?: string;
  final: TutorLanguageResponse;
  finalCheck: ReturnType<typeof checkTutorCandidate>['check'];
}): TutorWarningFinalRelation {
  if (input.selectedCandidateId && input.warning.candidateId !== input.selectedCandidateId) return 'ONLY_UNSELECTED_CANDIDATE';
  const finalJson = JSON.stringify(input.final);
  if (input.selectedCandidateOutput && input.selectedCandidateOutput === finalJson) return 'PRESENT_IN_FINAL';
  if (input.warning.source === 'DETERMINISTIC' && input.finalCheck.issues.some((issue) => issue.code === input.warning.code)) return 'PRESENT_IN_FINAL';
  if (input.warning.evidence?.trim() && warningText(input.final).includes(input.warning.evidence.trim())) return 'PRESENT_IN_FINAL';
  return 'REMOVED_BY_EDIT';
}

function rawWarningObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeWarningAssessments(input: {
  raw: unknown;
  warnings: TutorReviewWarning[];
  selectedCandidateId?: string | null;
  selectedCandidateOutput?: string;
  final: TutorLanguageResponse;
  finalCheck: ReturnType<typeof checkTutorCandidate>['check'];
  requireComplete: boolean;
}) {
  const rawMap = rawWarningObject(input.raw);
  const normalized: TutorWarningClosureMap = {};
  const missing: string[] = [];
  for (const warning of input.warnings) {
    const raw = rawWarningObject(rawMap[warning.id]);
    const relation = derivedWarningRelation({
      warning,
      selectedCandidateId: input.selectedCandidateId,
      selectedCandidateOutput: input.selectedCandidateOutput,
      final: input.final,
      finalCheck: input.finalCheck,
    });
    let detectorVerdict = raw.detectorVerdict as TutorWarningDetectorVerdict | undefined;
    if (!detectorVerdict && typeof raw.validity === 'string') {
      detectorVerdict = raw.validity === 'VALID' ? 'CORRECT' : raw.validity === 'PARTIALLY_VALID' ? 'PARTIAL' : raw.validity === 'FALSE_POSITIVE' ? 'FALSE_POSITIVE' : undefined;
    }
    if (!detectorVerdict || !['CORRECT', 'PARTIAL', 'MISCLASSIFIED', 'FALSE_POSITIVE'].includes(detectorVerdict)) {
      if (input.requireComplete) missing.push(warning.id);
      continue;
    }
    const correctedCategory = typeof raw.correctedCategory === 'string' ? raw.correctedCategory.trim().slice(0, 120) : '';
    const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 1000) : '';
    const legacySeverity = typeof raw.severity === 'string' ? raw.severity : undefined;
    const finalSeverity = typeof raw.finalSeverity === 'string' ? raw.finalSeverity : relation === 'PRESENT_IN_FINAL' ? legacySeverity : undefined;
    const candidateSeverity = typeof raw.candidateSeverity === 'string' ? raw.candidateSeverity : relation !== 'PRESENT_IN_FINAL' ? legacySeverity : undefined;
    if (detectorVerdict === 'MISCLASSIFIED' && !correctedCategory) {
      if (input.requireComplete) missing.push(warning.id);
      continue;
    }
    if (relation === 'PRESENT_IN_FINAL' && detectorVerdict !== 'FALSE_POSITIVE' && !TUTOR_WARNING_SEVERITIES.includes(finalSeverity as TutorWarningSeverity)) {
      if (input.requireComplete) missing.push(warning.id);
      continue;
    }
    normalized[warning.id] = {
      detectorVerdict,
      finalRelation: relation,
      ...(correctedCategory ? { correctedCategory } : {}),
      ...(TUTOR_WARNING_SEVERITIES.includes(finalSeverity as TutorWarningSeverity) ? { finalSeverity: finalSeverity as TutorWarningSeverity } : {}),
      ...(TUTOR_WARNING_SEVERITIES.includes(candidateSeverity as TutorWarningSeverity) ? { candidateSeverity: candidateSeverity as TutorWarningSeverity } : {}),
      ...(note ? { note } : {}),
    };
  }
  return { closures: sanitizeTutorWarningClosures(normalized), missing };
}


export async function previewTutorConfirmFinal(input: { taskId: string; finalOutput: string; user: SessionUser }) {
  const task = await db.tutorReviewTask.findUnique({ where: { id: input.taskId }, include: { case: { include: { reviewTasks: true } } } });
  if (!task || task.type !== 'CONFIRM' || task.assignedToId !== input.user.id || task.status !== 'IN_PROGRESS') throw new Error('人工审核任务不存在、租约失效或无权预检');
  const edit = task.case.reviewTasks.find((item) => item.type === 'EDIT' && item.status === 'SUBMITTED');
  if (!edit) throw new Error('导师草稿初审尚未完成');
  const candidates = await latestPair(task.caseId);
  const selectedCandidate = edit.selectedCandidateId ? candidates.find((candidate) => candidate.id === edit.selectedCandidateId) : undefined;
  const final = parseFinalOutput(input.finalOutput, allowedFocus(task.case));
  const finalCheck = checkTutorCandidate({ rawOutput: JSON.stringify(final), allowedFocusIds: allowedFocus(task.case), phase: task.case.phase, triggerType: task.case.triggerType, studentMessage: task.case.studentMessage });
  const relations = Object.fromEntries(warningsForCandidates(candidates).map((warning) => [warning.id, derivedWarningRelation({ warning, selectedCandidateId: edit.selectedCandidateId, selectedCandidateOutput: selectedCandidate?.normalizedOutput, final, finalCheck: finalCheck.check })]));
  return { final, finalCheck: finalCheck.check, relations };
}

async function finalizeEligibility(input: {
  caseItem: Awaited<ReturnType<typeof db.tutorTurnCase.findUniqueOrThrow>>;
  candidates: Awaited<ReturnType<typeof latestPair>>;
  final: TutorLanguageResponse;
  draftPreparedById: string;
  humanReviewerId: string;
  draftProvenance: TutorDraftProvenance;
  draftAuthorizedById?: string | null;
  closures: TutorWarningClosureMap;
  warningIds: string[];
  selectedCandidateId?: string | null;
}) {
  const reasons: string[] = [];
  const reviewPolicy = await reviewPolicyForCase(input.caseItem);
  if (input.caseItem.contractVersion !== TUTOR_LANGUAGE_CONTRACT_VERSION) reasons.push('CONTRACT_VERSION_STALE');
  if (!TUTOR_LANGUAGE_PROMPT_VERSIONS.includes(input.caseItem.promptVersion as TutorLanguagePromptVersion)) reasons.push('PROMPT_VERSION_UNSUPPORTED');
  if (input.caseItem.extractorVersion !== EXTRACTOR_VERSION) reasons.push('EXTRACTOR_VERSION_STALE');
  if (input.caseItem.split === 'EVAL') reasons.push('EVAL_SPLIT_BLOCKED');
  if (input.draftProvenance !== 'AI_DIRECT_ADMIN_AUTHORIZED' && input.draftPreparedById === input.humanReviewerId) reasons.push('DRAFT_AND_FINAL_SAME_HUMAN');
  if (reviewPolicy.policy === 'HUMAN_ANNOTATOR_REQUIRED' && input.draftProvenance === 'AI_DIRECT_ADMIN_AUTHORIZED') reasons.push('HUMAN_ANNOTATOR_REQUIRED');
  if (input.draftProvenance === 'AI_DIRECT_ADMIN_AUTHORIZED' && (!reviewPolicy.authorizedById || input.draftAuthorizedById !== reviewPolicy.authorizedById)) reasons.push('AI_DIRECT_NOT_AUTHORIZED');
  if (input.candidates.length !== 2 || input.candidates[0]?.modelFamily === input.candidates[1]?.modelFamily) reasons.push('MODEL_FAMILIES_NOT_INDEPENDENT');
  if (input.warningIds.some((id) => !isTutorWarningClosed(input.closures[id]))) reasons.push('WARNINGS_NOT_CLOSED');
  const selectedCandidate = input.selectedCandidateId ? input.candidates.find((candidate) => candidate.id === input.selectedCandidateId) : null;
  if (selectedCandidate) {
    const selectedCheck = parseJson<CandidateCheck>(selectedCandidate.deterministicCheckJson, { ok: false, hardErrorCount: 1, warningCount: 0, issues: [] });
    if (selectedCheck.hardErrorCount > 0) reasons.push('SELECTED_CANDIDATE_HARD_ERRORS');
  }
  const topic = input.caseItem.topicCardId ? await db.topicCard.findUnique({ where: { id: input.caseItem.topicCardId } }) : null;
  if (input.caseItem.dataSource !== 'PRODUCTION_TRACE' && topic?.status !== 'APPROVED') reasons.push('TOPIC_CARD_NOT_APPROVED');
  const text = JSON.stringify(input.final);
  if (/internalArchetype|privateReviewSpec|result_[a-z]|level_\d+_result|高概念降级型-火星基地植物/.test(text)) reasons.push('INTERNAL_LABEL_OR_SCHEMA_LEAK');
  const hash = sha256(text);
  const existing = await db.finalizedTutorTurn.findMany({ where: { contentSha256: { not: hash }, trainingEligibility: 'SFT_ALLOWED' }, select: { finalOutputJson: true } });
  if (await db.finalizedTutorTurn.count({ where: { contentSha256: hash } }) > 0) reasons.push('EXACT_DUPLICATE');
  if (existing.some((item) => shingleJaccard(text, item.finalOutputJson) >= 0.82)) reasons.push('NEAR_DUPLICATE');
  if (input.caseItem.split === 'PILOT') {
    return { eligibility: 'MONITORING_ONLY', reasons: [...reasons, 'PILOT_CALIBRATION_ONLY'], contentSha256: hash };
  }
  return { eligibility: reasons.length ? 'BLOCKED' : 'SFT_ALLOWED', reasons, contentSha256: hash };
}

function normalizeCaseIssue(value: unknown, fallbackNote: string) {
  const raw = rawWarningObject(value);
  const categories = Array.isArray(raw.categories)
    ? raw.categories.filter((item): item is string => typeof item === 'string' && TUTOR_CASE_ISSUE_CATEGORIES.includes(item as TutorCaseIssueCategory))
    : [];
  const suggestedStudentMessage = typeof raw.suggestedStudentMessage === 'string' ? raw.suggestedStudentMessage.trim().slice(0, 4000) : '';
  const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 2000) : fallbackNote.trim().slice(0, 2000);
  if (!categories.length) throw new Error('提交案例质量问题时至少选择一个问题类别');
  return { categories, ...(suggestedStudentMessage ? { suggestedStudentMessage } : {}), note };
}

export async function submitConfirmReview(input: {
  taskId: string;
  decision: 'CONFIRM' | 'CONFIRM_WITH_EDIT' | 'RETURN_TUTOR' | 'RETURN_CASE' | 'RETURN' | 'REJECT';
  reason: string;
  warningClosures: unknown;
  finalOutput?: string;
  caseIssue?: unknown;
  user: SessionUser;
}) {
  const task = await db.tutorReviewTask.findUnique({ where: { id: input.taskId }, include: { case: { include: { reviewTasks: true } } } });
  if (!task || task.type !== 'CONFIRM' || task.assignedToId !== input.user.id || task.status !== 'IN_PROGRESS') throw new Error('人工审核任务不存在、租约失效或无权提交');
  if (task.leaseExpiresAt && task.leaseExpiresAt < new Date()) throw new Error('任务租约已过期');
  const edit = task.case.reviewTasks.find((item) => item.type === 'EDIT' && item.status === 'SUBMITTED');
  if (!edit?.operatorId) throw new Error('导师草稿初审尚未完成');
  if (edit.submissionMode !== 'AI_DIRECT_ADMIN_AUTHORIZED' && edit.operatorId === input.user.id) throw new Error('不能批准自己提交的导师草稿');
  if (!input.reason.trim()) throw new Error('人工审核必须填写决定理由');

  const draft = parseJson<{ finalOutput?: TutorLanguageResponse; editMetrics?: unknown }>(edit.draftJson, {});
  if (!draft.finalOutput) throw new Error('导师初审草稿缺少完整输出');
  const candidates = await latestPair(task.caseId);
  const warnings = warningsForCandidates(candidates);
  const selectedCandidate = edit.selectedCandidateId ? candidates.find((candidate) => candidate.id === edit.selectedCandidateId) : undefined;
  const finalRaw = input.finalOutput?.trim() || JSON.stringify(draft.finalOutput);
  const final = parseFinalOutput(finalRaw, allowedFocus(task.case));
  const finalCheck = checkTutorCandidate({ rawOutput: JSON.stringify(final), allowedFocusIds: allowedFocus(task.case), phase: task.case.phase, triggerType: task.case.triggerType, studentMessage: task.case.studentMessage });
  if (!finalCheck.check.ok) throw new Error(`定稿内容存在硬错误：${finalCheck.check.issues.filter((item) => item.severity === 'error').map((item) => item.message).join('；')}`);
  const normalizedWarnings = normalizeWarningAssessments({ raw: input.warningClosures, warnings, selectedCandidateId: edit.selectedCandidateId, selectedCandidateOutput: selectedCandidate?.normalizedOutput, final, finalCheck: finalCheck.check, requireComplete: false });

  const tutorReturn = input.decision === 'RETURN' || input.decision === 'RETURN_TUTOR';
  if (tutorReturn) {
    await db.$transaction([
      db.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'RETURNED', operatorId: input.user.id, decision: 'RETURN_TUTOR', reason: input.reason.trim(), warningClosureJson: JSON.stringify(normalizedWarnings.closures), draftJson: JSON.stringify({ reviewerProposedOutput: final }), submittedAt: new Date(), leaseExpiresAt: null } }),
      db.tutorReviewTask.update({ where: { id: edit.id }, data: { status: 'RETURNED', assignedToId: edit.operatorId, leaseExpiresAt: null } }),
      db.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: 'IN_REVIEW' } }),
    ]);
    await audit(input.user.id, 'TUTOR_REVIEW_RETURNED_TO_ANNOTATOR', 'TutorReviewTask', task.id, { reason: input.reason });
    return { status: 'RETURNED_TO_ANNOTATOR' };
  }

  if (input.decision === 'RETURN_CASE') {
    const caseIssue = normalizeCaseIssue(input.caseIssue, input.reason);
    await db.$transaction(async (tx) => {
      await tx.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'RETURNED', operatorId: input.user.id, decision: 'RETURN_CASE', reason: input.reason.trim(), warningClosureJson: JSON.stringify(normalizedWarnings.closures), caseIssueJson: JSON.stringify(caseIssue), draftJson: JSON.stringify({ reviewerProposedOutput: final }), submittedAt: new Date(), leaseExpiresAt: null } });
      await tx.tutorReviewTask.upsert({
        where: { caseId_type: { caseId: task.caseId, type: 'CASE' } },
        create: { caseId: task.caseId, type: 'CASE', status: 'PENDING', reason: input.reason.trim(), caseIssueJson: JSON.stringify(caseIssue) },
        update: { status: 'PENDING', assignedToId: null, leaseExpiresAt: null, operatorId: null, decision: '', reason: input.reason.trim(), caseIssueJson: JSON.stringify(caseIssue), submittedAt: null },
      });
      await tx.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: 'CASE_NEEDS_REVISION' } });
    });
    await audit(input.user.id, 'TUTOR_CASE_QUALITY_RETURNED', 'TutorReviewTask', task.id, caseIssue);
    return { status: 'CASE_NEEDS_REVISION' };
  }

  if (input.decision === 'REJECT') {
    await db.$transaction([
      db.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'SUBMITTED', operatorId: input.user.id, decision: 'REJECT', reason: input.reason.trim(), warningClosureJson: JSON.stringify(normalizedWarnings.closures), submittedAt: new Date(), leaseExpiresAt: null } }),
      db.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: 'REJECTED' } }),
    ]);
    await audit(input.user.id, 'TUTOR_REVIEW_REJECTED', 'TutorReviewTask', task.id, { reason: input.reason });
    return { status: 'REJECTED' };
  }

  const completedWarnings = normalizeWarningAssessments({ raw: input.warningClosures, warnings, selectedCandidateId: edit.selectedCandidateId, selectedCandidateOutput: selectedCandidate?.normalizedOutput, final, finalCheck: finalCheck.check, requireComplete: true });
  if (completedWarnings.missing.length) {
    const positions = completedWarnings.missing.map((id) => warnings.findIndex((warning) => warning.id === id) + 1).filter((index) => index > 0);
    throw new Error(`请先完成第 ${positions.join('、')} 条自动检测信号的人工判断`);
  }
  const warningIds = warnings.map((warning) => warning.id);
  const blocking = warningIds.filter((id) => tutorWarningBlocksFinal(completedWarnings.closures[id]));
  if (blocking.length) {
    const positions = blocking.map((id) => warnings.findIndex((warning) => warning.id === id) + 1).filter((index) => index > 0);
    throw new Error(`最终草稿仍包含被判定为严重的问题，不能通过（第 ${positions.join('、')} 条信号）`);
  }

  const reviewerMetrics = computeEditMetrics(JSON.stringify(draft.finalOutput), JSON.stringify(final));
  const actualDecision = reviewerMetrics.type === 'NO_CHANGE' ? 'CONFIRM' : 'CONFIRM_WITH_EDIT';
  const draftProvenance = TUTOR_DRAFT_PROVENANCES.includes(edit.submissionMode as TutorDraftProvenance) ? edit.submissionMode as TutorDraftProvenance : 'HUMAN';
  const eligibility = await finalizeEligibility({
    caseItem: task.case,
    candidates,
    final,
    draftPreparedById: edit.operatorId,
    humanReviewerId: input.user.id,
    draftProvenance,
    draftAuthorizedById: edit.authorizedById,
    closures: completedWarnings.closures,
    warningIds,
    selectedCandidateId: edit.selectedCandidateId,
  });
  const finalized = await db.$transaction(async (tx) => {
    const created = await tx.finalizedTutorTurn.create({ data: {
      caseId: task.caseId,
      finalOutputJson: JSON.stringify(final),
      selectedCandidateId: edit.selectedCandidateId,
      preferenceRejectedCandidateId: edit.preferenceRejectedCandidateId,
      editMetricsJson: JSON.stringify(draft.editMetrics ?? {}),
      reviewerEditMetricsJson: JSON.stringify(reviewerMetrics),
      draftProvenance,
      draftPreparedById: edit.operatorId,
      humanReviewerId: input.user.id,
      firstReviewerId: edit.operatorId!,
      secondReviewerId: input.user.id,
      warningClosureJson: JSON.stringify(completedWarnings.closures),
      preferenceReason: edit.preferenceReason,
      trainingEligibility: eligibility.eligibility,
      eligibilityReasonJson: JSON.stringify(eligibility.reasons),
      contentSha256: eligibility.contentSha256,
    } });
    await tx.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'SUBMITTED', operatorId: input.user.id, decision: actualDecision, reason: input.reason.trim(), warningClosureJson: JSON.stringify(completedWarnings.closures), draftJson: JSON.stringify({ finalOutput: final, reviewerEditMetrics: reviewerMetrics }), caseIssueJson: '{}', submittedAt: new Date(), leaseExpiresAt: null } });
    await tx.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: 'FINALIZED' } });
    return created;
  });
  await audit(input.user.id, 'TUTOR_TURN_FINALIZED', 'FinalizedTutorTurn', finalized.id, { eligibility: eligibility.eligibility, reasons: eligibility.reasons, warningClosures: completedWarnings.closures, reviewerEditMetrics: reviewerMetrics, draftProvenance });
  return { status: 'FINALIZED', finalized, reviewerEditMetrics: reviewerMetrics, decision: actualDecision };
}


export async function listTutorCaseQualityTasks() {
  return db.tutorReviewTask.findMany({
    where: { type: 'CASE', status: 'PENDING', case: { status: 'CASE_NEEDS_REVISION' } },
    orderBy: { createdAt: 'asc' },
    include: {
      case: { include: { topicCard: { select: { displayTitle: true, subject: true } }, generationRun: { select: { reviewPolicy: true } } } },
    },
  });
}

export async function resolveTutorCaseQualityTask(input: {
  taskId: string;
  decision: 'APPROVE_REVISION' | 'KEEP_CASE' | 'REJECT_CASE';
  studentMessage?: string;
  visibleFacts?: unknown;
  reason: string;
  user: SessionUser;
}) {
  if (input.user.role !== 'admin') throw new Error('只有管理员可以处理学生案例质量任务');
  if (!input.reason.trim()) throw new Error('案例处理必须填写管理员理由');
  const task = await db.tutorReviewTask.findUnique({ where: { id: input.taskId }, include: { case: { include: { reviewTasks: true } } } });
  if (!task || task.type !== 'CASE' || task.status !== 'PENDING' || task.case.status !== 'CASE_NEEDS_REVISION') throw new Error('案例质量任务不存在或状态已变化');

  if (input.decision === 'KEEP_CASE') {
    const confirm = task.case.reviewTasks.find((item) => item.type === 'CONFIRM');
    const edit = task.case.reviewTasks.find((item) => item.type === 'EDIT');
    if (!edit) throw new Error('案例缺少导师初审任务');
    await db.$transaction(async (tx) => {
      await tx.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'SUBMITTED', operatorId: input.user.id, decision: 'KEEP_CASE', reason: input.reason.trim(), submittedAt: new Date() } });
      if (confirm) await tx.tutorReviewTask.update({ where: { id: confirm.id }, data: { status: 'PENDING', assignedToId: null, leaseExpiresAt: null, operatorId: null, decision: '', submittedAt: null } });
      else await tx.tutorReviewTask.update({ where: { id: edit.id }, data: { status: 'PENDING', assignedToId: null, leaseExpiresAt: null, operatorId: null, decision: '', submittedAt: null } });
      await tx.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: confirm ? 'AWAITING_CONFIRMATION' : 'IN_REVIEW' } });
    });
    const status = confirm ? 'AWAITING_CONFIRMATION' : 'IN_REVIEW';
    await audit(input.user.id, 'TUTOR_CASE_QUALITY_KEPT', 'TutorTurnCase', task.caseId, { reason: input.reason, status });
    return { status, caseId: task.caseId };
  }

  if (input.decision === 'REJECT_CASE') {
    await db.$transaction([
      db.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'SUBMITTED', operatorId: input.user.id, decision: 'REJECT_CASE', reason: input.reason.trim(), submittedAt: new Date() } }),
      db.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: 'CASE_REJECTED' } }),
    ]);
    await audit(input.user.id, 'TUTOR_CASE_QUALITY_REJECTED', 'TutorTurnCase', task.caseId, { reason: input.reason });
    return { status: 'CASE_REJECTED', caseId: task.caseId };
  }

  const studentMessage = input.studentMessage?.trim() ?? '';
  if (task.case.triggerType !== 'SYSTEM_TRIGGER' && !studentMessage) throw new Error('学生消息不能为空');
  if (/internalArchetype|privateReviewSpec|高概念降级型|变量混乱型|一次给全型/.test(studentMessage)) throw new Error('学生消息包含内部审核术语');
  const oldVisibleFacts = parseJson<Record<string, unknown>>(task.case.visibleFactsJson, {});
  const visibleFacts = input.visibleFacts && typeof input.visibleFacts === 'object' && !Array.isArray(input.visibleFacts)
    ? input.visibleFacts as Record<string, unknown>
    : oldVisibleFacts;
  const allowedFocusIds = Array.isArray(visibleFacts.allowedFocusIds) ? visibleFacts.allowedFocusIds.filter((item): item is string => typeof item === 'string') : [];
  if (!allowedFocusIds.length) throw new Error('修改后的可见事实缺少 allowedFocusIds');
  const focusDescriptions = visibleFacts.focusDescriptions && typeof visibleFacts.focusDescriptions === 'object' && !Array.isArray(visibleFacts.focusDescriptions)
    ? visibleFacts.focusDescriptions as Record<string, string>
    : undefined;
  const systemPrompt = buildCaseTutorPrompt({ phase: task.case.phase, triggerType: task.case.triggerType, visibleFacts, allowedFocusIds, focusDescriptions, promptVersion: task.case.promptVersion as TutorLanguagePromptVersion });
  const privateSpec = parseJson<Record<string, unknown>>(task.case.privateReviewSpecJson, {});
  const leaks = casePromptLeaksPrivate(systemPrompt, privateSpec);
  const hardErrors = leaks.length ? [`PRIVATE_PROMPT_LEAK:${leaks.join('|')}`] : [];
  const rootRevisionId = task.case.revisionOfId ?? task.case.id;

  const revised = await db.$transaction(async (tx) => {
    const created = await tx.tutorTurnCase.create({ data: {
      topicCardId: task.case.topicCardId,
      generationRunId: task.case.generationRunId,
      revisionOfId: rootRevisionId,
      revision: task.case.revision + 1,
      phase: task.case.phase,
      triggerType: task.case.triggerType,
      studentMessage,
      historyJson: task.case.historyJson,
      stageStateJson: task.case.stageStateJson,
      visibleFactsJson: JSON.stringify(visibleFacts),
      privateReviewSpecJson: task.case.privateReviewSpecJson,
      dataSource: task.case.dataSource,
      split: task.case.split,
      contractVersion: task.case.contractVersion,
      extractorVersion: task.case.extractorVersion,
      promptVersion: task.case.promptVersion,
      systemPrompt,
      promptSha256: sha256(systemPrompt),
      hardCheckJson: JSON.stringify({ errors: hardErrors, revisionReason: input.reason.trim() }),
      status: hardErrors.length ? 'BLOCKED' : 'READY',
    } });
    await tx.tutorReviewTask.update({ where: { id: task.id }, data: { status: 'SUBMITTED', operatorId: input.user.id, decision: 'APPROVE_REVISION', reason: input.reason.trim(), draftJson: JSON.stringify({ revisedCaseId: created.id, previousStudentMessage: task.case.studentMessage, studentMessage, visibleFacts }), submittedAt: new Date() } });
    await tx.tutorReviewTask.updateMany({ where: { caseId: task.caseId, id: { not: task.id }, status: { in: ['PENDING', 'RETURNED', 'IN_PROGRESS', 'REGEN_REQUESTED'] } }, data: { status: 'SUPERSEDED', assignedToId: null, leaseExpiresAt: null } });
    await tx.tutorTurnCase.update({ where: { id: task.caseId }, data: { status: 'SUPERSEDED' } });
    return created;
  });
  await audit(input.user.id, 'TUTOR_CASE_REVISION_APPROVED', 'TutorTurnCase', revised.id, { previousCaseId: task.caseId, revision: revised.revision, reason: input.reason });
  return { status: revised.status, caseId: revised.id, revision: revised.revision, previousCaseId: task.caseId };
}

export async function listFinalizedTutorTurns() {
  return db.finalizedTutorTurn.findMany({
    orderBy: { createdAt: 'desc' },
    include: { case: { include: { topicCard: { select: { displayTitle: true, subject: true, status: true } } } }, firstReviewer: { select: { displayName: true } }, secondReviewer: { select: { displayName: true } } },
  });
}

export function evaluateTrialQuality(records: Array<{
  finalOutputJson: string;
  editMetricsJson: string;
  trainingEligibility: string;
  eligibilityReasonJson: string;
  directConfirmed?: boolean;
}>) {
  const total = records.length;
  const light = records.filter((item) => ['NO_CHANGE', 'LIGHT_EDIT'].includes(parseJson<{ type?: string }>(item.editMetricsJson, {}).type ?? '')).length;
  const blockedReasons = records.flatMap((item) => parseJson<string[]>(item.eligibilityReasonJson, []));
  let nearPairs = 0;
  for (let i = 0; i < records.length; i += 1) for (let j = i + 1; j < records.length; j += 1) if (shingleJaccard(records[i].finalOutputJson, records[j].finalOutputJson) >= 0.82) nearPairs += 1;
  const exactDuplicates = total - new Set(records.map((item) => createHash('sha256').update(item.finalOutputJson).digest('hex'))).size;
  const metrics = {
    total,
    hardOrLeakErrors: blockedReasons.filter((reason) => /HARD|LEAK|INTERNAL/.test(reason)).length,
    lightEditRate: total ? light / total : 0,
    directConfirmRate: total ? records.filter((item) => item.directConfirmed === true).length / total : 0,
    exactDuplicates,
    nearDuplicateRate: total ? nearPairs / total : 0,
    templateRepeatRate: total ? records.filter((item) => /太棒了|非常好|做得很好/.test(item.finalOutputJson)).length / total : 0,
  };
  const failures: string[] = [];
  if (metrics.hardOrLeakErrors !== 0) failures.push('HARD_OR_INTERNAL_LEAK_ERRORS');
  if (metrics.lightEditRate < 0.75) failures.push('LIGHT_EDIT_RATE_BELOW_75_PERCENT');
  if (metrics.directConfirmRate < 0.85) failures.push('DIRECT_CONFIRM_RATE_BELOW_85_PERCENT');
  if (metrics.exactDuplicates !== 0) failures.push('EXACT_DUPLICATES_PRESENT');
  if (metrics.nearDuplicateRate >= 0.10) failures.push('NEAR_DUPLICATE_RATE_AT_OR_ABOVE_10_PERCENT');
  if (metrics.templateRepeatRate >= 0.10) failures.push('TEMPLATE_REPEAT_RATE_AT_OR_ABOVE_10_PERCENT');
  return { pass: total >= 36 && failures.length === 0, failures: total < 36 ? ['TRIAL_REQUIRES_36_CASES', ...failures] : failures, metrics };
}

async function qualityRecordsForRun(runId: string) {
  const records = await db.finalizedTutorTurn.findMany({
    where: { case: { generationRunId: runId } },
    select: { caseId: true, finalOutputJson: true, editMetricsJson: true, trainingEligibility: true, eligibilityReasonJson: true },
  });
  const caseIds = records.map((item) => item.caseId);
  const confirmTasks = caseIds.length
    ? await db.tutorReviewTask.findMany({ where: { caseId: { in: caseIds }, type: 'CONFIRM' }, select: { id: true, caseId: true, decision: true } })
    : [];
  const returnedTaskIds = new Set(confirmTasks.length
    ? (await db.dataLabAuditLog.findMany({ where: { action: 'TUTOR_CONFIRM_RETURNED', entityType: 'TutorReviewTask', entityId: { in: confirmTasks.map((item) => item.id) } }, select: { entityId: true } })).map((item) => item.entityId)
    : []);
  const directByCase = new Map(confirmTasks.map((task) => [task.caseId, task.decision === 'CONFIRM' && !returnedTaskIds.has(task.id)]));
  return records.map((item) => ({ ...item, directConfirmed: directByCase.get(item.caseId) === true }));
}

async function latestCaseCompilationRun(profile: TutorCaseProfile) {
  return db.bootstrapGenerationRun.findFirst({
    where: { kind: 'CASE_COMPILATION', parametersJson: { contains: `"profile":"${profile}"` }, status: 'COMPLETED', cases: { some: { status: { not: 'SUPERSEDED' } } } },
    orderBy: { completedAt: 'desc' },
  });
}

export async function trialQualityReport(runId?: string) {
  const trialRun = runId
    ? await db.bootstrapGenerationRun.findFirst({ where: { id: runId, kind: 'CASE_COMPILATION', parametersJson: { contains: '"profile":"TRIAL_36"' }, status: 'COMPLETED', cases: { some: { status: { not: 'SUPERSEDED' } } } } })
    : await latestCaseCompilationRun('TRIAL_36');
  const report = evaluateTrialQuality(trialRun ? await qualityRecordsForRun(trialRun.id) : []);
  const signoff = trialRun ? await db.bootstrapGenerationRun.findFirst({
    where: { kind: 'TRIAL_SIGNOFF', status: 'COMPLETED', parametersJson: { contains: `"trialRunId":"${trialRun.id}"` } },
    orderBy: { completedAt: 'desc' },
  }) : null;
  return { ...report, runId: trialRun?.id ?? null, signedOff: Boolean(signoff), signoffId: signoff?.id ?? null };
}

export async function smokeQualityReport(runId?: string) {
  const smokeRun = runId
    ? await db.bootstrapGenerationRun.findFirst({ where: { id: runId, kind: 'CASE_COMPILATION', parametersJson: { contains: '"profile":"SMOKE_6"' }, status: 'COMPLETED' } })
    : await latestCaseCompilationRun('SMOKE_6');
  const records = smokeRun ? await qualityRecordsForRun(smokeRun.id) : [];
  const base = evaluateTrialQuality(records);
  const materialCorrections = records.filter((item) => parseJson<{ type?: string }>(item.editMetricsJson, {}).type === 'MATERIAL_CORRECTION').length;
  const failures: string[] = [];
  if (base.metrics.hardOrLeakErrors !== 0) failures.push('HARD_OR_INTERNAL_LEAK_ERRORS');
  if (base.metrics.lightEditRate < 4 / 6) failures.push('SMOKE_REQUIRES_FOUR_LIGHT_OR_NO_EDIT');
  if (base.metrics.directConfirmRate !== 1) failures.push('SMOKE_REQUIRES_ALL_DIRECT_CONFIRM');
  if (base.metrics.exactDuplicates !== 0) failures.push('EXACT_DUPLICATES_PRESENT');
  if (base.metrics.nearDuplicateRate >= 0.10) failures.push('NEAR_DUPLICATE_RATE_AT_OR_ABOVE_10_PERCENT');
  if (base.metrics.templateRepeatRate >= 0.10) failures.push('TEMPLATE_REPEAT_RATE_AT_OR_ABOVE_10_PERCENT');
  if (materialCorrections > 2) failures.push('SMOKE_MATERIAL_CORRECTIONS_ABOVE_TWO');
  if (records.length !== 6) failures.unshift('SMOKE_REQUIRES_SIX_FINALIZED_CASES');
  return {
    pass: failures.length === 0,
    failures,
    metrics: { ...base.metrics, materialCorrections },
    runId: smokeRun?.id ?? null,
  };
}

export async function calibrationQualityReport(runId?: string) {
  const calibrationRun = runId
    ? await db.bootstrapGenerationRun.findFirst({ where: { id: runId, kind: 'CASE_COMPILATION', parametersJson: { contains: '"profile":"CALIBRATION_12"' }, status: 'COMPLETED' } })
    : await latestCaseCompilationRun('CALIBRATION_12');
  const records = calibrationRun ? await qualityRecordsForRun(calibrationRun.id) : [];
  const base = evaluateTrialQuality(records);
  const finalized = calibrationRun ? await db.finalizedTutorTurn.findMany({
    where: { case: { generationRunId: calibrationRun.id } },
    select: { caseId: true, warningClosureJson: true, editMetricsJson: true },
  }) : [];
  let totalWarnings = 0;
  let structuredClosures = 0;
  let multiAxisClosures = 0;
  let criticWarnings = 0;
  let criticFalsePositives = 0;
  const resolutions = { FIXED: 0, ACCEPTABLE: 0, NOT_APPLICABLE: 0, FALSE_POSITIVE: 0 };
  const validities = { VALID: 0, PARTIALLY_VALID: 0, FALSE_POSITIVE: 0 };
  const finalRelations = { PRESENT_IN_FINAL: 0, REMOVED_BY_EDIT: 0, ONLY_UNSELECTED_CANDIDATE: 0 };
  const severities = { BLOCKING: 0, MINOR: 0, NEGLIGIBLE: 0 };
  for (const turn of finalized) {
    const warnings = warningsForCandidates(await latestPair(turn.caseId));
    const closures = sanitizeTutorWarningClosures(parseJson(turn.warningClosureJson, {}));
    totalWarnings += warnings.length;
    for (const warning of warnings) {
      const closure = closures[warning.id];
      if (warning.source === 'CRITIC') criticWarnings += 1;
      if (!closure || typeof closure !== 'object') continue;
      structuredClosures += 1;
      if (isTutorWarningAssessmentV2(closure)) {
        multiAxisClosures += 1;
        const mappedValidity = closure.detectorVerdict === 'CORRECT' ? 'VALID' : closure.detectorVerdict === 'FALSE_POSITIVE' ? 'FALSE_POSITIVE' : 'PARTIALLY_VALID';
        validities[mappedValidity] += 1;
        finalRelations[closure.finalRelation] += 1;
        const severity = closure.finalSeverity ?? closure.candidateSeverity;
        if (severity) severities[severity] += 1;
        if (warning.source === 'CRITIC' && closure.detectorVerdict === 'FALSE_POSITIVE') criticFalsePositives += 1;
      } else if (isTutorWarningAssessment(closure)) {
        multiAxisClosures += 1;
        validities[closure.validity] += 1;
        finalRelations[closure.finalRelation] += 1;
        severities[closure.severity] += 1;
        if (warning.source === 'CRITIC' && closure.validity === 'FALSE_POSITIVE') criticFalsePositives += 1;
      } else if (isLegacyTutorWarningClosure(closure)) {
        resolutions[closure.resolution] += 1;
        if (warning.source === 'CRITIC' && closure.resolution === 'FALSE_POSITIVE') criticFalsePositives += 1;
      }
    }
  }
  const materialCorrections = finalized.filter((item) => parseJson<{ type?: string }>(item.editMetricsJson, {}).type === 'MATERIAL_CORRECTION').length;
  const structuredClosureRate = totalWarnings ? structuredClosures / totalWarnings : 1;
  const multiAxisClosureRate = totalWarnings ? multiAxisClosures / totalWarnings : 1;
  const criticFalsePositiveRate = criticWarnings ? criticFalsePositives / criticWarnings : 0;
  const falsePositiveWarnings = resolutions.FALSE_POSITIVE + validities.FALSE_POSITIVE;
  const failures: string[] = [];
  if (records.length !== 12) failures.push('CALIBRATION_REQUIRES_TWELVE_FINALIZED_CASES');
  if (base.metrics.hardOrLeakErrors !== 0) failures.push('HARD_OR_INTERNAL_LEAK_ERRORS');
  if (base.metrics.lightEditRate < 0.75) failures.push('CALIBRATION_LIGHT_EDIT_RATE_BELOW_75_PERCENT');
  if (base.metrics.directConfirmRate < 0.90) failures.push('CALIBRATION_DIRECT_CONFIRM_RATE_BELOW_90_PERCENT');
  if (base.metrics.exactDuplicates !== 0) failures.push('EXACT_DUPLICATES_PRESENT');
  if (base.metrics.nearDuplicateRate >= 0.10) failures.push('NEAR_DUPLICATE_RATE_AT_OR_ABOVE_10_PERCENT');
  if (base.metrics.templateRepeatRate >= 0.10) failures.push('TEMPLATE_REPEAT_RATE_AT_OR_ABOVE_10_PERCENT');
  if (materialCorrections > 3) failures.push('CALIBRATION_MATERIAL_CORRECTIONS_ABOVE_THREE');
  if (structuredClosureRate !== 1) failures.push('CALIBRATION_WARNING_CLOSURES_NOT_STRUCTURED');
  if (criticFalsePositives > 1 || (criticWarnings >= 4 && criticFalsePositiveRate > 0.25)) failures.push('CALIBRATION_CRITIC_FALSE_POSITIVE_RATE_TOO_HIGH');
  return {
    pass: failures.length === 0,
    failures,
    metrics: {
      ...base.metrics,
      materialCorrections,
      totalWarnings,
      structuredClosureRate,
      multiAxisClosureRate,
      fixedWarnings: resolutions.FIXED,
      acceptableWarnings: resolutions.ACCEPTABLE,
      notApplicableWarnings: resolutions.NOT_APPLICABLE,
      falsePositiveWarnings,
      validWarnings: validities.VALID,
      partiallyValidWarnings: validities.PARTIALLY_VALID,
      presentInFinalWarnings: finalRelations.PRESENT_IN_FINAL,
      removedByEditWarnings: finalRelations.REMOVED_BY_EDIT,
      unselectedCandidateWarnings: finalRelations.ONLY_UNSELECTED_CANDIDATE,
      blockingWarnings: severities.BLOCKING,
      minorWarnings: severities.MINOR,
      negligibleWarnings: severities.NEGLIGIBLE,
      criticWarnings,
      criticFalsePositiveRate,
    },
    runId: calibrationRun?.id ?? null,
  };
}

export async function approveTrialExpansion(note: string, user: SessionUser, trialRunId?: string) {
  if (!note.trim()) throw new Error('人工签署必须记录逐条复盘结论');
  const report = await trialQualityReport(trialRunId);
  if (!report.runId) throw new Error('没有可签署的 36 条试验批次');
  if (!report.pass) throw new Error(`36 案例试验自动门槛未通过：${report.failures.join('、')}`);
  const run = await db.bootstrapGenerationRun.create({ data: {
    kind: 'TRIAL_SIGNOFF', status: 'COMPLETED', totalItems: report.metrics.total, completedItems: report.metrics.total,
    parametersJson: JSON.stringify({ trialRunId: report.runId, note: note.trim(), metrics: report.metrics, manualChecks: ['无系统性主题漂移', '无伪学生表达'] }),
    createdById: user.id, startedAt: new Date(), completedAt: new Date(),
  } });
  await audit(user.id, 'TRIAL_36_SIGNED_OFF', 'BootstrapGenerationRun', run.id, { trialRunId: report.runId, note: note.trim(), metrics: report.metrics });
  return run;
}

export function assertReleaseItemSource(sampleId?: string | null, finalizedTutorTurnId?: string | null) {
  if (Boolean(sampleId) === Boolean(finalizedTutorTurnId)) throw new Error('每个发布项必须且只能绑定一条历史样本或已定稿导师回合');
}

export async function createTutorTurnRelease(input: { version: string; finalizedTutorTurnIds: string[]; user: SessionUser }) {
  const { mkdir, writeFile } = await import('fs/promises');
  const path = await import('path');
  const ids = [...new Set(input.finalizedTutorTurnIds)];
  if (!input.version.trim() || ids.length === 0) throw new Error('请填写版本号并至少选择一条已定稿导师回合');
  const turns = await db.finalizedTutorTurn.findMany({
    where: { id: { in: ids } },
    include: {
      case: { include: { topicCard: true } },
      preferenceRejectedCandidate: true,
      selectedCandidate: true,
    },
  });
  if (turns.length !== ids.length) throw new Error('部分已定稿导师回合不存在，请刷新后重新选择');
  const blocked = turns.filter((turn) => turn.trainingEligibility !== 'SFT_ALLOWED' || turn.case.split !== 'TRAIN');
  if (blocked.length) throw new Error(`所选数据中有 ${blocked.length} 条不具备正式训练集发布资格`);
  for (const turn of turns) {
    if (!turn.preferenceRejectedCandidate) continue;
    const rejectedCheck = parseJson<CandidateCheck>(turn.preferenceRejectedCandidate.deterministicCheckJson, { ok: false, hardErrorCount: 1, warningCount: 0, issues: [] });
    if (rejectedCheck.hardErrorCount > 0 || !turn.preferenceRejectedCandidate.normalizedOutput) {
      throw new Error('所选数据中有一条偏好对未采用稿存在硬错误，不能导出');
    }
  }
  const contentHashes = turns.map((turn) => turn.contentSha256);
  if (new Set(contentHashes).size !== contentHashes.length) throw new Error('发布选择中存在完全重复内容');
  for (let i = 0; i < turns.length; i += 1) for (let j = i + 1; j < turns.length; j += 1) {
    if (shingleJaccard(turns[i].finalOutputJson, turns[j].finalOutputJson) >= 0.82) throw new Error(`发布选择中存在近重复：${turns[i].id} / ${turns[j].id}`);
  }

  const training = turns.map((turn) => {
    const history = parseJson<Array<{ role: 'user' | 'assistant'; content: string }>>(turn.case.historyJson, []);
    const conversations: Array<{ from: 'system' | 'human' | 'gpt'; value: string }> = [
      { from: 'system', value: turn.case.systemPrompt },
      ...history.map((item) => ({ from: item.role === 'user' ? 'human' as const : 'gpt' as const, value: item.content })),
    ];
    if (turn.case.triggerType === 'SYSTEM_TRIGGER') conversations.push({ from: 'system', value: 'SYSTEM_TRIGGER：平台状态变化触发本回合；这不是学生消息。' });
    else conversations.push({ from: 'human', value: turn.case.studentMessage });
    conversations.push({ from: 'gpt', value: turn.finalOutputJson });
    return {
      id: `tutor-turn-${turn.id}`,
      phase: turn.case.phase,
      scenario: turn.case.topicCard?.displayTitle ?? '授权生产会话回流',
      conversations,
      meta: {
        schemaVersion: 4,
        sourceKind: 'finalized_tutor_turn',
        contractVersion: turn.case.contractVersion,
        promptVersion: turn.case.promptVersion,
        extractorVersion: turn.case.extractorVersion,
        triggerType: turn.case.triggerType,
        split: turn.case.split,
        draftProvenance: turn.draftProvenance,
        reviewerEditType: parseJson<{ type?: string }>(turn.reviewerEditMetricsJson, {}).type ?? 'UNKNOWN',
      },
    };
  });
  const preference = turns.flatMap((turn) => {
    if (!turn.preferenceRejectedCandidate || !turn.preferenceReason.trim()) return [];
    return [{
      id: `preference-${turn.id}`,
      caseId: turn.caseId,
      prompt: training.find((record) => record.id === `tutor-turn-${turn.id}`)?.conversations.slice(0, -1) ?? [],
      chosen: parseJson(turn.finalOutputJson, {}),
      rejected: parseJson(turn.preferenceRejectedCandidate.normalizedOutput, {}),
      humanComparisonReason: turn.preferenceReason,
      chosenCandidateId: turn.selectedCandidateId,
      rejectedCandidateId: turn.preferenceRejectedCandidateId,
    }];
  });
  const release = await db.datasetRelease.create({
    data: {
      version: input.version.trim(),
      status: 'DRAFT',
      recipeJson: JSON.stringify({ source: 'FINALIZED_TUTOR_TURNS', ids }),
      createdById: input.user.id,
    },
  });
  const outputDir = path.join(process.cwd(), 'data', 'releases', release.version);
  await mkdir(outputDir, { recursive: true });
  const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const trainingText = serialize(training);
  const preferenceText = serialize(preference);
  const cleanText = trainingText;
  const emptyText = serialize([]);
  const manifest = {
    schemaVersion: 4,
    version: release.version,
    frozenAt: new Date().toISOString(),
    source: 'FINALIZED_TUTOR_TURNS',
    contractVersion: TUTOR_LANGUAGE_CONTRACT_VERSION,
    target: 'TutorLanguageResponse only; server artifacts excluded',
    summary: { clean: training.length, training: training.length, preference: preference.length, humanGold: 0, reviewedSilver: 0, byPhase: Object.fromEntries([1, 2, 3, 4, 5, 6].map((phase) => [phase, turns.filter((turn) => turn.case.phase === phase).length])), byDraftProvenance: Object.fromEntries(TUTOR_DRAFT_PROVENANCES.map((provenance) => [provenance, turns.filter((turn) => turn.draftProvenance === provenance).length])) },
    items: turns.map((turn) => ({ finalizedTutorTurnId: turn.id, caseId: turn.caseId, trainingEligibility: turn.trainingEligibility, preferenceEligible: Boolean(turn.preferenceRejectedCandidateId && turn.preferenceReason.trim()) })),
  };
  const files = {
    cleanPath: path.join(outputDir, 'clean.json'),
    goldPath: path.join(outputDir, 'gold.json'),
    silverPath: path.join(outputDir, 'silver.json'),
    trainingPath: path.join(outputDir, 'training.json'),
    preferencePath: path.join(outputDir, 'preference.json'),
    manifestPath: path.join(outputDir, 'manifest.json'),
  };
  const manifestText = serialize(manifest);
  await Promise.all([
    writeFile(files.cleanPath, cleanText, 'utf8'), writeFile(files.goldPath, emptyText, 'utf8'), writeFile(files.silverPath, emptyText, 'utf8'),
    writeFile(files.trainingPath, trainingText, 'utf8'), writeFile(files.preferencePath, preferenceText, 'utf8'), writeFile(files.manifestPath, manifestText, 'utf8'),
  ]);
  await db.$transaction(async (tx) => {
    for (const turn of turns) {
      assertReleaseItemSource(null, turn.id);
      const record = training.find((item) => item.id === `tutor-turn-${turn.id}`)!;
      await tx.datasetReleaseItem.create({ data: {
        releaseId: release.id,
        sampleId: null,
        finalizedTutorTurnId: turn.id,
        revisionId: null,
        tier: 'finalized_tutor_turn',
        weight: 1,
        inclusionReason: `annotator-policy:${turn.draftProvenance}:${turn.draftPreparedById ?? turn.firstReviewerId}:human-reviewer:${turn.humanReviewerId ?? turn.secondReviewerId}`,
        recordJson: JSON.stringify(record),
        styleFamily: null,
        stylePolicyVersion: null,
        trainingEligibility: turn.trainingEligibility,
        eligibilityReasonJson: turn.eligibilityReasonJson,
      } });
    }
    await tx.datasetRelease.update({ where: { id: release.id }, data: {
      status: 'FROZEN', frozenAt: new Date(), summaryJson: JSON.stringify(manifest.summary),
      cleanPath: files.cleanPath, cleanSha256: sha256(cleanText), goldPath: files.goldPath, goldSha256: sha256(emptyText), silverPath: files.silverPath, silverSha256: sha256(emptyText),
      trainingPath: files.trainingPath, trainingSha256: sha256(trainingText), preferencePath: files.preferencePath, preferenceSha256: sha256(preferenceText),
      eligibilityReportJson: JSON.stringify({ policyVersion: 'tutor-training-eligibility-v1', sftAllowed: turns.length, monitoringOnly: 0, blocked: 0 }),
      manifestPath: files.manifestPath, manifestSha256: sha256(manifestText),
    } });
  });
  await audit(input.user.id, 'TUTOR_RELEASE_FROZEN', 'DatasetRelease', release.id, manifest.summary);
  return { releaseId: release.id, summary: manifest.summary };
}
