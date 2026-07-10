import type { ChatResponse } from '../app/models/types';
import {
  PERSONAS,
  type ExpectedTransformation,
  type SemanticTermGroup,
  type StemPersona,
} from './persona-library';

export type SemanticGuardrailStatus = 'ok' | 'needs_review' | 'reject';

export interface SemanticGuardrailResult {
  status: SemanticGuardrailStatus;
  reason?: string;
  personaId?: string;
  details: string[];
}

export interface SemanticMeta {
  personaId?: string;
  subject?: string;
  studentType?: string;
  failureModes?: string[];
  expectedTransformation?: unknown;
}

export interface SemanticTurn {
  userMsg?: string;
  parsed?: Partial<ChatResponse> | null;
}

export interface SemanticMessage {
  from: 'human' | 'gpt';
  value: string;
}

export interface SemanticShareGPTRecord {
  id: string;
  source?: string;
  scenario?: string;
  phase?: number;
  qualityNotes?: string;
  conversations: SemanticMessage[];
  meta?: SemanticMeta;
}

interface SemanticEvaluationInput {
  phase: number;
  scenario?: string;
  meta?: SemanticMeta;
  assistantText: string;
  confirmationText: string;
}

const FALLBACK_PERSONA_BY_SCENARIO: Array<[RegExp, string]> = [
  [/自动浇花器/, 'engineering-watering-threshold'],
  [/火星基地植物|火星基地.*植物|高概念降级型/, 'high-concept-mars-light'],
  [/智能遮光系统|工程保真型/, 'engineering-smart-shade-threshold'],
];

const REVIEW_OR_NEGATIVE_MARKERS = /negative|repair|反例|修正|proxy[-_]drift[-_]repair/i;

function ok(personaId?: string, details: string[] = []): SemanticGuardrailResult {
  return { status: 'ok', personaId, details };
}

function reject(reason: string, personaId: string, details: string[]): SemanticGuardrailResult {
  return { status: 'reject', reason, personaId, details };
}

function needsReview(reason: string, personaId: string, details: string[]): SemanticGuardrailResult {
  return { status: 'needs_review', reason, personaId, details };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringifyUnknown(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

function assistantTextFromParsed(parsed: Partial<ChatResponse> | null | undefined): string {
  if (!parsed) return '';
  return [
    parsed.dialogue,
    stringifyUnknown(parsed.hints),
    stringifyUnknown(parsed.options),
    stringifyUnknown(parsed.theme_mapping),
    parsed.snapshot,
    stringifyUnknown(parsed.variables),
    stringifyUnknown(parsed.data_table_schema),
    stringifyUnknown(parsed.report_sections),
    stringifyUnknown(parsed.risks),
  ]
    .filter(Boolean)
    .join('\n');
}

function parsedAssistantFromMessage(value: string): Partial<ChatResponse> | null {
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? (parsed as Partial<ChatResponse>) : null;
  } catch {
    return null;
  }
}

function resolvePersona(meta: SemanticMeta | undefined, scenario: string | undefined): StemPersona | undefined {
  if (meta?.personaId) {
    const byId = PERSONAS.find((persona) => persona.id === meta.personaId);
    if (byId) return byId;
  }

  const scenarioName = scenario?.trim();
  if (scenarioName) {
    const byName = PERSONAS.find((persona) => scenarioName.includes(persona.name) || persona.name.includes(scenarioName));
    if (byName) return byName;
    const alias = FALLBACK_PERSONA_BY_SCENARIO.find(([pattern]) => pattern.test(scenarioName))?.[1];
    if (alias) return PERSONAS.find((persona) => persona.id === alias);
  }

  return undefined;
}

function expectedFromMeta(meta: SemanticMeta | undefined, persona: StemPersona | undefined): ExpectedTransformation | undefined {
  const metaExpected = isObject(meta?.expectedTransformation) ? meta?.expectedTransformation : undefined;
  const base = persona?.expectedTransformation;
  if (!base && !metaExpected) return undefined;
  return {
    ...(base ?? {}),
    ...(metaExpected ?? {}),
  } as ExpectedTransformation;
}

function termGroupMatches(text: string, group: SemanticTermGroup): boolean {
  const normalized = normalizeText(text);
  const terms = Array.isArray(group) ? group : [group];
  return terms.every((term) => normalized.includes(normalizeText(term)));
}

function anyGroupMatches(text: string, groups: SemanticTermGroup[] | undefined): boolean {
  return !!groups?.length && groups.some((group) => termGroupMatches(text, group));
}

function unmatchedTerms(text: string, terms: string[] | undefined): string[] {
  if (!terms?.length) return [];
  const normalized = normalizeText(text);
  return terms.filter((term) => normalized.includes(normalizeText(term)));
}

function exactPhraseGroup(value: string | undefined): SemanticTermGroup[] {
  const text = value?.trim();
  return text ? [text] : [];
}

function isHighRisk(meta: SemanticMeta | undefined, persona: StemPersona | undefined): boolean {
  const subject = meta?.subject ?? persona?.subject;
  const studentType = meta?.studentType ?? persona?.studentType;
  const modes = new Set([...(persona?.failureModes ?? []), ...(meta?.failureModes ?? [])]);
  return (
    subject === 'engineering_automation' ||
    subject === 'high_concept_interdisciplinary' ||
    studentType === 'engineering_project' ||
    studentType === 'high_concept' ||
    modes.has('proxy_drift') ||
    modes.has('theme_loss') ||
    modes.has('engineering_flattening')
  );
}

function semanticReasonSuffix(persona: StemPersona | undefined, meta: SemanticMeta | undefined): string {
  return persona?.id ?? meta?.personaId ?? 'unknown';
}

function evaluateSemanticGuardrails(input: SemanticEvaluationInput): SemanticGuardrailResult {
  if (input.phase !== 1 && input.phase !== 2) return ok();

  const persona = resolvePersona(input.meta, input.scenario);
  const expected = expectedFromMeta(input.meta, persona);
  const personaId = semanticReasonSuffix(persona, input.meta);
  if (!expected && !persona) return ok();

  const forbidden = unmatchedTerms(input.assistantText, expected?.forbiddenProxyTerms);
  if (forbidden.length > 0) {
    return reject(`semantic-proxy-drift:${personaId}`, personaId, [`forbiddenProxyTerms:${forbidden.join(',')}`]);
  }

  if (input.phase !== 1) return ok(personaId);

  const confirmationText = input.confirmationText.trim() ? input.confirmationText : input.assistantText;
  if (!confirmationText.trim() || !isHighRisk(input.meta, persona)) return ok(personaId);

  const coreGroups = expected?.mustKeepTerms?.length ? expected.mustKeepTerms : exactPhraseGroup(expected?.independentVariable);
  if (coreGroups.length > 0 && !anyGroupMatches(confirmationText, coreGroups)) {
    return needsReview(`semantic-missing-core:${personaId}`, personaId, [`expectedAny:${stringifyUnknown(coreGroups)}`]);
  }

  const proxyGroups = expected?.proxyTerms ?? [];
  if (proxyGroups.length > 0 && !anyGroupMatches(confirmationText, proxyGroups)) {
    return needsReview(`semantic-missing-proxy:${personaId}`, personaId, [`expectedAny:${stringifyUnknown(proxyGroups)}`]);
  }

  return ok(personaId);
}

export function evaluateTranscriptSegmentSemantic(input: {
  phase: number;
  scenario?: string;
  meta?: SemanticMeta;
  turns: SemanticTurn[];
}): SemanticGuardrailResult {
  const assistantText = input.turns.map((turn) => assistantTextFromParsed(turn.parsed)).join('\n');
  const confirmationText = input.turns
    .filter((turn) => turn.parsed?.next_action_type === 'confirmation' || turn.parsed?.stage1_confirmed)
    .map((turn) => assistantTextFromParsed(turn.parsed))
    .join('\n');

  return evaluateSemanticGuardrails({
    phase: input.phase,
    scenario: input.scenario,
    meta: input.meta,
    assistantText,
    confirmationText,
  });
}

export function isSemanticRepairRecord(record: Pick<SemanticShareGPTRecord, 'id' | 'source' | 'scenario' | 'qualityNotes'>): boolean {
  return REVIEW_OR_NEGATIVE_MARKERS.test([
    record.id,
    record.source,
    record.scenario,
    record.qualityNotes,
  ].filter(Boolean).join('\n'));
}

export function evaluateShareGPTRecordSemantic(record: SemanticShareGPTRecord): SemanticGuardrailResult {
  if (isSemanticRepairRecord(record)) return ok(record.meta?.personaId, ['semantic-repair-record']);

  const parsedMessages = record.conversations
    .filter((message) => message.from === 'gpt')
    .map((message) => ({ raw: message.value, parsed: parsedAssistantFromMessage(message.value) }));

  const assistantText = parsedMessages
    .map((message) => assistantTextFromParsed(message.parsed) || message.raw)
    .join('\n');
  const confirmationText = parsedMessages
    .filter((message) => message.parsed?.next_action_type === 'confirmation' || message.parsed?.stage1_confirmed)
    .map((message) => assistantTextFromParsed(message.parsed))
    .join('\n');

  return evaluateSemanticGuardrails({
    phase: record.phase ?? 0,
    scenario: record.scenario,
    meta: record.meta,
    assistantText,
    confirmationText,
  });
}
