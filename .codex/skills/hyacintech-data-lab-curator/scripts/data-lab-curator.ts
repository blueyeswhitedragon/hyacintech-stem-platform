#!/usr/bin/env tsx
import '../../../../scripts/load-script-env';

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { db } from '../../../../app/lib/db';
import { createLLMProvider } from '../../../../app/lib/llm/provider';
import type { SessionUser } from '../../../../app/lib/session';
import {
  approvedTopicCardCoverage,
  compileTutorTurnCases,
  createTopicCardRevision,
  decideTopicCard,
  generateTopicCardDrafts,
  generateTutorCandidates,
  listTutorCaseQualityTasks,
  retryTutorCandidateCritics,
  submitEditReview,
  TUTOR_CASE_ISSUE_CATEGORIES,
  updateTopicCard,
  type TutorCaseProfile,
} from '../../../../app/lib/dataLab/bootstrap/service';
import {
  assertIndependentModelFamilies,
  BOOTSTRAP_SUBJECTS,
  checkTutorCandidate,
  validateTopicCardInput,
  type CandidateModelConfig,
  type TopicCardInput,
} from '../../../../app/lib/dataLab/bootstrap/contracts';
import {
  TOPIC_ACTIVITY_MODES,
  TOPIC_CARD_SCHEMA_V2,
  TOPIC_CONTEXT_MODULES,
  type TopicActivityMode,
  type TopicContextModule,
} from '../../../../app/lib/dataLab/bootstrap/topicCardV2';

type JsonObject = Record<string, unknown>;
type TopicReviewAction = 'APPROVE' | 'REJECT' | 'REVISE';
type FirstReviewDecision = 'SELECT_A' | 'SELECT_B' | 'MERGE' | 'EDIT' | 'RETURN_CASE' | 'REGENERATE' | 'REGRESSION' | 'NEGATIVE' | 'REJECT';

interface ParsedArgs {
  command: string;
  options: Map<string, string>;
  flags: Set<string>;
}

interface TopicBrief {
  subject: string;
  contextModule: TopicContextModule;
  activityMode: TopicActivityMode;
  theme: string;
  closes: string[];
}

interface TopicReviewItem {
  cardId: string;
  action: TopicReviewAction;
  reason: string;
  checks?: Record<string, string>;
  card?: TopicCardInput;
}

interface FirstReviewItem {
  caseId: string;
  caseRevision: number;
  candidateGenerationRunId?: string;
  decision: FirstReviewDecision;
  selectedSlot?: 'A' | 'B';
  finalOutput?: unknown;
  reason: string;
  preferenceRejectedSlot?: 'A' | 'B';
  preferenceReason?: string;
  caseIssue?: {
    categories?: string[];
    suggestedStudentMessage?: string;
    note?: string;
  };
}

const TOPIC_APPROVAL_CHECKS = [
  'logic',
  'ageAppropriate',
  'measurable',
  'safety',
  'authenticity',
  'diversity',
  'studentOpening',
  'engineeringCompleteness',
] as const;

const AI_DISCLOSURE = 'AI_ASSISTED_DRAFT: CODEX_AGENT_AUTHORIZED. Admin-authorized Codex first review; independent Human Reviewer required.';

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[2] ?? 'help';
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument: ${token}`);
    const equals = token.indexOf('=');
    if (equals > 2) {
      options.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options.set(name, next);
      index += 1;
    } else {
      flags.add(name);
    }
  }
  return { command, options, flags };
}

const args = parseArgs(process.argv);

function option(name: string, fallback?: string): string | undefined {
  return args.options.get(name) ?? fallback;
}

function requiredOption(name: string): string {
  const value = option(name)?.trim();
  if (!value) throw new Error(`Missing required option --${name}`);
  return value;
}

function hasFlag(name: string): boolean {
  return args.flags.has(name);
}

function positiveInt(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = option(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`--${name} must be an integer from 1 to ${max}`);
  return value;
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseStored<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readJsonFile<T>(file: string): T {
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) throw new Error(`Input file does not exist: ${resolved}`);
  return parseJson<T>(readFileSync(resolved, 'utf8'), resolved);
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function output(value: unknown): void {
  const out = option('out');
  if (!out) {
    console.log(json(value));
    return;
  }
  const resolved = path.resolve(out);
  const parent = path.dirname(resolved);
  if (!existsSync(parent)) throw new Error(`Output directory does not exist: ${parent}`);
  writeFileSync(resolved, `${json(value)}\n`, 'utf8');
  console.log(json({ written: resolved }));
}

function dryRun(command: string, plan: unknown): void {
  output({ dryRun: true, command, plan, next: `Re-run with --apply to execute ${command}.` });
}

async function adminActor(): Promise<SessionUser> {
  const username = option('actor', process.env.DATA_LAB_AGENT_USERNAME)?.trim();
  if (!username) throw new Error('Mutating commands require --actor <active-admin-username> or DATA_LAB_AGENT_USERNAME.');
  const row = await db.user.findFirst({ where: { username, role: 'admin', isActive: true } });
  if (!row) throw new Error(`Active admin not found: ${username}`);
  return { id: row.id, username: row.username, displayName: row.displayName, role: 'admin' };
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function topicCoverage(cards: Array<{ subject: string; schemaVersion: number; contextModule: string; activityMode: string }>) {
  const subjects = Object.fromEntries(BOOTSTRAP_SUBJECTS.map((subject) => [subject, cards.filter((card) => card.subject === subject).length]));
  const contextModules = Object.fromEntries(TOPIC_CONTEXT_MODULES.map((module) => [module, cards.filter((card) => card.contextModule === module).length]));
  const engineeringCards = cards.filter((card) => card.activityMode === 'ENGINEERING_DESIGN' || card.activityMode === 'HYBRID');
  const engineeringByModule = Object.fromEntries(TOPIC_CONTEXT_MODULES.map((module) => [module, engineeringCards.filter((card) => card.contextModule === module).length]));
  return {
    total: cards.length,
    v2Count: cards.filter((card) => card.schemaVersion === TOPIC_CARD_SCHEMA_V2).length,
    subjects,
    contextModules,
    engineeringOrHybrid: engineeringCards.length,
    engineeringByModule,
  };
}

function planTopicBriefs(cards: Array<{ subject: string; schemaVersion: number; contextModule: string; activityMode: string }>, limit: number): TopicBrief[] {
  const simulated = cards.map((card) => ({ ...card }));
  const briefs: TopicBrief[] = [];
  const preferredModules: Record<string, TopicContextModule[]> = {
    biology_ecology: ['LIFE_HEALTH', 'ENERGY_ENVIRONMENT', 'DEEP_EARTH_OCEAN'],
    chemistry: ['ENERGY_ENVIRONMENT', 'LIFE_HEALTH', 'DEEP_EARTH_OCEAN'],
    physics: ['AEROSPACE', 'ENERGY_ENVIRONMENT', 'INTELLIGENT_INFORMATION'],
    engineering: ['INTELLIGENT_INFORMATION', 'ENERGY_ENVIRONMENT', 'AEROSPACE'],
    high_concept_interdisciplinary: ['DEEP_EARTH_OCEAN', 'AEROSPACE', 'INTELLIGENT_INFORMATION'],
  };
  for (let index = 0; index < limit; index += 1) {
    const coverage = topicCoverage(simulated);
    const subjectGap = BOOTSTRAP_SUBJECTS.filter((subject) => coverage.subjects[subject] < 3)
      .sort((a, b) => coverage.subjects[a] - coverage.subjects[b])[0];
    const moduleEngineeringGap = TOPIC_CONTEXT_MODULES.find((module) => coverage.engineeringByModule[module] < 1);
    const moduleGap = TOPIC_CONTEXT_MODULES.filter((module) => coverage.contextModules[module] < 3)
      .sort((a, b) => coverage.contextModules[a] - coverage.contextModules[b])[0];
    const needsEngineering = Boolean(moduleEngineeringGap) || coverage.engineeringOrHybrid < 6;
    const allSatisfied = coverage.total >= 15
      && !subjectGap
      && !moduleGap
      && !moduleEngineeringGap
      && coverage.engineeringOrHybrid >= 6;
    if (allSatisfied) break;

    const subject = subjectGap ?? (needsEngineering ? 'engineering' : BOOTSTRAP_SUBJECTS[index % BOOTSTRAP_SUBJECTS.length]);
    const preferred = preferredModules[subject] ?? [...TOPIC_CONTEXT_MODULES];
    const contextModule = moduleEngineeringGap
      ?? moduleGap
      ?? [...preferred].sort((a, b) => coverage.contextModules[a] - coverage.contextModules[b])[0];
    const activityMode: TopicActivityMode = needsEngineering || subject === 'engineering'
      ? index % 2 === 0 ? 'ENGINEERING_DESIGN' : 'HYBRID'
      : 'SCIENTIFIC_INQUIRY';
    const closes = [
      coverage.subjects[subject as keyof typeof coverage.subjects] < 3 ? `subject:${subject}` : '',
      coverage.contextModules[contextModule] < 3 ? `context:${contextModule}` : '',
      coverage.engineeringByModule[contextModule] < 1 && activityMode !== 'SCIENTIFIC_INQUIRY' ? `engineering-context:${contextModule}` : '',
      coverage.engineeringOrHybrid < 6 && activityMode !== 'SCIENTIFIC_INQUIRY' ? 'engineering-total' : '',
      coverage.total < 15 ? 'approved-total' : '',
    ].filter(Boolean);
    briefs.push({
      subject,
      contextModule,
      activityMode,
      theme: `补足 Data Lab 覆盖：subject 必须为 ${subject}，contextModule 必须为 ${contextModule}，activityMode 必须为 ${activityMode}。选择一个尚未覆盖、真实且可由初中生完成的机制；不得为了凑标签扭曲学科归属。`,
      closes,
    });
    simulated.push({ subject, schemaVersion: 2, contextModule, activityMode });
  }
  return briefs;
}

async function status(): Promise<void> {
  const [coverage, topicStatuses, caseStatuses, reviewStatuses, recentRuns, recentCaseCompilations, caseTasks] = await Promise.all([
    approvedTopicCardCoverage(),
    db.topicCard.groupBy({ by: ['status'], _count: { _all: true } }),
    db.tutorTurnCase.groupBy({ by: ['status'], _count: { _all: true } }),
    db.tutorReviewTask.groupBy({ by: ['type', 'status'], _count: { _all: true } }),
    db.bootstrapGenerationRun.findMany({ orderBy: { createdAt: 'desc' }, take: 12, select: { id: true, kind: true, status: true, totalItems: true, completedItems: true, failedItems: true, reviewPolicy: true, createdAt: true, completedAt: true } }),
    db.bootstrapGenerationRun.findMany({ where: { kind: 'CASE_COMPILATION' }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, totalItems: true, completedItems: true, failedItems: true, reviewPolicy: true, parametersJson: true, createdAt: true, completedAt: true } }),
    listTutorCaseQualityTasks(),
  ]);
  output({
    approvedTopicCards: coverage,
    topicStatuses: Object.fromEntries(topicStatuses.map((row) => [row.status, row._count._all])),
    caseStatuses: Object.fromEntries(caseStatuses.map((row) => [row.status, row._count._all])),
    reviewQueues: reviewStatuses.map((row) => ({ type: row.type, status: row.status, count: row._count._all })),
    pendingCaseQualityTasks: caseTasks.length,
    recentCaseCompilations: recentCaseCompilations.map(({ parametersJson, ...run }) => ({ ...run, parameters: parseStored(parametersJson, {}) })),
    recentRuns,
  });
}

async function topicGaps(): Promise<void> {
  const limit = positiveInt('limit', 15, 30);
  const [approved, planningCards, draftCards, approvedV1Cards] = await Promise.all([
    approvedTopicCardCoverage(),
    db.topicCard.findMany({ where: { status: { in: ['APPROVED', 'DRAFT'] } }, select: { subject: true, schemaVersion: true, contextModule: true, activityMode: true } }),
    db.topicCard.findMany({ where: { status: 'DRAFT' }, orderBy: { createdAt: 'asc' }, select: { id: true, displayTitle: true, subject: true, contextModule: true, activityMode: true, schemaVersion: true } }),
    db.topicCard.findMany({ where: { status: 'APPROVED', schemaVersion: { not: TOPIC_CARD_SCHEMA_V2 } }, orderBy: { approvedAt: 'asc' }, select: { id: true, displayTitle: true, subject: true, schemaVersion: true, _count: { select: { cases: true } } } }),
  ]);
  const planning = topicCoverage(planningCards);
  output({
    approved,
    planningCoverageIncludingDrafts: planning,
    approvedV1CardsNeedRevision: approvedV1Cards,
    existingDrafts: draftCards,
    suggestedGenerationBriefs: planTopicBriefs(planningCards, limit),
    note: 'Draft-inclusive coverage prevents duplicate generation. Approved V1 cards require explicit V2 revisions; generating extra cards does not repair that gate.',
  });
}

function compactCompilerEvidence(raw: string): unknown {
  const value = parseStored<JsonObject>(raw, {});
  return {
    runId: value.runId,
    slot: value.slot,
    model: value.model,
    promptSha256: value.promptSha256,
    resourceAssessment: value.resourceAssessment,
    critique: value.critique,
    adminOverride: value.adminOverride,
    parseError: value.parseError,
  };
}

function criticOverrideReason(raw: string): string {
  const value = parseStored<{ adminOverride?: { reason?: unknown } }>(raw, {});
  return typeof value.adminOverride?.reason === 'string' ? value.adminOverride.reason : '';
}

async function topicPacket(): Promise<void> {
  const statuses = (option('status', 'DRAFT') ?? 'DRAFT').split(',').map((value) => value.trim()).filter(Boolean);
  const limit = positiveInt('limit', 100, 500);
  const [cards, approved] = await Promise.all([
    db.topicCard.findMany({ where: { status: { in: statuses } }, orderBy: { createdAt: 'asc' }, take: limit }),
    db.topicCard.findMany({ where: { status: 'APPROVED' }, orderBy: { approvedAt: 'asc' }, select: { id: true, displayTitle: true, subject: true, coreMechanism: true, activityMode: true, contextModule: true, authenticNeed: true } }),
  ]);
  output({
    packetVersion: 1,
    generatedAt: new Date().toISOString(),
    statuses,
    cards: cards.map((card) => ({
      id: card.id,
      status: card.status,
      revision: card.revision,
      revisionOfId: card.revisionOfId,
      displayTitle: card.displayTitle,
      studentOpening: card.studentOpening,
      internalArchetype: card.internalArchetype,
      subject: card.subject,
      gradeBand: card.gradeBand,
      coreMechanism: card.coreMechanism,
      schemaVersion: card.schemaVersion,
      activityMode: card.activityMode,
      contextModule: card.contextModule,
      disciplineAnchors: parseStored(card.disciplineAnchorsJson, []),
      authenticNeed: card.authenticNeed,
      stakeholder: card.stakeholder,
      engineeringGoal: card.engineeringGoal,
      constraints: parseStored(card.constraintsJson, []),
      performanceCriteria: parseStored(card.performanceCriteriaJson, []),
      inquiryBridges: parseStored(card.inquiryBridgesJson, []),
      acceptableDirections: parseStored(card.acceptableDirectionsJson, []),
      forbiddenDirections: parseStored(card.forbiddenDirectionsJson, []),
      curriculumAnchors: parseStored(card.curriculumAnchorsJson, []),
      source: parseStored(card.sourceJson, {}),
      sourceCandidateId: card.sourceCandidateId,
      compilerEvidence: compactCompilerEvidence(card.compilerEvidenceJson),
      criticOverrideReason: criticOverrideReason(card.compilerEvidenceJson),
      rejectionReason: card.rejectionReason,
    })),
    approvedComparisonSet: approved,
  });
}

async function generateTopics(): Promise<void> {
  const actor = await adminActor();
  const limit = positiveInt('limit', 5, 25);
  let briefs: TopicBrief[];
  const briefsFile = option('briefs');
  if (briefsFile) {
    const input = readJsonFile<{ briefs?: TopicBrief[] } | TopicBrief[]>(briefsFile);
    briefs = (Array.isArray(input) ? input : input.briefs ?? []).slice(0, limit);
  } else {
    const cards = await db.topicCard.findMany({ where: { status: { in: ['APPROVED', 'DRAFT'] } }, select: { subject: true, schemaVersion: true, contextModule: true, activityMode: true } });
    briefs = planTopicBriefs(cards, limit);
  }
  for (const [index, brief] of briefs.entries()) {
    if (!BOOTSTRAP_SUBJECTS.includes(brief.subject as (typeof BOOTSTRAP_SUBJECTS)[number])) throw new Error(`Brief ${index + 1} has invalid subject: ${brief.subject}`);
    if (!TOPIC_CONTEXT_MODULES.includes(brief.contextModule)) throw new Error(`Brief ${index + 1} has invalid contextModule: ${brief.contextModule}`);
    if (!TOPIC_ACTIVITY_MODES.includes(brief.activityMode)) throw new Error(`Brief ${index + 1} has invalid activityMode: ${brief.activityMode}`);
    if (!brief.theme?.trim()) throw new Error(`Brief ${index + 1} is missing theme.`);
  }
  if (!briefs.length) {
    output({ generated: 0, message: 'Draft-inclusive coverage has no deterministic gaps. Review existing drafts before generating more.' });
    return;
  }
  if (!hasFlag('apply')) {
    dryRun('generate-topics', { actor: actor.username, paidModelCalls: `At least ${briefs.length * 2} evaluator calls`, briefs });
    return;
  }
  const results = [];
  for (const [index, brief] of briefs.entries()) {
    try {
      const result = await generateTopicCardDrafts({ theme: brief.theme, activityMode: brief.activityMode, contextModule: brief.contextModule, count: 1, user: actor });
      results.push({ index: index + 1, brief, runId: result.runId, completed: result.completed, failed: result.failed, cardIds: result.cards.map((card) => card.id), failures: result.failures });
    } catch (error) {
      results.push({ index: index + 1, brief, completed: 0, failed: 1, error: error instanceof Error ? error.message : String(error) });
    }
  }
  output({ actor: actor.username, results });
}

function topicReviewExample(): void {
  output({
    reviews: [
      {
        cardId: 'topic-card-id',
        action: 'APPROVE',
        reason: 'Specific evidence covering mechanism, measurement, authenticity, safety, and distinct contribution.',
        checks: Object.fromEntries(TOPIC_APPROVAL_CHECKS.map((check) => [check, check === 'engineeringCompleteness' ? 'NOT_APPLICABLE' : 'PASS'])),
      },
      { cardId: 'weak-topic-card-id', action: 'REVISE', reason: 'Measurement and student opening require correction.', card: { displayTitle: 'Complete TopicCardInput object' } },
      { cardId: 'bad-topic-card-id', action: 'REJECT', reason: 'Fundamental causal mismatch makes the premise invalid.' },
    ],
  });
}

function validateApprovalChecks(item: TopicReviewItem): void {
  const checks = item.checks ?? {};
  for (const key of TOPIC_APPROVAL_CHECKS) {
    const value = checks[key];
    if (key === 'engineeringCompleteness') {
      if (!['PASS', 'NOT_APPLICABLE'].includes(value)) throw new Error(`${item.cardId}: ${key} must be PASS or NOT_APPLICABLE.`);
    } else if (value !== 'PASS') {
      throw new Error(`${item.cardId}: ${key} must be PASS before approval.`);
    }
  }
}

async function topicReview(): Promise<void> {
  if (hasFlag('example')) return topicReviewExample();
  const actor = await adminActor();
  const plan = readJsonFile<{ reviews?: TopicReviewItem[] }>(requiredOption('input'));
  const reviews = plan.reviews ?? [];
  if (!reviews.length) throw new Error('Topic review plan has no reviews.');
  if (new Set(reviews.map((item) => item.cardId)).size !== reviews.length) throw new Error('Topic review plan contains duplicate card IDs.');
  const cards = await db.topicCard.findMany({ where: { id: { in: reviews.map((item) => item.cardId) } } });
  if (cards.length !== reviews.length) throw new Error(`Only ${cards.length}/${reviews.length} TopicCards exist.`);
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const approved = await db.topicCard.findMany({ where: { status: 'APPROVED' }, select: { id: true, displayTitle: true, coreMechanism: true, revisionOfId: true } });
  const plannedApprovalTitles = new Map<string, string>();
  const plannedApprovalMechanisms = new Map<string, string>();
  for (const item of reviews) {
    const card = cardById.get(item.cardId)!;
    if (!['APPROVE', 'REJECT', 'REVISE'].includes(item.action)) throw new Error(`${item.cardId}: invalid action ${item.action}.`);
    if (!item.reason?.trim() || item.reason.trim().length < 12) throw new Error(`${item.cardId}: reason must contain at least 12 characters.`);
    if (item.action === 'APPROVE') {
      if (card.status !== 'DRAFT') throw new Error(`${item.cardId}: only DRAFT cards may be approved by this CLI.`);
      validateApprovalChecks(item);
      const excludedRevisionRoot = card.revisionOfId;
      const duplicate = approved.find((other) => {
        if (other.id === excludedRevisionRoot || (excludedRevisionRoot && other.revisionOfId === excludedRevisionRoot)) return false;
        return normalizedKey(other.displayTitle) === normalizedKey(card.displayTitle)
          || normalizedKey(other.coreMechanism) === normalizedKey(card.coreMechanism);
      });
      if (duplicate) throw new Error(`${item.cardId}: exact normalized title/mechanism duplicate with approved card ${duplicate.id}.`);
      const titleKey = normalizedKey(card.displayTitle);
      const mechanismKey = normalizedKey(card.coreMechanism);
      const prior = plannedApprovalTitles.get(titleKey) ?? plannedApprovalMechanisms.get(mechanismKey);
      if (prior) throw new Error(`${item.cardId}: duplicates the title or mechanism of planned approval ${prior}.`);
      plannedApprovalTitles.set(titleKey, item.cardId);
      plannedApprovalMechanisms.set(mechanismKey, item.cardId);
    }
    if (item.action === 'REJECT' && !['DRAFT', 'REJECTED', 'APPROVED'].includes(card.status)) throw new Error(`${item.cardId}: status ${card.status} cannot be rejected by this CLI.`);
    if (item.action === 'REVISE') {
      if (!['DRAFT', 'REJECTED', 'APPROVED'].includes(card.status)) throw new Error(`${item.cardId}: status ${card.status} cannot be revised by this CLI.`);
      if (!item.card || typeof item.card !== 'object') throw new Error(`${item.cardId}: REVISE requires a complete card object.`);
      if (card.schemaVersion !== TOPIC_CARD_SCHEMA_V2 && item.card.schemaVersion !== TOPIC_CARD_SCHEMA_V2) throw new Error(`${item.cardId}: legacy revisions must upgrade to TopicCard V2.`);
      let errors: string[];
      try {
        errors = validateTopicCardInput(item.card);
      } catch (error) {
        throw new Error(`${item.cardId}: invalid TopicCardInput shape: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (errors.length) throw new Error(`${item.cardId}: revision fails deterministic validation: ${errors.join('; ')}`);
    }
  }
  if (!hasFlag('apply')) {
    dryRun('topic-review', { actor: actor.username, reviews: reviews.map(({ cardId, action, reason }) => ({ cardId, action, reason })) });
    return;
  }
  const results = [];
  for (const item of reviews) {
    if (item.action === 'REVISE') {
      const existing = cardById.get(item.cardId)!;
      const caseCount = await db.tutorTurnCase.count({ where: { topicCardId: item.cardId } });
      const target = existing.status === 'APPROVED' && caseCount > 0
        ? await createTopicCardRevision(item.cardId, actor)
        : existing;
      const source = { ...parseStored<JsonObject>(existing.sourceJson, {}), ...(item.card!.source ?? {}) };
      const compilerEvidence = { ...parseStored<JsonObject>(existing.compilerEvidenceJson, {}), ...(item.card!.compilerEvidence ?? {}) };
      const revisedInput: TopicCardInput = {
        ...item.card!,
        source,
        compilerEvidence,
        sourceCandidateId: item.card!.sourceCandidateId ?? existing.sourceCandidateId ?? undefined,
      };
      const card = await updateTopicCard(target.id, revisedInput, actor);
      results.push({ cardId: item.cardId, revisedCardId: card.id, action: item.action, status: card.status, revision: card.revision, revisionOfId: card.revisionOfId });
    } else {
      const card = await decideTopicCard(item.cardId, item.action, item.reason, actor);
      results.push({ cardId: item.cardId, action: item.action, status: card.status });
    }
  }
  output({ actor: actor.username, results, note: 'REVISE leaves the card in DRAFT and requires a fresh semantic review before approval.' });
}

function defaultSplit(profile: TutorCaseProfile): 'TRAIN' | 'PILOT' | 'EVAL' {
  if (['SMOKE_6', 'CALIBRATION_12', 'TRIAL_36'].includes(profile)) return 'PILOT';
  if (profile === 'EVAL_80') return 'EVAL';
  return 'TRAIN';
}

async function compileCases(): Promise<void> {
  const actor = await adminActor();
  const profile = requiredOption('profile') as TutorCaseProfile;
  if (!['SMOKE_6', 'CALIBRATION_12', 'TRIAL_36', 'FULL_180', 'EVAL_80', 'CUSTOM'].includes(profile)) throw new Error(`Invalid profile: ${profile}`);
  const split = (option('split', defaultSplit(profile)) ?? defaultSplit(profile)) as 'TRAIN' | 'PILOT' | 'EVAL';
  if (!['TRAIN', 'PILOT', 'EVAL'].includes(split)) throw new Error(`Invalid split: ${split}`);
  const reviewPolicy = option('review-policy', 'HUMAN_ANNOTATOR_REQUIRED') as 'HUMAN_ANNOTATOR_REQUIRED' | 'AI_DIRECT_TO_REVIEWER';
  if (!['HUMAN_ANNOTATOR_REQUIRED', 'AI_DIRECT_TO_REVIEWER'].includes(reviewPolicy)) throw new Error(`Invalid review policy: ${reviewPolicy}`);
  const counts = option('counts') ? parseJson<Record<number, number>>(option('counts')!, '--counts') : undefined;
  if (profile === 'CUSTOM' && !counts) throw new Error('CUSTOM profile requires --counts, for example --counts {"1":2,"4":2}.');
  const topicCardIds = option('topic-card-ids')?.split(',').map((value) => value.trim()).filter(Boolean);
  const approvedCount = await db.topicCard.count({ where: { status: 'APPROVED', ...(topicCardIds?.length ? { id: { in: topicCardIds } } : {}) } });
  const plan = { actor: actor.username, profile, split, reviewPolicy, counts, topicCardIds, approvedTopicCards: approvedCount, allowExistingRun: hasFlag('allow-existing') };
  if (!hasFlag('apply')) {
    dryRun('compile', plan);
    return;
  }
  const result = await compileTutorTurnCases({ profile, counts, split, topicCardIds, reviewPolicy, allowExistingRun: hasFlag('allow-existing'), user: actor });
  output({ actor: actor.username, runId: result.runId, caseCount: result.cases.length, promptVersion: result.promptVersion, topicCoverage: result.topicCoverage, coverageWarnings: result.coverageWarnings });
}

function modelConfig(slot: 'a' | 'b'): CandidateModelConfig {
  const prefix = slot === 'a' ? 'A' : 'B';
  const provider = option(`model-${slot}-provider`, process.env[`DATA_LAB_MODEL_${prefix}_PROVIDER`])?.trim();
  const model = option(`model-${slot}`, process.env[`DATA_LAB_MODEL_${prefix}`])?.trim();
  if (!provider || !model) throw new Error(`Model ${prefix} requires --model-${slot}-provider and --model-${slot}, or DATA_LAB_MODEL_${prefix}_PROVIDER / DATA_LAB_MODEL_${prefix}.`);
  if (!['openai', 'deepseek'].includes(provider)) throw new Error(`Model ${prefix} provider must be openai or deepseek; '${provider}' has no configured base URL route.`);
  const family = option(`model-${slot}-family`)?.trim();
  const tag = option(`model-${slot}-tag`)?.trim();
  return { provider, model, ...(family ? { family } : {}), ...(tag ? { tag } : {}) };
}

async function generateCandidates(): Promise<void> {
  const actor = await adminActor();
  const runId = requiredOption('run-id');
  const modelA = modelConfig('a');
  const modelB = modelConfig('b');
  const families = assertIndependentModelFamilies(modelA, modelB);
  createLLMProvider({ provider: modelA.provider, model: modelA.model, role: 'TUTOR' });
  createLLMProvider({ provider: modelB.provider, model: modelB.model, role: 'TUTOR' });
  const run = await db.bootstrapGenerationRun.findUnique({ where: { id: runId }, select: { id: true, kind: true, status: true, reviewPolicy: true } });
  if (!run || run.kind !== 'CASE_COMPILATION') throw new Error(`CASE_COMPILATION run not found: ${runId}`);
  const caseId = option('case-id');
  const limit = positiveInt('limit', 1000, 5000);
  const cases = await db.tutorTurnCase.findMany({ where: { generationRunId: runId, ...(caseId ? { id: caseId } : {}) }, orderBy: { createdAt: 'asc' } });
  if (caseId && !cases.length) throw new Error(`Case ${caseId} does not belong to run ${runId}.`);
  const resumable = cases.filter((item) => ['READY', 'NEEDS_REGEN', 'NEEDS_CRITIC'].includes(item.status)).slice(0, limit);
  const byStatus = Object.fromEntries([...new Set(cases.map((item) => item.status))].map((status) => [status, cases.filter((item) => item.status === status).length]));
  const plan = { actor: actor.username, runId, reviewPolicy: run.reviewPolicy, models: { A: modelA, B: modelB, families }, caseStatuses: byStatus, resumableCaseIds: resumable.map((item) => item.id) };
  if (!hasFlag('apply')) {
    dryRun('generate-candidates', plan);
    return;
  }
  const concurrency = positiveInt('concurrency', 1, 4);
  let cursor = 0;
  const results: Array<{ caseId: string; before: string; status: string; runId?: string; failedStages?: unknown; error?: string }> = [];
  const workers = Array.from({ length: Math.min(concurrency, resumable.length) }, async () => {
    while (cursor < resumable.length) {
      const current = resumable[cursor];
      cursor += 1;
      try {
        const result = current.status === 'NEEDS_CRITIC'
          ? await retryTutorCandidateCritics({ caseId: current.id, user: actor })
          : await generateTutorCandidates({ caseId: current.id, modelA, modelB, user: actor });
        results.push({ caseId: current.id, before: current.status, status: result.status, runId: result.runId, failedStages: result.failedStages });
      } catch (error) {
        results.push({ caseId: current.id, before: current.status, status: 'FAILED', error: error instanceof Error ? error.message : String(error) });
      }
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => cases.findIndex((item) => item.id === a.caseId) - cases.findIndex((item) => item.id === b.caseId));
  output({ actor: actor.username, runId, processed: results.length, results });
}

async function latestCandidatePair(caseId: string) {
  const candidates = await db.tutorCandidate.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } });
  const runIds = [...new Set(candidates.map((candidate) => candidate.generationRunId).filter((value): value is string => Boolean(value)))];
  for (const runId of runIds) {
    const pair = candidates.filter((candidate) => candidate.generationRunId === runId);
    const a = pair.find((candidate) => candidate.slot === 'A');
    const b = pair.find((candidate) => candidate.slot === 'B');
    if (a && b) return [a, b].sort((left, right) => left.slot.localeCompare(right.slot));
  }
  return [];
}

async function firstReviewPacket(): Promise<void> {
  const runId = requiredOption('run-id');
  const run = await db.bootstrapGenerationRun.findUnique({ where: { id: runId }, select: { id: true, kind: true, reviewPolicy: true, aiDirectAuthorizedById: true, createdAt: true } });
  if (!run || run.kind !== 'CASE_COMPILATION') throw new Error(`CASE_COMPILATION run not found: ${runId}`);
  const statuses = hasFlag('all') ? undefined : ['IN_REVIEW'];
  const cases = await db.tutorTurnCase.findMany({
    where: { generationRunId: runId, ...(statuses ? { status: { in: statuses } } : {}) },
    orderBy: { createdAt: 'asc' },
    include: { topicCard: { select: { id: true, displayTitle: true, subject: true, coreMechanism: true } }, reviewTasks: { orderBy: { createdAt: 'asc' } } },
  });
  const packetCases = [];
  for (const caseItem of cases) {
    const pair = await latestCandidatePair(caseItem.id);
    const editTask = caseItem.reviewTasks.find((task) => task.type === 'EDIT');
    const confirmTask = caseItem.reviewTasks.find((task) => task.type === 'CONFIRM');
    packetCases.push({
      id: caseItem.id,
      revision: caseItem.revision,
      revisionOfId: caseItem.revisionOfId,
      status: caseItem.status,
      phase: caseItem.phase,
      triggerType: caseItem.triggerType,
      studentMessage: caseItem.studentMessage,
      history: parseStored(caseItem.historyJson, []),
      visibleFacts: parseStored(caseItem.visibleFactsJson, {}),
      privateReviewSpec: parseStored(caseItem.privateReviewSpecJson, {}),
      hardCheck: parseStored(caseItem.hardCheckJson, {}),
      topicCard: caseItem.topicCard,
      candidateGenerationRunId: pair[0]?.generationRunId ?? null,
      candidates: pair.map((candidate) => ({
        id: candidate.id,
        slot: candidate.slot,
        provider: candidate.provider,
        modelFamily: candidate.modelFamily,
        externalModelId: candidate.externalModelId,
        rawOutput: candidate.rawOutput,
        normalizedOutput: candidate.normalizedOutput ? parseStored(candidate.normalizedOutput, candidate.normalizedOutput) : null,
        deterministicCheck: parseStored(candidate.deterministicCheckJson, {}),
        critique: parseStored(candidate.critiqueJson, {}),
        status: candidate.status,
      })),
      editTask: editTask ? { id: editTask.id, status: editTask.status, assignedToId: editTask.assignedToId, leaseExpiresAt: editTask.leaseExpiresAt, decision: editTask.decision, reason: editTask.reason, submissionMode: editTask.submissionMode } : null,
      confirmTask: confirmTask ? { id: confirmTask.id, status: confirmTask.status, decision: confirmTask.decision, reason: confirmTask.reason } : null,
    });
  }
  output({ packetVersion: 1, generatedAt: new Date().toISOString(), run, cases: packetCases });
}

function firstReviewExample(): void {
  output({
    runId: 'case-compilation-run-id',
    reviews: [
      {
        caseId: 'case-id',
        caseRevision: 1,
        candidateGenerationRunId: 'candidate-generation-run-id',
        decision: 'EDIT',
        selectedSlot: 'A',
        finalOutput: { dialogue: '...', interactionType: 'clarification', focus: 'allowed-focus-id', hints: [] },
        reason: 'Specific case-grounded comparison and edit rationale.',
        preferenceRejectedSlot: 'B',
        preferenceReason: 'Why the final draft is materially better than B.',
      },
      {
        caseId: 'broken-case-id',
        caseRevision: 1,
        candidateGenerationRunId: 'candidate-generation-run-id',
        decision: 'RETURN_CASE',
        reason: 'The student message contradicts the visible knowledge state.',
        caseIssue: { categories: ['KNOWLEDGE_STATE_CONTRADICTION'], suggestedStudentMessage: '...', note: 'Exact contradiction.' },
      },
    ],
  });
}

function candidateCheck(candidate: { deterministicCheckJson: string }) {
  return parseStored<{ hardErrorCount?: number; warningCount?: number; issues?: unknown[] }>(candidate.deterministicCheckJson, { hardErrorCount: 1 });
}

async function submitFirstReview(): Promise<void> {
  if (hasFlag('example')) return firstReviewExample();
  const actor = await adminActor();
  const plan = readJsonFile<{ runId?: string; reviews?: FirstReviewItem[] }>(requiredOption('input'));
  const runId = plan.runId?.trim();
  const reviews = plan.reviews ?? [];
  if (!runId) throw new Error('First-review plan requires runId.');
  if (!reviews.length) throw new Error('First-review plan has no reviews.');
  if (new Set(reviews.map((item) => item.caseId)).size !== reviews.length) throw new Error('First-review plan contains duplicate case IDs.');
  const run = await db.bootstrapGenerationRun.findUnique({ where: { id: runId }, select: { kind: true, reviewPolicy: true, aiDirectAuthorizedById: true } });
  if (!run || run.kind !== 'CASE_COMPILATION') throw new Error(`CASE_COMPILATION run not found: ${runId}`);
  if (run.reviewPolicy !== 'AI_DIRECT_TO_REVIEWER' || !run.aiDirectAuthorizedById) throw new Error('The batch was not explicitly compiled with AI_DIRECT_TO_REVIEWER.');
  if (run.aiDirectAuthorizedById !== actor.id) throw new Error(`Actor ${actor.username} is not the admin who authorized AI-direct first review for this batch.`);
  const cases = await db.tutorTurnCase.findMany({ where: { id: { in: reviews.map((item) => item.caseId) } }, include: { reviewTasks: true } });
  if (cases.length !== reviews.length) throw new Error(`Only ${cases.length}/${reviews.length} cases exist.`);
  const caseById = new Map(cases.map((item) => [item.id, item]));
  const prepared = [];
  for (const review of reviews) {
    const caseItem = caseById.get(review.caseId)!;
    if (caseItem.generationRunId !== runId) throw new Error(`${review.caseId}: case belongs to another compilation run.`);
    if (caseItem.revision !== review.caseRevision) throw new Error(`${review.caseId}: stale case revision ${review.caseRevision}; current revision is ${caseItem.revision}.`);
    if (caseItem.status !== 'IN_REVIEW') throw new Error(`${review.caseId}: status is ${caseItem.status}, expected IN_REVIEW.`);
    if (!review.reason?.trim() || review.reason.trim().length < 12) throw new Error(`${review.caseId}: reason must contain at least 12 characters.`);
    const task = caseItem.reviewTasks.find((item) => item.type === 'EDIT');
    if (!task || !['PENDING', 'RETURNED', 'IN_PROGRESS'].includes(task.status)) throw new Error(`${review.caseId}: no claimable EDIT task.`);
    if (task.status === 'IN_PROGRESS' && task.assignedToId && task.assignedToId !== actor.id && task.leaseExpiresAt && task.leaseExpiresAt > new Date()) {
      throw new Error(`${review.caseId}: EDIT task is actively leased to another operator.`);
    }
    if (!['SELECT_A', 'SELECT_B', 'MERGE', 'EDIT', 'RETURN_CASE', 'REGENERATE', 'REGRESSION', 'NEGATIVE', 'REJECT'].includes(review.decision)) throw new Error(`${review.caseId}: invalid decision ${review.decision}.`);
    const pair = await latestCandidatePair(review.caseId);
    const candidateRunId = pair[0]?.generationRunId ?? null;
    if (!review.candidateGenerationRunId || review.candidateGenerationRunId !== candidateRunId) throw new Error(`${review.caseId}: stale or missing candidateGenerationRunId.`);
    if (pair.length !== 2) throw new Error(`${review.caseId}: latest A/B pair is incomplete.`);
    const selected = review.selectedSlot ? pair.find((candidate) => candidate.slot === review.selectedSlot) : undefined;
    const rejected = review.preferenceRejectedSlot ? pair.find((candidate) => candidate.slot === review.preferenceRejectedSlot) : undefined;
    let finalOutput: string | undefined;
    if (['SELECT_A', 'SELECT_B', 'MERGE', 'EDIT'].includes(review.decision)) {
      if (!selected) throw new Error(`${review.caseId}: ${review.decision} requires selectedSlot.`);
      if (review.decision === 'SELECT_A' && selected.slot !== 'A') throw new Error(`${review.caseId}: SELECT_A requires selectedSlot A.`);
      if (review.decision === 'SELECT_B' && selected.slot !== 'B') throw new Error(`${review.caseId}: SELECT_B requires selectedSlot B.`);
      finalOutput = review.finalOutput === undefined
        ? selected.normalizedOutput
        : typeof review.finalOutput === 'string' ? review.finalOutput : JSON.stringify(review.finalOutput);
      if (!finalOutput) throw new Error(`${review.caseId}: selected candidate has no valid normalized output; provide an edited finalOutput.`);
      if (['SELECT_A', 'SELECT_B'].includes(review.decision) && review.finalOutput !== undefined && finalOutput !== selected.normalizedOutput) {
        throw new Error(`${review.caseId}: changed output must use EDIT or MERGE, not ${review.decision}.`);
      }
      const visible = parseStored<{ allowedFocusIds?: string[] }>(caseItem.visibleFactsJson, {});
      const checked = checkTutorCandidate({ rawOutput: finalOutput, allowedFocusIds: visible.allowedFocusIds ?? [], phase: caseItem.phase, triggerType: caseItem.triggerType, studentMessage: caseItem.studentMessage });
      if (!checked.check.ok) throw new Error(`${review.caseId}: final output has hard errors: ${checked.check.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code).join(', ')}`);
    }
    if (rejected) {
      if (rejected.id === selected?.id) throw new Error(`${review.caseId}: selected and preference-rejected slots must differ.`);
      if ((candidateCheck(rejected).hardErrorCount ?? 1) > 0 || !rejected.normalizedOutput) throw new Error(`${review.caseId}: a hard-failed candidate cannot be a preference negative.`);
      if (!review.preferenceReason?.trim()) throw new Error(`${review.caseId}: preferenceReason is required when preferenceRejectedSlot is set.`);
    }
    if (review.decision === 'RETURN_CASE') {
      const categories = review.caseIssue?.categories ?? [];
      if (!categories.length || categories.some((category) => !TUTOR_CASE_ISSUE_CATEGORIES.includes(category as (typeof TUTOR_CASE_ISSUE_CATEGORIES)[number]))) {
        throw new Error(`${review.caseId}: RETURN_CASE requires valid caseIssue.categories.`);
      }
    }
    prepared.push({ review, caseItem, task, selected, rejected, finalOutput });
  }
  if (!hasFlag('apply')) {
    dryRun('submit-first-review', { actor: actor.username, runId, provenance: 'CODEX_AGENT_AUTHORIZED', reviews: prepared.map((item) => ({ caseId: item.review.caseId, decision: item.review.decision, selectedSlot: item.review.selectedSlot, preferenceRejectedSlot: item.review.preferenceRejectedSlot })) });
    return;
  }
  const results = [];
  for (const item of prepared) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    await db.$transaction(async (tx) => {
      const current = await tx.tutorReviewTask.findUnique({ where: { id: item.task.id } });
      if (!current || !['PENDING', 'RETURNED', 'IN_PROGRESS'].includes(current.status)) throw new Error(`${item.review.caseId}: EDIT task state changed before claim.`);
      if (current.status === 'IN_PROGRESS' && current.assignedToId && current.assignedToId !== actor.id && current.leaseExpiresAt && current.leaseExpiresAt > now) {
        throw new Error(`${item.review.caseId}: EDIT task was claimed by another operator.`);
      }
      await tx.tutorReviewTask.update({ where: { id: current.id }, data: { assignedToId: actor.id, leaseExpiresAt, status: 'IN_PROGRESS' } });
    });
    const result = await submitEditReview({
      taskId: item.task.id,
      decision: item.review.decision,
      selectedCandidateId: item.selected?.id,
      finalOutput: item.finalOutput,
      reason: `${AI_DISCLOSURE}\n${item.review.reason.trim()}`,
      preferenceRejectedCandidateId: item.rejected?.id,
      preferenceReason: item.rejected ? item.review.preferenceReason : undefined,
      submissionMode: 'AI_DIRECT_ADMIN_AUTHORIZED',
      caseIssue: item.review.caseIssue,
      user: actor,
    });
    results.push({ caseId: item.review.caseId, decision: item.review.decision, status: result.status });
  }
  output({ actor: actor.username, runId, provenance: 'CODEX_AGENT_AUTHORIZED', results, finalReview: 'HUMAN_REQUIRED' });
}

async function caseReturnReport(): Promise<void> {
  const runId = option('run-id');
  const tasks = (await listTutorCaseQualityTasks()).filter((task) => !runId || task.case.generationRunId === runId);
  const items = tasks.map((task) => ({
    taskId: task.id,
    caseId: task.caseId,
    generationRunId: task.case.generationRunId,
    caseRevision: task.case.revision,
    phase: task.case.phase,
    triggerType: task.case.triggerType,
    studentMessage: task.case.studentMessage,
    topicCard: task.case.topicCard,
    reviewPolicy: task.case.generationRun?.reviewPolicy,
    reason: task.reason,
    issue: parseStored(task.caseIssueJson, {}),
    createdAt: task.createdAt,
  }));
  const categoryCounts: Record<string, number> = {};
  for (const item of items) {
    const categories = (item.issue as { categories?: unknown[] }).categories ?? [];
    for (const category of categories) if (typeof category === 'string') categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  }
  output({ count: items.length, categoryCounts, items, action: 'REPORT_ONLY', note: 'This skill does not resolve admin case-quality tasks.' });
}

function help(): void {
  console.log(`Hyacintech Data Lab Curator

Read-only:
  status
  topic-gaps [--limit N]
  topic-packet [--status DRAFT[,REJECTED]] [--limit N] [--out file]
  first-review-packet --run-id id [--all] [--out file]
  case-return-report [--run-id id] [--out file]

Mutating (preview by default; add --apply):
  generate-topics --actor admin [--limit N] [--briefs file] [--apply]
  topic-review --actor admin --input plan.json [--apply]
  compile --actor admin --profile PROFILE [--split SPLIT] [--counts JSON]
          [--topic-card-ids id,id] [--review-policy POLICY] [--allow-existing] [--apply]
  generate-candidates --actor admin --run-id id
          --model-a-provider provider --model-a model
          --model-b-provider provider --model-b model
          [--model-a-family family] [--model-b-family family]
          [--case-id id] [--limit N] [--concurrency 1..4] [--apply]
  submit-first-review --actor admin --input plan.json [--apply]

Examples:
  topic-review --example
  submit-first-review --example

Profiles: SMOKE_6, CALIBRATION_12, TRIAL_36, FULL_180, EVAL_80, CUSTOM
Review policies: HUMAN_ANNOTATOR_REQUIRED, AI_DIRECT_TO_REVIEWER`);
}

async function main(): Promise<void> {
  switch (args.command) {
    case 'help':
    case '--help':
    case '-h': return help();
    case 'status': return status();
    case 'topic-gaps': return topicGaps();
    case 'topic-packet': return topicPacket();
    case 'generate-topics': return generateTopics();
    case 'topic-review': return topicReview();
    case 'compile': return compileCases();
    case 'generate-candidates': return generateCandidates();
    case 'first-review-packet': return firstReviewPacket();
    case 'submit-first-review': return submitFirstReview();
    case 'case-return-report': return caseReturnReport();
    default: throw new Error(`Unknown command: ${args.command}. Run help for usage.`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
