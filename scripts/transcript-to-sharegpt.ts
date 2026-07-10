#!/usr/bin/env tsx
/**
 * Convert blind-eval transcript JSON into ShareGPT SFT records.
 *
 * The converter is intentionally conservative by default: it treats transcript
 * outputs as positive SFT examples only when a whole phase segment is clean.
 * Violating or parse-failed segments are skipped rather than repaired.
 *
 * Examples:
 *   npx tsx scripts/transcript-to-sharegpt.ts --source-tag dsv4-smoke --out data/sft/sharegpt-auto-smoke.json --phases 1,2,4,5
 *   npx tsx scripts/transcript-to-sharegpt.ts --source-tag dsv4-a,dsv4-b --only-clean true
 *   npx tsx scripts/transcript-to-sharegpt.ts --source-file data/blind-eval/transcript-dsv4-smoke.json --pure true
 */
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { ChatResponse } from '../app/models/types';
import { PERSONAS } from './persona-library';
import { evaluateTranscriptSegmentSemantic } from './semantic-guardrails';

const BLIND_EVAL_DIR = path.join(process.cwd(), 'data/blind-eval');
const DEFAULT_OUT = path.join(process.cwd(), 'data/sft/sharegpt-from-transcripts.json');
const TRANSCRIPT_SCHEMA_VERSION = 2;
const FALLBACKS = new Set([
  '抱歉，AI服务返回了空内容，请重试。',
  '抱歉，AI回复格式出现异常，请重试。',
  '抱歉，我暂时无法处理您的请求，请重新描述您的问题。',
]);

const ALL_PHASES = [1, 2, 3, 4, 5, 6] as const;
type Phase = typeof ALL_PHASES[number];
type From = 'human' | 'gpt';
type DataTier = 'gold_candidate' | 'silver' | 'needs_review' | 'reject';
type ReviewStatus = 'unreviewed' | 'ai_reviewed' | 'human_reviewed' | 'accepted' | 'rejected';
type TierMode = 'conservative' | 'all-silver';

type ScenarioKind = 'persona' | 'phase3' | 'phase4' | 'phase5' | 'phase6' | 'fixed-regression' | string;

interface Violation {
  rule: string;
  detail: string;
}

interface TurnRecord {
  id: string;
  scenarioId: string;
  scenarioName: string;
  phase: number;
  turn: number;
  userMsg: string;
  raw: string;
  parsed: ChatResponse;
  parseOk: boolean;
  actionType: string;
  structuredFields: string[];
  violations: Violation[];
}

interface ScenarioRecord {
  id: string;
  name: string;
  kind: ScenarioKind;
  meta?: {
    personaId?: string;
    subject?: string;
    studentType?: string;
    difficulty?: string;
    failureModes?: string[];
    expectedTransformation?: unknown;
  };
  turns: TurnRecord[];
}

interface Transcript {
  schemaVersion: number;
  tag: string;
  createdAt: string;
  scope: 'smoke' | 'full' | string;
  modelConfig?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  scenarios: ScenarioRecord[];
}

interface ShareGPTMessage {
  from: From;
  value: string;
}

interface ShareGPTRecord {
  id: string;
  source: string;
  scenario: string;
  phase: Phase;
  rubricTargets: string[];
  evidence: string[];
  qualityNotes: string;
  conversations: ShareGPTMessage[];
  meta?: {
    sourceTag: string;
    transcriptSchemaVersion: number;
    scenarioId: string;
    scenarioKind: string;
    personaId?: string;
    subject?: string;
    studentType?: string;
    difficulty?: string;
    failureModes?: string[];
    expectedTransformation?: unknown;
    clean: boolean;
    violationRules: string[];
    tier: DataTier;
    reviewStatus: ReviewStatus;
    gradeReasons: string[];
    batchId: string;
  };
}

interface ConverterOptions {
  sourceTags: string[];
  sourceFiles: string[];
  out: string;
  phases: Phase[];
  onlyClean: boolean;
  skipFallback: boolean;
  minTurns: number;
  scenario?: string;
  includeKinds: Set<string>;
  pure: boolean;
  batchId: string;
  tierMode: TierMode;
  emitReviewManifest: boolean;
  reviewOut: string;
  includeNeedsReview: boolean;
}

interface SegmentSkip {
  reason: string;
  transcriptTag: string;
  scenarioId: string;
  scenarioName: string;
  phase: Phase;
  tier: Extract<DataTier, 'needs_review' | 'reject'>;
  turnIds: string[];
  violationRules: string[];
}

interface ManifestRecord {
  id: string;
  tier: DataTier;
  reviewStatus: ReviewStatus;
  gradeReasons: string[];
  sourceTag: string;
  scenarioId: string;
  scenarioName: string;
  phase: Phase;
  subject?: string;
  studentType?: string;
  difficulty?: string;
  failureModes?: string[];
  outputFile?: string;
}

interface ReviewManifest {
  schemaVersion: 1;
  batchId: string;
  createdAt: string;
  inputs: string[];
  options: Record<string, unknown>;
  summary: ReturnType<typeof summarize>;
  records: ManifestRecord[];
  skipped: SegmentSkip[];
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/transcript-to-sharegpt.ts --source-tag <tag[,tag...]> [options]
  npx tsx scripts/transcript-to-sharegpt.ts --source-file <path[,path...]> [options]

Options:
  --out <path>                 Default: data/sft/sharegpt-from-transcripts.json
  --phases <1,2,3,4,5,6>       Default: 1,2,3,4,5,6
  --only-clean true|false      Default: true. Skip segments with parse failures/violations/hard-rule failures.
  --skip-fallback true|false   Default: true. Skip parser fallback apology turns.
  --min-turns <n>              Default: 1 human/gpt pairs per phase segment.
  --scenario <id-or-name>      Optional scenario id/name/personaId filter.
  --include-kinds <list>       Default: persona,phase3,phase4,phase5,phase6,fixed-regression
  --pure true|false            Default: false. If true, output only { conversations } records.
  --batch-id <id>              Default: derived from source tags/files. Written to record meta and manifest.
  --tier-mode <mode>           conservative|all-silver. Default: conservative.
  --emit-review-manifest <bool> Default: true. Write review manifest.
  --review-out <path>          Default: data/sft/review-manifest-<batchId>.json
  --include-needs-review <bool> Default: false. Include needs_review records in ShareGPT output.

Examples:
  npx tsx scripts/transcript-to-sharegpt.ts --source-tag dsv4-smoke --out data/sft/sharegpt-auto-smoke.json --phases 1,2,4,5
  npx tsx scripts/transcript-to-sharegpt.ts --source-tag qwen-smoke --out data/sft/sharegpt-auto-qwen-clean.json --only-clean true
`);
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const value = args[i + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error(`${flag} 需要参数`);
  return value;
}

function parseBool(args: string[], flag: string, defaultValue: boolean): boolean {
  const value = flagValue(args, flag);
  if (value === undefined) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${flag} 必须是 true 或 false`);
}


function parseTierMode(args: string[]): TierMode {
  const value = flagValue(args, '--tier-mode') ?? 'conservative';
  if (value === 'conservative' || value === 'all-silver') return value;
  throw new Error('--tier-mode 必须是 conservative 或 all-silver');
}

function defaultBatchId(sourceTags: string[], sourceFiles: string[]): string {
  const source = sourceTags.length ? sourceTags.join('-') : sourceFiles.map((f) => path.basename(f, '.json')).join('-');
  return safeFilePart(source || 'transcript-batch');
}

function parsePositiveInt(args: string[], flag: string, defaultValue: number): number {
  const value = flagValue(args, flag);
  if (value === undefined) return defaultValue;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} 必须是正整数`);
  return n;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parsePhases(args: string[]): Phase[] {
  const raw = splitCsv(flagValue(args, '--phases'));
  if (raw.length === 0) return [...ALL_PHASES];
  const phases = raw.map((x) => Number(x));
  for (const phase of phases) {
    if (!ALL_PHASES.includes(phase as Phase)) throw new Error(`--phases 不支持阶段: ${phase}`);
  }
  return [...new Set(phases as Phase[])];
}

function parseOptions(args: string[]): ConverterOptions {
  const sourceTags = splitCsv(flagValue(args, '--source-tag'));
  const sourceFiles = splitCsv(flagValue(args, '--source-file'));
  if (sourceTags.length === 0 && sourceFiles.length === 0) {
    throw new Error('需要 --source-tag 或 --source-file');
  }
  if (sourceTags.length > 0 && sourceFiles.length > 0) {
    throw new Error('--source-tag 和 --source-file 二选一');
  }
  const includeKinds = new Set(splitCsv(flagValue(args, '--include-kinds')));
  if (includeKinds.size === 0) {
    for (const kind of ['persona', 'phase3', 'phase4', 'phase5', 'phase6', 'fixed-regression']) includeKinds.add(kind);
  }
  const batchId = safeFilePart(flagValue(args, '--batch-id') ?? defaultBatchId(sourceTags, sourceFiles));
  return {
    sourceTags,
    sourceFiles,
    out: path.resolve(flagValue(args, '--out') ?? DEFAULT_OUT),
    phases: parsePhases(args),
    onlyClean: parseBool(args, '--only-clean', true),
    skipFallback: parseBool(args, '--skip-fallback', true),
    minTurns: parsePositiveInt(args, '--min-turns', 1),
    scenario: flagValue(args, '--scenario'),
    includeKinds,
    pure: parseBool(args, '--pure', false),
    batchId,
    tierMode: parseTierMode(args),
    emitReviewManifest: parseBool(args, '--emit-review-manifest', true),
    reviewOut: path.resolve(flagValue(args, '--review-out') ?? path.join(process.cwd(), 'data/sft', `review-manifest-${batchId}.json`)),
    includeNeedsReview: parseBool(args, '--include-needs-review', false),
  };
}

function safeFilePart(value: string): string {
  const original = value.trim().toLowerCase();
  const ascii = original
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const hash = createHash('sha1').update(value).digest('hex').slice(0, 10);
  if (!ascii || ascii.length < 3) return `x-${hash}`;
  const changed = ascii !== original;
  const base = ascii.slice(0, changed ? 68 : 80).replace(/-+$/g, '');
  return changed ? `${base}-${hash}` : base;
}

function sourcePaths(options: ConverterOptions): string[] {
  if (options.sourceFiles.length > 0) return options.sourceFiles.map((f) => path.resolve(f));
  return options.sourceTags.map((tag) => path.join(BLIND_EVAL_DIR, `transcript-${tag}.json`));
}

async function readTranscript(file: string): Promise<Transcript> {
  const raw = await readFile(file, 'utf8');
  const transcript = JSON.parse(raw) as Transcript;
  if (!Array.isArray(transcript.scenarios)) throw new Error(`${file} 不是有效 transcript：缺少 scenarios`);
  if (transcript.schemaVersion !== TRANSCRIPT_SCHEMA_VERSION) {
    throw new Error(`${file} schemaVersion 不兼容：需要 ${TRANSCRIPT_SCHEMA_VERSION}，实际 ${transcript.schemaVersion}`);
  }
  return transcript;
}


const LEGACY_PERSONA_ALIASES: Record<string, string> = {
  '配合型': 'cooperative-light-color',
  '模糊型': 'fuzzy-yogurt-temperature',
  '一次给全型': 'all-at-once-salt-germination',
  '工程项目型': 'engineering-watering-threshold',
  '高概念降级型': 'high-concept-mars-light',
  '现实问题抽象型': 'real-world-classroom-shade-heat',
  '工程保真型': 'engineering-smart-shade-threshold',
};

function hydrateScenarioMeta(scenario: ScenarioRecord): ScenarioRecord {
  if (scenario.meta?.personaId) return scenario;
  if (scenario.kind !== 'persona') return scenario;
  const personaId = LEGACY_PERSONA_ALIASES[scenario.name];
  if (!personaId) return scenario;
  const persona = PERSONAS.find((p) => p.id === personaId);
  if (!persona) return scenario;
  return {
    ...scenario,
    meta: {
      personaId: persona.id,
      subject: persona.subject,
      studentType: persona.studentType,
      difficulty: persona.difficulty,
      failureModes: persona.failureModes,
      expectedTransformation: persona.expectedTransformation,
    },
  };
}

function groupTurnsByPhase(turns: TurnRecord[]): Map<Phase, TurnRecord[]> {
  const out = new Map<Phase, TurnRecord[]>();
  for (const turn of turns) {
    if (!ALL_PHASES.includes(turn.phase as Phase)) continue;
    const phase = turn.phase as Phase;
    const existing = out.get(phase) ?? [];
    existing.push(turn);
    out.set(phase, existing);
  }
  for (const [phase, phaseTurns] of out.entries()) {
    out.set(phase, [...phaseTurns].sort((a, b) => a.turn - b.turn));
  }
  return out;
}

function scenarioIncluded(scenario: ScenarioRecord, options: ConverterOptions): boolean {
  if (!options.includeKinds.has(scenario.kind)) return false;
  if (!options.scenario) return true;
  return (
    scenario.id === options.scenario ||
    scenario.name === options.scenario ||
    scenario.meta?.personaId === options.scenario
  );
}

function hasNotesColumn(response: ChatResponse): boolean {
  return !!response.data_table_schema?.columns.some((c) => c.key === 'notes' && c.type === 'text');
}

function hasCompleteReportSections(response: ChatResponse): boolean {
  const sections = response.report_sections;
  if (!sections) return false;
  return ['purpose', 'hypothesis', 'materials', 'procedure', 'dataSummary', 'analysis']
    .every((key) => String(sections[key as keyof typeof sections] ?? '').trim().length > 0);
}

function isFallbackTurn(turn: TurnRecord): boolean {
  return FALLBACKS.has(turn.parsed?.dialogue ?? '');
}

function basicTurnProblem(turn: TurnRecord, options: ConverterOptions): string | null {
  if (turn.parseOk !== true) return 'parse-failed';
  if (!turn.parsed || typeof turn.parsed.dialogue !== 'string' || !turn.parsed.dialogue.trim()) return 'missing-dialogue';
  if (options.skipFallback && isFallbackTurn(turn)) return 'fallback-dialogue';
  if (options.onlyClean && (turn.violations?.length ?? 0) > 0) return `violations:${turn.violations.map((v) => v.rule).join(',')}`;
  return null;
}

function phaseHardProblem(phase: Phase, turns: TurnRecord[]): string | null {
  if (phase === 1) {
    for (const turn of turns) {
      if (turn.parsed.next_action_type === 'ask_choice' || (turn.parsed.options?.length ?? 0) > 0) return 'phase1-options-or-ask-choice';
    }
    const confirmations = turns.filter((turn) => turn.parsed.next_action_type === 'confirmation');
    for (const turn of confirmations) {
      const r = turn.parsed;
      if (!r.stage1_confirmed || !r.theme_mapping || !r.snapshot?.trim() || !r.variables?.independent?.trim()) {
        return 'phase1-confirmation-missing-fields';
      }
    }
  }

  if (phase === 2) {
    const confirmations = turns.filter((turn) => turn.parsed.next_action_type === 'confirmation');
    for (const turn of confirmations) {
      const r = turn.parsed;
      if (!r.data_table_schema) return 'phase2-confirmation-missing-schema';
      if (!hasNotesColumn(r)) return 'phase2-schema-missing-notes';
      if (r.data_table_schema.maxRows !== 200) return 'phase2-schema-maxRows-not-200';
    }
  }

  if (phase === 5 && !turns.some((turn) => hasCompleteReportSections(turn.parsed))) {
    return 'phase5-missing-report-sections';
  }

  return null;
}

function semanticSegmentProblem(scenario: ScenarioRecord, phase: Phase, turns: TurnRecord[]): string | null {
  const result = evaluateTranscriptSegmentSemantic({
    phase,
    scenario: scenario.name,
    meta: scenario.meta,
    turns,
  });
  if (result.status === 'ok') return null;
  return result.reason ?? `semantic-${result.status}:${scenario.meta?.personaId ?? scenario.id}`;
}

const NEEDS_REVIEW_RULES = new Set(['md-too-many-bold', 'md-list-marker']);
const REJECT_RULE_PATTERNS = [
  /^p1-hidden-abc-options$/,
  /^p1-proxy-drift$/,
  /^p1-theme-loss$/,
  /^p1-lost-original-theme$/,
  /^p1-boundary-/,
  /^p1-confirm-no-doc$/,
  /^p2-confirm-no-schema$/,
];

function problemTier(problem: string, turns: TurnRecord[]): Extract<DataTier, 'needs_review' | 'reject'> {
  if (problem.startsWith('semantic-proxy-drift:')) return 'reject';
  if (problem.startsWith('semantic-missing-')) return 'needs_review';
  if (problem.startsWith('violations:')) {
    const rules = violationRules(turns);
    if (rules.length > 0 && rules.every((rule) => NEEDS_REVIEW_RULES.has(rule))) return 'needs_review';
    if (rules.some((rule) => REJECT_RULE_PATTERNS.some((pattern) => pattern.test(rule)))) return 'reject';
    return 'needs_review';
  }
  if (problem === 'phase5-missing-report-sections' && turns.some((turn) => turn.parsed.dialogue?.trim())) return 'needs_review';
  if (problem.includes('missing-fields') || problem.includes('missing-schema') || problem.includes('missing-notes') || problem.includes('maxRows')) return 'needs_review';
  return 'reject';
}

function gradeCleanRecord(scenario: ScenarioRecord, phase: Phase, options: ConverterOptions): { tier: Extract<DataTier, 'gold_candidate' | 'silver'>; reasons: string[] } {
  if (options.tierMode === 'all-silver') return { tier: 'silver', reasons: ['tier-mode:all-silver'] };
  const reasons: string[] = [];
  const studentType = scenario.meta?.studentType;
  const subject = scenario.meta?.subject;
  const failureModes = scenario.meta?.failureModes ?? [];
  if (scenario.meta?.difficulty === 'hard') reasons.push('difficulty:hard');
  if (studentType && ['high_concept', 'engineering_project', 'safety_risk', 'variable_confusion', 'over_broad', 'premature_details'].includes(studentType)) {
    reasons.push(`studentType:${studentType}`);
  }
  for (const mode of failureModes) {
    if (['proxy_drift', 'theme_loss', 'weak_confirmation_doc', 'engineering_flattening', 'safety_softness', 'variable_confusion'].includes(mode)) {
      reasons.push(`failureMode:${mode}`);
    }
  }
  if ((phase === 1 || phase === 2) && ['engineering_automation', 'high_concept_interdisciplinary'].includes(subject ?? '')) {
    reasons.push(`phase${phase}:high-value-subject:${subject}`);
  }
  return reasons.length > 0 ? { tier: 'gold_candidate', reasons } : { tier: 'silver', reasons: ['clean:routine'] };
}

function segmentProblem(scenario: ScenarioRecord, phase: Phase, turns: TurnRecord[], options: ConverterOptions): string | null {
  if (turns.length < options.minTurns) return `too-few-turns:${turns.length}`;
  for (const turn of turns) {
    const problem = basicTurnProblem(turn, options);
    if (problem) return problem;
  }
  if (options.onlyClean) {
    const hardProblem = phaseHardProblem(phase, turns);
    if (hardProblem) return hardProblem;
  }
  const semanticProblem = semanticSegmentProblem(scenario, phase, turns);
  if (semanticProblem) return semanticProblem;
  return null;
}

function messagesFromTurns(turns: TurnRecord[]): ShareGPTMessage[] {
  const messages: ShareGPTMessage[] = [];
  for (const turn of turns) {
    messages.push({ from: 'human', value: turn.userMsg });
    messages.push({ from: 'gpt', value: JSON.stringify(turn.parsed) });
  }
  return messages;
}

const FAILURE_TO_RUBRIC: Record<string, string[]> = {
  proxy_drift: ['proxy_quality', 'theme_fidelity'],
  theme_loss: ['theme_fidelity'],
  hidden_abc_choice: ['student_agency'],
  premature_stage2: ['stage_discipline'],
  over_questioning: ['cognitive_load_control'],
  weak_confirmation_doc: ['structure_compliance', 'transformation_reasoning'],
  engineering_flattening: ['interdisciplinary_integration', 'stem_fit'],
  safety_softness: ['safety'],
  variable_confusion: ['stem_fit', 'teaching_guidance'],
  format_discipline: ['expression', 'structure_compliance'],
};

const PHASE_TO_RUBRIC: Record<Phase, string[]> = {
  1: ['theme_fidelity', 'student_agency', 'proxy_quality', 'transformation_reasoning'],
  2: ['stage_discipline', 'stem_fit', 'safety', 'structure_compliance'],
  3: ['safety', 'stage_discipline', 'teaching_guidance'],
  4: ['teaching_guidance', 'student_agency', 'stem_fit'],
  5: ['structure_compliance', 'expression', 'stem_fit'],
  6: ['teaching_guidance', 'student_agency', 'expression'],
};

function inferRubricTargets(scenario: ScenarioRecord, phase: Phase): string[] {
  const targets = new Set(PHASE_TO_RUBRIC[phase]);
  for (const mode of scenario.meta?.failureModes ?? []) {
    for (const target of FAILURE_TO_RUBRIC[mode] ?? []) targets.add(target);
  }
  return [...targets].sort();
}

function violationRules(turns: TurnRecord[]): string[] {
  return [...new Set(turns.flatMap((turn) => (turn.violations ?? []).map((v) => v.rule)))].sort();
}

function qualityNotes(scenario: ScenarioRecord, phase: Phase, clean: boolean): string {
  const modes = scenario.meta?.failureModes?.length ? ` Failure modes: ${scenario.meta.failureModes.join(', ')}.` : '';
  const transform = scenario.meta?.expectedTransformation ? ' Includes expectedTransformation metadata.' : '';
  return `Auto-converted ${clean ? 'clean' : 'unfiltered'} transcript phase ${phase} segment.${modes}${transform}`;
}

function makeRecord(
  transcript: Transcript,
  scenario: ScenarioRecord,
  phase: Phase,
  turns: TurnRecord[],
  options: ConverterOptions,
  override?: { tier: DataTier; reasons: string[] }
): ShareGPTRecord {
  const rules = violationRules(turns);
  const clean = turns.every((turn) => turn.parseOk && rules.length === 0 && !isFallbackTurn(turn));
  const grade = override ?? gradeCleanRecord(scenario, phase, options);
  const id = [
    'stem-transcript',
    safeFilePart(transcript.tag),
    safeFilePart(scenario.id),
    `p${phase}`,
    'v1',
  ].join('-');
  return {
    id,
    source: `transcript_${transcript.tag}`,
    scenario: scenario.name,
    phase,
    rubricTargets: inferRubricTargets(scenario, phase),
    evidence: [`data/blind-eval/transcript-${transcript.tag}.json:${scenario.id}:p${phase}`],
    qualityNotes: `${qualityNotes(scenario, phase, clean)} Tier: ${grade.tier}. Reasons: ${grade.reasons.join('; ')}.`,
    conversations: messagesFromTurns(turns),
    meta: {
      sourceTag: transcript.tag,
      transcriptSchemaVersion: transcript.schemaVersion,
      scenarioId: scenario.id,
      scenarioKind: scenario.kind,
      personaId: scenario.meta?.personaId,
      subject: scenario.meta?.subject,
      studentType: scenario.meta?.studentType,
      difficulty: scenario.meta?.difficulty,
      failureModes: scenario.meta?.failureModes,
      expectedTransformation: scenario.meta?.expectedTransformation,
      clean,
      violationRules: rules,
      tier: grade.tier,
      reviewStatus: 'unreviewed',
      gradeReasons: grade.reasons,
      batchId: options.batchId,
    },
  };
}

function convertTranscript(transcript: Transcript, options: ConverterOptions) {
  const records: ShareGPTRecord[] = [];
  const skipped: SegmentSkip[] = [];
  for (const rawScenario of transcript.scenarios) {
    const scenario = hydrateScenarioMeta(rawScenario);
    if (!scenarioIncluded(scenario, options)) continue;
    const grouped = groupTurnsByPhase(scenario.turns ?? []);
    for (const phase of options.phases) {
      const turns = grouped.get(phase);
      if (!turns?.length) continue;
      const problem = segmentProblem(scenario, phase, turns, options);
      if (problem) {
        const tier = problemTier(problem, turns);
        skipped.push({
          reason: problem,
          transcriptTag: transcript.tag,
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          phase,
          tier,
          turnIds: turns.map((turn) => turn.id),
          violationRules: violationRules(turns),
        });
        if (!(tier === 'needs_review' && options.includeNeedsReview)) continue;
      }
      records.push(makeRecord(
        transcript,
        scenario,
        phase,
        turns,
        options,
        problem ? { tier: problemTier(problem, turns), reasons: [`needs-review:${problem}`] } : undefined
      ));
    }
  }
  return { records, skipped };
}

function dedupeRecords(records: ShareGPTRecord[]): ShareGPTRecord[] {
  const seen = new Map<string, number>();
  return records.map((record) => {
    const count = seen.get(record.id) ?? 0;
    seen.set(record.id, count + 1);
    if (count === 0) return record;
    return { ...record, id: `${record.id}-${count + 1}` };
  });
}

function pureRecords(records: ShareGPTRecord[]) {
  return records.map((record) => ({ conversations: record.conversations }));
}

function increment(map: Record<string, number>, key: string | undefined) {
  const k = key?.trim() || 'unknown';
  map[k] = (map[k] ?? 0) + 1;
}

function summarize(records: ShareGPTRecord[], skipped: SegmentSkip[], includeNeedsReview = false) {
  const byTier: Record<string, number> = {};
  const byPhase: Record<string, number> = {};
  const bySubject: Record<string, number> = {};
  const byStudentType: Record<string, number> = {};
  const byFailureMode: Record<string, number> = {};
  const skipReasons: Record<string, number> = {};
  for (const record of records) {
    increment(byTier, record.meta?.tier);
    increment(byPhase, `P${record.phase}`);
    increment(bySubject, record.meta?.subject);
    increment(byStudentType, record.meta?.studentType);
    for (const mode of record.meta?.failureModes?.length ? record.meta.failureModes : ['none']) {
      increment(byFailureMode, mode);
    }
  }
  for (const item of skipped) {
    if (!(includeNeedsReview && item.tier === 'needs_review')) increment(byTier, item.tier);
    increment(skipReasons, item.reason);
    increment(byPhase, `P${item.phase}`);
  }
  return {
    totalRecords: records.length,
    skipped: skipped.length,
    byTier,
    byPhase,
    bySubject,
    byStudentType,
    byFailureMode,
    skipReasons,
  };
}

function manifestRecord(record: ShareGPTRecord, outputFile: string): ManifestRecord {
  return {
    id: record.id,
    tier: record.meta?.tier ?? 'silver',
    reviewStatus: record.meta?.reviewStatus ?? 'unreviewed',
    gradeReasons: record.meta?.gradeReasons ?? [],
    sourceTag: record.meta?.sourceTag ?? record.source.replace(/^transcript_/, ''),
    scenarioId: record.meta?.scenarioId ?? 'unknown',
    scenarioName: record.scenario,
    phase: record.phase,
    subject: record.meta?.subject,
    studentType: record.meta?.studentType,
    difficulty: record.meta?.difficulty,
    failureModes: record.meta?.failureModes,
    outputFile,
  };
}

function manifestOptions(options: ConverterOptions): Record<string, unknown> {
  return {
    sourceTags: options.sourceTags,
    sourceFiles: options.sourceFiles,
    out: options.out,
    phases: options.phases,
    onlyClean: options.onlyClean,
    skipFallback: options.skipFallback,
    minTurns: options.minTurns,
    scenario: options.scenario,
    includeKinds: [...options.includeKinds],
    pure: options.pure,
    batchId: options.batchId,
    tierMode: options.tierMode,
    emitReviewManifest: options.emitReviewManifest,
    reviewOut: options.reviewOut,
    includeNeedsReview: options.includeNeedsReview,
  };
}

function buildReviewManifest(
  options: ConverterOptions,
  inputs: string[],
  records: ShareGPTRecord[],
  skipped: SegmentSkip[],
  outputFile: string
): ReviewManifest {
  return {
    schemaVersion: 1,
    batchId: options.batchId,
    createdAt: new Date().toISOString(),
    inputs,
    options: manifestOptions(options),
    summary: summarize(records, skipped, options.includeNeedsReview),
    records: records.map((record) => manifestRecord(record, outputFile)),
    skipped,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const options = parseOptions(args);
  const inputs = sourcePaths(options);
  const allRecords: ShareGPTRecord[] = [];
  const allSkipped: SegmentSkip[] = [];
  for (const file of inputs) {
    const transcript = await readTranscript(file);
    const { records, skipped } = convertTranscript(transcript, options);
    allRecords.push(...records);
    allSkipped.push(...skipped);
  }

  const records = dedupeRecords(allRecords);
  await mkdir(path.dirname(options.out), { recursive: true });
  const payload = options.pure ? pureRecords(records) : records;
  await writeFile(options.out, `${JSON.stringify(payload, null, 2)}
`, 'utf8');

  if (options.emitReviewManifest) {
    await mkdir(path.dirname(options.reviewOut), { recursive: true });
    const manifest = buildReviewManifest(options, inputs, records, allSkipped, options.out);
    await writeFile(options.reviewOut, `${JSON.stringify(manifest, null, 2)}
`, 'utf8');
  }

  const summary = summarize(records, allSkipped, options.includeNeedsReview);
  console.log(`Wrote ${options.out}`);
  if (options.emitReviewManifest) console.log(`Wrote ${options.reviewOut}`);
  console.log(JSON.stringify(summary, null, 2));
  if (allSkipped.length > 0) {
    console.log('Skipped samples (first 20):');
    for (const item of allSkipped.slice(0, 20)) {
      console.log(`  ${item.transcriptTag} ${item.scenarioId} P${item.phase}: ${item.reason}`);
    }
  }
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
