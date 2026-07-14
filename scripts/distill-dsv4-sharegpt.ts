#!/usr/bin/env tsx
/**
 * Distill DeepSeek V4 Pro into ShareGPT-style STEM tutor samples.
 *
 * The pipeline is intentionally split into three steps:
 *   1. plan     Build a deterministic 450-700 item task plan across six phases.
 *   2. generate Call the teacher model for raw ShareGPT-like records.
 *   3. clean    Normalize, validate, tier, and split generated records.
 *
 * Examples:
 *   npx tsx scripts/distill-dsv4-sharegpt.ts plan --target 600
 *   DEEPSEEK_API_KEY=... LLM_PROVIDER=deepseek LLM_MODEL=deepseek-v4-pro LLM_MAX_TOKENS=6000 \
 *     npx tsx scripts/distill-dsv4-sharegpt.ts generate --limit 30
 *   npx tsx scripts/distill-dsv4-sharegpt.ts clean
 */
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { repairJson } from '../app/lib/llm/jsonRepair';
import { safeParseChatResponse } from '../app/lib/llm/parser';
import { createLLMProvider, validateConfig } from '../app/lib/llm/provider';
import type { LLMMessage } from '../app/lib/llm/types';
import type { ChatResponse } from '../app/models/types';
import {
  PERSONAS,
  type ExpectedTransformation,
  type FailureMode,
  type StemPersona,
  type SubjectArea,
  type StudentType,
} from './persona-library';
import { evaluateShareGPTRecordSemantic } from './semantic-guardrails';

const OUT_DIR = path.join(process.cwd(), 'data/sft');
const DEFAULT_PLAN = path.join(OUT_DIR, 'distill-plan-dsv4.json');
const DEFAULT_RAW = path.join(OUT_DIR, 'sharegpt-distill-dsv4-raw.json');
const DEFAULT_CLEAN = path.join(OUT_DIR, 'sharegpt-distill-dsv4-clean.json');
const DEFAULT_GOLD_CANDIDATE = path.join(OUT_DIR, 'sharegpt-distill-dsv4-gold-candidate.json');
const DEFAULT_SILVER = path.join(OUT_DIR, 'sharegpt-distill-dsv4-silver.json');
const DEFAULT_REJECTED = path.join(OUT_DIR, 'sharegpt-distill-dsv4-rejected.json');
const DEFAULT_MANIFEST = path.join(OUT_DIR, 'review-manifest-distill-dsv4.json');
const TOPIC_LIBRARY = path.join(process.cwd(), 'data/topic-library.json');
const PLAN_SCHEMA_VERSION = 1;
const RAW_SCHEMA_VERSION = 1;
const MANIFEST_SCHEMA_VERSION = 1;
const DEFAULT_TARGET = 600;

const PHASES = [1, 2, 3, 4, 5, 6] as const;
type Phase = typeof PHASES[number];
type From = 'human' | 'gpt';
type DataTier = 'gold_candidate' | 'silver' | 'needs_review' | 'reject';
type ReviewStatus = 'unreviewed' | 'ai_reviewed' | 'human_reviewed' | 'accepted' | 'rejected';
type SourceKind = 'persona' | 'topic-library';

interface TopicLibraryFile {
  examples?: TopicExample[];
}

interface TopicExample {
  id: string;
  paradigm?: 'inquiry' | 'engineering' | string;
  title: string;
  subjectTags?: string[];
  gradeBand?: string;
  questionStem?: string;
  independentVariable?: string;
  dependentVariable?: string;
  engineeringTranslation?: string;
  safetyNote?: string;
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
  meta: {
    sourceTag: string;
    distillTaskId: string;
    sourceKind: SourceKind;
    personaId?: string;
    topicId?: string;
    subject?: SubjectArea | string;
    studentType?: StudentType | string;
    difficulty?: string;
    failureModes?: FailureMode[];
    expectedTransformation?: ExpectedTransformation;
    tier: DataTier;
    reviewStatus: ReviewStatus;
    gradeReasons: string[];
    batchId: string;
  };
}

interface DistillTask {
  id: string;
  phase: Phase;
  sourceKind: SourceKind;
  scenario: string;
  variant: number;
  priority: 'critical' | 'high' | 'medium' | 'routine';
  tierHint: Extract<DataTier, 'gold_candidate' | 'silver'>;
  rubricTargets: string[];
  focus: string[];
  studentProfile: string;
  targetTurns: number;
  persona?: {
    id: string;
    name: string;
    subject: SubjectArea;
    studentType: StudentType;
    difficulty: StemPersona['difficulty'];
    failureModes: FailureMode[];
    expectedTransformation: ExpectedTransformation;
    phase1: string[];
    phase2: string[];
  };
  topic?: TopicExample;
  priorSummary: string;
}

interface DistillPlan {
  schemaVersion: typeof PLAN_SCHEMA_VERSION;
  createdAt: string;
  target: number;
  quota: Record<`P${Phase}`, number>;
  options: Record<string, unknown>;
  tasks: DistillTask[];
}

interface RawGeneration {
  taskId: string;
  generatedAt: string;
  modelConfig: {
    provider: string | null;
    model: string | null;
    baseURL: string | null;
    timeoutMs: string | null;
    maxTokens: string | null;
  };
  raw: string;
  error?: string;
}

interface RawGenerationFile {
  schemaVersion: typeof RAW_SCHEMA_VERSION;
  createdAt: string;
  planFile: string;
  records: RawGeneration[];
}

interface CleanRejectedRecord {
  taskId: string;
  phase: Phase;
  scenario: string;
  tier: Extract<DataTier, 'needs_review' | 'reject'>;
  reasons: string[];
  raw?: string;
}

interface ReviewManifestRecord {
  id: string;
  taskId: string;
  tier: DataTier;
  reviewStatus: ReviewStatus;
  gradeReasons: string[];
  sourceKind: SourceKind;
  phase: Phase;
  scenario: string;
  personaId?: string;
  topicId?: string;
  subject?: string;
  studentType?: string;
  failureModes?: FailureMode[];
  outputFile?: string;
}

interface ReviewManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  batchId: string;
  createdAt: string;
  planFile: string;
  rawFile: string;
  outputs: {
    clean: string;
    goldCandidate: string;
    silver: string;
    rejected: string;
  };
  summary: {
    totalRaw: number;
    clean: number;
    goldCandidate: number;
    silver: number;
    needsReview: number;
    rejected: number;
    byPhase: Record<string, number>;
    rejectReasons: Record<string, number>;
  };
  records: ReviewManifestRecord[];
  rejected: CleanRejectedRecord[];
}

interface PlanOptions {
  target: number;
  out: string;
}

interface GenerateOptions {
  plan: string;
  rawOut: string;
  limit?: number;
  offset: number;
  phase?: Phase;
  onlyMissing: boolean;
  jsonFormat: boolean;
  dryRun: boolean;
}

interface CleanOptions {
  plan: string;
  raw: string;
  cleanOut: string;
  goldCandidateOut: string;
  silverOut: string;
  rejectedOut: string;
  manifestOut: string;
  batchId: string;
}

const PHASE_WEIGHTS: Record<Phase, number> = {
  1: 0.35,
  2: 0.28,
  3: 0.09,
  4: 0.13,
  5: 0.09,
  6: 0.06,
};

const PHASE_RUBRIC: Record<Phase, string[]> = {
  1: ['theme_fidelity', 'student_agency', 'proxy_quality', 'transformation_reasoning', 'cognitive_load_control'],
  2: ['stage_discipline', 'stem_fit', 'safety', 'structure_compliance', 'cognitive_load_control'],
  3: ['safety', 'stage_discipline', 'teaching_guidance', 'structure_compliance'],
  4: ['teaching_guidance', 'student_agency', 'stem_fit', 'cognitive_load_control'],
  5: ['structure_compliance', 'expression', 'stem_fit'],
  6: ['teaching_guidance', 'student_agency', 'expression'],
};

const FAILURE_TO_RUBRIC: Record<FailureMode, string[]> = {
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

const STUDENT_PROFILES = [
  '配合但需要保留学生自己表述，不要替学生定题',
  '兴趣模糊，只能问一个推动思考的开放问题',
  '一次给很多细节，需要先确认阶段边界',
  '高概念主题，需要保留原主题的机制或困难',
  '工程作品导向，需要转成设计参数与表现指标',
  '有安全风险，需要温和纠正并给可做替代',
  '变量混乱，需要用一句话澄清自变量/因变量',
  '低投入回答，需要给轻量脚手架但不代做',
];

const PHASE_FOCUS: Record<Phase, string[]> = {
  1: [
    '不使用 ask_choice 或 options',
    '不提供 ABC 选题菜单',
    '保留原始兴趣中的机制、约束或困难',
    '确认时必须输出 theme_mapping、snapshot、variables.independent',
    '一轮只问一个核心开放问题',
  ],
  2: [
    '按“自变量梯度 -> 因变量测量 -> 控制变量 -> 数据表”推进',
    '不要提前分析结论',
    '确认时必须输出 data_table_schema，包含 notes 列，maxRows=200',
    '安全风险要写进 dialogue 或 risks',
  ],
  3: [
    '强调真实记录、异常记录和安全检查',
    '不要替学生编造未观察到的数据',
    '必要时给 safety_quiz 或操作前提醒',
  ],
  4: [
    '引导学生描述趋势、比较组间差异和解释可能原因',
    '不把相关性说成绝对因果',
    '提出一个下一步分析问题',
  ],
  5: [
    '输出 report_sections 六个字段',
    '报告文字要贴合已有研究问题、方法和数据',
    '不编造没有出现的材料和数据',
  ],
  6: [
    '引导反思误差、改进和迁移应用',
    '保持学生主体性，不替学生写完整长篇总结',
    '提出一个可执行的下次改进方向',
  ],
};

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/distill-dsv4-sharegpt.ts plan [--target 450..700] [--out <path>]
  npx tsx scripts/distill-dsv4-sharegpt.ts generate [--plan <path>] [--raw-out <path>] [--limit N] [--offset N] [--phase 1..6] [--only-missing true|false] [--json-format true|false] [--dry-run true|false]
  npx tsx scripts/distill-dsv4-sharegpt.ts clean [--plan <path>] [--raw <path>] [--clean-out <path>] [--gold-candidate-out <path>] [--silver-out <path>] [--rejected-out <path>] [--manifest-out <path>]

Generate env:
  LLM_PROVIDER=deepseek
  DEEPSEEK_API_KEY=<key>
  DEEPSEEK_API_BASE=https://api.deepseek.com
  LLM_MODEL=deepseek-v4-pro
  LLM_TIMEOUT_MS=180000
  LLM_MAX_TOKENS=6000
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

function parsePositiveInt(args: string[], flag: string): number | undefined {
  const value = flagValue(args, flag);
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} 必须是正整数`);
  return n;
}

function parseNonNegativeInt(args: string[], flag: string, defaultValue: number): number {
  const value = flagValue(args, flag);
  if (value === undefined) return defaultValue;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} 必须是非负整数`);
  return n;
}

function parsePhase(args: string[], flag = '--phase'): Phase | undefined {
  const value = flagValue(args, flag);
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!PHASES.includes(n as Phase)) throw new Error(`${flag} 必须是 1..6`);
  return n as Phase;
}

function parsePlanOptions(args: string[]): PlanOptions {
  const target = parsePositiveInt(args, '--target') ?? DEFAULT_TARGET;
  if (target < 450 || target > 700) throw new Error('--target 建议并限制在 450..700');
  return {
    target,
    out: path.resolve(flagValue(args, '--out') ?? DEFAULT_PLAN),
  };
}

function parseGenerateOptions(args: string[]): GenerateOptions {
  return {
    plan: path.resolve(flagValue(args, '--plan') ?? DEFAULT_PLAN),
    rawOut: path.resolve(flagValue(args, '--raw-out') ?? DEFAULT_RAW),
    limit: parsePositiveInt(args, '--limit'),
    offset: parseNonNegativeInt(args, '--offset', 0),
    phase: parsePhase(args),
    onlyMissing: parseBool(args, '--only-missing', true),
    jsonFormat: parseBool(args, '--json-format', false),
    dryRun: parseBool(args, '--dry-run', false),
  };
}

function parseCleanOptions(args: string[]): CleanOptions {
  return {
    plan: path.resolve(flagValue(args, '--plan') ?? DEFAULT_PLAN),
    raw: path.resolve(flagValue(args, '--raw') ?? DEFAULT_RAW),
    cleanOut: path.resolve(flagValue(args, '--clean-out') ?? DEFAULT_CLEAN),
    goldCandidateOut: path.resolve(flagValue(args, '--gold-candidate-out') ?? DEFAULT_GOLD_CANDIDATE),
    silverOut: path.resolve(flagValue(args, '--silver-out') ?? DEFAULT_SILVER),
    rejectedOut: path.resolve(flagValue(args, '--rejected-out') ?? DEFAULT_REJECTED),
    manifestOut: path.resolve(flagValue(args, '--manifest-out') ?? DEFAULT_MANIFEST),
    batchId: flagValue(args, '--batch-id') ?? 'distill-dsv4',
  };
}

function safeFilePart(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned) return cleaned.slice(0, 80).replace(/-+$/g, '');
  return createHash('sha1').update(value).digest('hex').slice(0, 10);
}

function hashShort(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10);
}

async function readJsonFile<T>(file: string): Promise<T> {
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw) as T;
}

async function writeJsonFile(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function readTopicExamples(): Promise<TopicExample[]> {
  const file = await readJsonFile<TopicLibraryFile>(TOPIC_LIBRARY);
  return Array.isArray(file.examples) ? file.examples.filter((item) => item.id && item.title) : [];
}

function allocateQuota(target: number): Record<`P${Phase}`, number> {
  const exact = PHASES.map((phase) => ({ phase, value: target * PHASE_WEIGHTS[phase] }));
  const quota = Object.fromEntries(PHASES.map((phase) => [`P${phase}`, Math.floor(target * PHASE_WEIGHTS[phase])])) as Record<`P${Phase}`, number>;
  let remaining = target - Object.values(quota).reduce((sum, n) => sum + n, 0);
  const byRemainder = [...exact].sort((a, b) => (b.value % 1) - (a.value % 1));
  for (const item of byRemainder) {
    if (remaining <= 0) break;
    quota[`P${item.phase}`] += 1;
    remaining--;
  }
  return quota;
}

function rubricForTask(phase: Phase, persona: StemPersona | undefined): string[] {
  const out = new Set(PHASE_RUBRIC[phase]);
  for (const mode of persona?.failureModes ?? []) {
    for (const target of FAILURE_TO_RUBRIC[mode] ?? []) out.add(target);
  }
  return [...out].sort();
}

function priorityFor(phase: Phase, persona: StemPersona | undefined, topic: TopicExample | undefined): DistillTask['priority'] {
  if (phase === 1 || phase === 2) {
    if (
      persona?.subject === 'engineering_automation' ||
      persona?.subject === 'high_concept_interdisciplinary' ||
      persona?.studentType === 'engineering_project' ||
      persona?.studentType === 'high_concept' ||
      persona?.failureModes.some((mode) => ['proxy_drift', 'theme_loss', 'engineering_flattening', 'safety_softness'].includes(mode))
    ) {
      return 'critical';
    }
    return 'high';
  }
  if (topic?.paradigm === 'engineering') return 'high';
  if (phase === 4 || phase === 5) return 'medium';
  return 'routine';
}

function tierFor(priority: DistillTask['priority']): Extract<DataTier, 'gold_candidate' | 'silver'> {
  return priority === 'critical' || priority === 'high' ? 'gold_candidate' : 'silver';
}

function personaSummary(persona: StemPersona): DistillTask['persona'] {
  return {
    id: persona.id,
    name: persona.name,
    subject: persona.subject,
    studentType: persona.studentType,
    difficulty: persona.difficulty,
    failureModes: persona.failureModes,
    expectedTransformation: persona.expectedTransformation,
    phase1: persona.phase1,
    phase2: persona.phase2,
  };
}

function topicToExpected(topic: TopicExample): ExpectedTransformation {
  return {
    originalInterest: topic.title,
    retainedFeature: topic.engineeringTranslation ?? topic.questionStem ?? topic.title,
    classroomProxy: topic.engineeringTranslation ?? topic.questionStem ?? topic.title,
    researchQuestion: topic.questionStem ?? `围绕「${topic.title}」，改变一个条件会怎样影响观察结果？`,
    independentVariable: topic.independentVariable ?? '一个可人为改变的条件',
    dependentDirection: topic.dependentVariable ?? '可观察或可测量的结果',
    safetyNotes: topic.safetyNote ? [topic.safetyNote] : undefined,
  };
}

function topicSummary(topic: TopicExample): string {
  return [
    `主题：${topic.title}`,
    `题干：${topic.questionStem ?? '未提供'}`,
    `自变量：${topic.independentVariable ?? '待收敛'}`,
    `因变量：${topic.dependentVariable ?? '待定义'}`,
    topic.engineeringTranslation ? `工程转化：${topic.engineeringTranslation}` : '',
    topic.safetyNote ? `安全：${topic.safetyNote}` : '',
  ].filter(Boolean).join('\n');
}

function priorSummaryForTask(phase: Phase, persona: StemPersona | undefined, topic: TopicExample | undefined): string {
  const expected = persona?.expectedTransformation ?? (topic ? topicToExpected(topic) : undefined);
  if (!expected) return '无前序摘要。';
  const rows = persona?.stage3Rows?.length
    ? persona.stage3Rows.slice(0, 5).map((row) => JSON.stringify(row)).join('\n')
    : [
      '{"day":1,"group_a":0,"group_b":1,"group_c":2,"notes":""}',
      '{"day":2,"group_a":1,"group_b":3,"group_c":4,"notes":""}',
      '{"day":3,"group_a":2,"group_b":5,"group_c":6,"notes":"一个样本异常"}',
    ].join('\n');

  const base = [
    '【选题确认书】',
    `原始兴趣：${expected.originalInterest}`,
    `保留特征：${expected.retainedFeature}`,
    `课堂代理：${expected.classroomProxy}`,
    `研究问题：${expected.researchQuestion}`,
    `自变量：${expected.independentVariable}`,
    `因变量：${expected.dependentDirection}`,
  ].join('\n');

  if (phase <= 2) return base;
  if (phase === 3) return `${base}\n\n【方案摘要】学生已确定自变量梯度、因变量记录方式、控制变量和安全注意事项，即将开始实验。`;
  if (phase === 4) return `${base}\n\n【实验数据】\n${rows}`;
  if (phase === 5) return `${base}\n\n【实验数据】\n${rows}\n\n【分析摘要】学生已初步比较不同组趋势，需要整理成报告。`;
  return `${base}\n\n【报告摘要】学生已经完成报告，需要反思误差来源、改进方案和迁移应用。`;
}

function targetTurnsForPhase(phase: Phase): number {
  if (phase === 1) return 3;
  if (phase === 2) return 4;
  return 1;
}

function sourcePick(index: number, phase: Phase, topics: TopicExample[]): { persona?: StemPersona; topic?: TopicExample; sourceKind: SourceKind } {
  const highValuePersonas = PERSONAS.filter((persona) =>
    persona.subject === 'engineering_automation' ||
    persona.subject === 'high_concept_interdisciplinary' ||
    persona.failureModes.some((mode) => ['proxy_drift', 'theme_loss', 'safety_softness', 'variable_confusion'].includes(mode))
  );
  const personaPool = phase <= 2
    ? [...highValuePersonas, ...PERSONAS]
    : PERSONAS;
  const preferPersona = phase <= 2 ? index % 5 !== 4 : index % 3 !== 2;
  if (preferPersona || topics.length === 0) {
    return { persona: personaPool[index % personaPool.length], sourceKind: 'persona' };
  }
  return { topic: topics[index % topics.length], sourceKind: 'topic-library' };
}

function buildTask(phase: Phase, index: number, topics: TopicExample[]): DistillTask {
  const picked = sourcePick(index, phase, topics);
  const persona = picked.persona;
  const topic = picked.topic;
  const scenarioBase = persona?.name ?? topic?.title ?? `阶段${phase}通用任务`;
  const priority = priorityFor(phase, persona, topic);
  const variant = Math.floor(index / Math.max(1, PERSONAS.length)) + 1;
  const idBase = [
    `p${phase}`,
    picked.sourceKind === 'persona' ? persona?.id : topic?.id,
    `v${variant}`,
    hashShort(`${phase}:${index}:${scenarioBase}`),
  ].filter(Boolean).join('-');
  return {
    id: safeFilePart(idBase),
    phase,
    sourceKind: picked.sourceKind,
    scenario: `${scenarioBase}-蒸馏样本${variant}`,
    variant,
    priority,
    tierHint: tierFor(priority),
    rubricTargets: rubricForTask(phase, persona),
    focus: [
      ...PHASE_FOCUS[phase],
      persona?.failureModes.length ? `重点 failure modes：${persona.failureModes.join(', ')}` : '',
      topic?.paradigm ? `智慧教育平台主题范式：${topic.paradigm}` : '',
    ].filter(Boolean),
    studentProfile: STUDENT_PROFILES[index % STUDENT_PROFILES.length],
    targetTurns: targetTurnsForPhase(phase),
    persona: persona ? personaSummary(persona) : undefined,
    topic,
    priorSummary: priorSummaryForTask(phase, persona, topic),
  };
}

async function buildPlan(options: PlanOptions): Promise<DistillPlan> {
  const topics = await readTopicExamples();
  const quota = allocateQuota(options.target);
  const tasks: DistillTask[] = [];
  for (const phase of PHASES) {
    for (let i = 0; i < quota[`P${phase}`]; i++) {
      tasks.push(buildTask(phase, i, topics));
    }
  }
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    target: options.target,
    quota,
    options: {
      phaseWeights: PHASE_WEIGHTS,
      source: {
        personas: PERSONAS.length,
        topicLibrary: topics.length,
      },
    },
    tasks,
  };
}

function modelConfigSnapshot() {
  const config = validateConfig();
  return {
    provider: config.provider,
    model: config.model,
    baseURL: process.env.DEEPSEEK_API_BASE ?? process.env.OPENAI_API_BASE ?? null,
    timeoutMs: process.env.LLM_TIMEOUT_MS ?? null,
    maxTokens: process.env.LLM_MAX_TOKENS ?? null,
  };
}

function expectedBlock(task: DistillTask): string {
  const expected = task.persona?.expectedTransformation ?? (task.topic ? topicToExpected(task.topic) : undefined);
  if (!expected) return '无 expectedTransformation。';
  return JSON.stringify(expected, null, 2);
}

function sampleStudentLines(task: DistillTask): string {
  if (task.phase === 1 && task.persona?.phase1.length) return task.persona.phase1.join('\n');
  if (task.phase === 2 && task.persona?.phase2.length) return task.persona.phase2.join('\n');
  if (task.topic) return topicSummary(task.topic);
  return '请根据 priorSummary 自行构造自然的学生输入。';
}

function systemPrompt(): string {
  return [
    '你是用于蒸馏的 STEM 教学导师数据生成器。',
    '你必须生成可用于 ShareGPT SFT 的单条训练样本。',
    '目标不是炫技，而是在 context-grounded + pedagogy-constrained 的六阶段 STEM 工作流中稳定产出高质量教学行为。',
    '所有 assistant 消息必须符合项目 ChatResponse JSON 结构。',
    '只输出一个 JSON 对象，不要输出 Markdown，不要解释。',
  ].join('\n');
}

function userPrompt(task: DistillTask): string {
  return `请生成 1 条 ShareGPT 训练样本，严格返回如下 JSON：
{
  "record": {
    "scenario": "string",
    "phase": ${task.phase},
    "rubricTargets": ["string"],
    "qualityNotes": "string",
    "conversations": [
      { "from": "human", "value": "学生消息" },
      { "from": "gpt", "value": { "dialogue": "...", "next_action_type": "text_input", "options": [], "hints": [], "phase_complete": false } }
    ]
  }
}

硬性要求：
- conversations 必须从 human 开始，human/gpt 交替。
- conversations 数组中的每个元素只能包含一组 from/value；禁止把 human 和 gpt 合并进同一个对象。
- gpt.value 可以是 JSON 对象，不要转义成字符串；清洗脚本会统一转成字符串。
- 每个 gpt.value 必须能被 safeParseChatResponse 解析。
- 返回紧凑 JSON，不要 pretty-print；字符串内换行必须合法转义。
- 输出中禁止出现 JSON 外的自然语言、自我纠错、草稿说明或“重新生成”文字。
- 每个 dialogue 控制在 160 个中文字符以内，hints 最多 2 条，每条 40 字以内。
- conversations 生成 ${task.targetTurns} 组 human/gpt 对话；不要额外扩写。
- dialogue 不要用 Markdown 列表符号、标题、代码块、加粗。
- 阶段1禁止 ask_choice 和非空 options，不能给 ABC 选项。
- 阶段1确认时必须包含 stage1_confirmed=true、theme_mapping、snapshot、variables.independent。
- 阶段1/2 确认完成时 next_action_type 必须是 "confirmation"。
- 阶段2确认时必须包含 data_table_schema；每个 column 必须有 key/title/type/required，type 只能是 text/number/image；columns 里必须有 { "key": "notes", "title": "备注", "type": "text", "required": false }，maxRows 必须是 200。
- 阶段5必须在 gpt.value 顶层输出 report_sections 对象，不准只写在 dialogue 文本里；包含 purpose/hypothesis/materials/procedure/dataSummary/analysis，六个字段都不能为空；不确定的字段也要写“待学生补充：...”。
- 一轮只推动一个核心问题，避免一次问材料、分组、测量、控制变量。
- 阶段3若需要安全提醒，只保留 1 条关键安全提醒 + 1 个立即记录动作，不要用“首先/其次/第三/最后”堆叠说明。
- 阶段5不能说“我已经帮你整理好了/写好了完整报告”；只能提供报告框架和证据缺口，让学生补充。
- 阶段4/5/6 不直接替学生下最终结论，必须指向数据证据、局限或下一步修正。
- 少用“我帮你/我已经/为你生成/我来确认”这类替代学生行动的表达；改成“我们整理/请你确认/请按此记录/你已经明确...”。
- 不要编造危险操作；安全风险必须明确降级。

任务：
- taskId: ${task.id}
- phase: ${task.phase}
- scenario: ${task.scenario}
- tierHint: ${task.tierHint}
- studentProfile: ${task.studentProfile}
- targetTurns: ${task.targetTurns}
- rubricTargets: ${task.rubricTargets.join(', ')}
- focus:
${task.focus.map((item) => `  - ${item}`).join('\n')}

expectedTransformation:
${expectedBlock(task)}

前序摘要：
${task.priorSummary}

可参考学生素材：
${sampleStudentLines(task)}

输出要求：
- 只返回 JSON 对象。
- record.phase 必须等于 ${task.phase}。
- record.conversations 中 gpt.value 的 JSON 字段必须使用项目字段名，不要自行发明 schema。
- qualityNotes 写明这条样本训练的关键行为。`;
}

async function readRawFile(file: string, planFile: string): Promise<RawGenerationFile> {
  try {
    return await readJsonFile<RawGenerationFile>(file);
  } catch {
    return {
      schemaVersion: RAW_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      planFile,
      records: [],
    };
  }
}

function selectGenerateTasks(plan: DistillPlan, raw: RawGenerationFile, options: GenerateOptions): DistillTask[] {
  const done = new Set(raw.records
    .filter((record) => !record.error && isUsableRaw(record.raw))
    .map((record) => record.taskId));
  let tasks = plan.tasks;
  if (options.phase) tasks = tasks.filter((task) => task.phase === options.phase);
  if (options.onlyMissing) tasks = tasks.filter((task) => !done.has(task.id));
  if (options.offset > 0) tasks = tasks.slice(options.offset);
  if (options.limit !== undefined) tasks = tasks.slice(0, options.limit);
  return tasks;
}

async function runGenerate(options: GenerateOptions) {
  if (process.env.ALLOW_LEGACY_ONE_SHOT_DISTILL !== 'true') {
    throw new Error(
      '旧版 one-shot 蒸馏已停用：它会把 expectedTransformation 和前序答案暴露给同一个生成器。' +
      '请先运行 scripts/build-dataset-v3-plan.ts，再使用 scripts/distill-dataset-v3.ts；仅回放历史实验时才可显式设置 ALLOW_LEGACY_ONE_SHOT_DISTILL=true。'
    );
  }
  const plan = await readJsonFile<DistillPlan>(options.plan);
  const rawFile = await readRawFile(options.rawOut, options.plan);
  const tasks = selectGenerateTasks(plan, rawFile, options);
  if (options.dryRun) {
    console.log(JSON.stringify({
      selectedTasks: tasks.length,
      firstTask: tasks[0],
      firstPrompt: tasks[0] ? userPrompt(tasks[0]) : null,
    }, null, 2));
    return;
  }

  const provider = createLLMProvider();
  const snapshot = modelConfigSnapshot();
  const byTaskId = new Map(rawFile.records.map((record) => [record.taskId, record]));
  for (const task of tasks) {
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: userPrompt(task) },
    ];
    try {
      const raw = await provider.chat(messages, { useJsonFormat: options.jsonFormat });
      if (!raw.trim()) throw new Error('empty-content');
      const record: RawGeneration = {
        taskId: task.id,
        generatedAt: new Date().toISOString(),
        modelConfig: snapshot,
        raw,
      };
      byTaskId.set(task.id, record);
      console.log(`generated ${task.id}`);
    } catch (err) {
      const record: RawGeneration = {
        taskId: task.id,
        generatedAt: new Date().toISOString(),
        modelConfig: snapshot,
        raw: '',
        error: err instanceof Error ? err.message : String(err),
      };
      byTaskId.set(task.id, record);
      console.error(`failed ${task.id}: ${record.error}`);
    }
    rawFile.records = [...byTaskId.values()];
    await writeJsonFile(options.rawOut, rawFile);
  }
  console.log(`Wrote ${options.rawOut}`);
}

function parseTeacherJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('empty-raw');
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('raw-not-json');
    try {
      return JSON.parse(match[0]);
    } catch {
      const repaired = repairJson(match[0]);
      try {
        return JSON.parse(repaired);
      } catch (originalError) {
        let candidate = repaired;
        for (let i = 0; i < 2 && /[}\]]\s*$/.test(candidate); i++) {
          candidate = candidate.replace(/([}\]])\s*$/, '');
          try {
            return JSON.parse(candidate);
          } catch {
            // Only trim surplus trailing closers; never synthesize missing content.
          }
        }

        const parsedCandidates = new Map<string, unknown>();
        for (let i = Math.max(0, repaired.length - 24); i < repaired.length; i++) {
          if (repaired[i] !== '}' && repaired[i] !== ']') continue;
          const withoutCloser = repaired.slice(0, i) + repaired.slice(i + 1);
          try {
            parsedCandidates.set(withoutCloser, JSON.parse(withoutCloser));
          } catch {
            // Accept only a unique parse produced by dropping one surplus trailing closer.
          }
        }
        if (parsedCandidates.size === 1) return parsedCandidates.values().next().value;
        throw originalError;
      }
    }
  }
}

function isUsableRaw(raw: string): boolean {
  try {
    parseTeacherJson(raw);
    return true;
  } catch {
    return false;
  }
}

function asRecordObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('parsed-not-object');
  return value as Record<string, unknown>;
}

function stripMarkdownArtifacts(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/(^|\n)\s*[-*]\s+/g, '$1');
}

function expectedForTask(task: DistillTask): ExpectedTransformation | undefined {
  return task.persona?.expectedTransformation ?? (task.topic ? topicToExpected(task.topic) : undefined);
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const text = value.map((item) => textFromUnknown(item)).filter(Boolean).join('、');
    return text || undefined;
  }
  const record = optionalRecord(value);
  if (!record) return undefined;
  for (const key of ['name', 'title', 'label', 'header', 'description', 'key']) {
    const text = textFromUnknown(record[key]);
    if (text) return text;
  }
  return undefined;
}

function normalizeThemeMapping(value: unknown, task: DistillTask): Record<string, string> | undefined {
  const record = optionalRecord(value);
  const expected = expectedForTask(task);
  const originalInterest = textFromUnknown(record?.originalInterest ?? record?.original_interest) ?? expected?.originalInterest;
  const retainedFeature = textFromUnknown(record?.retainedFeature ?? record?.retained_feature) ?? expected?.retainedFeature;
  const classroomProxy = textFromUnknown(record?.classroomProxy ?? record?.classroom_proxy) ?? expected?.classroomProxy;
  const researchQuestion = textFromUnknown(record?.researchQuestion ?? record?.research_question) ?? expected?.researchQuestion;
  if (!originalInterest || !retainedFeature || !classroomProxy || !researchQuestion) return undefined;
  return { originalInterest, retainedFeature, classroomProxy, researchQuestion };
}

function normalizeVariables(value: unknown, task: DistillTask): Record<string, unknown> | undefined {
  const record = optionalRecord(value);
  const expected = expectedForTask(task);
  const independent = textFromUnknown(record?.independent ?? record?.independentVariable) ?? expected?.independentVariable;
  const dependent = textFromUnknown(record?.dependent ?? record?.dependentVariable) ?? expected?.dependentDirection;
  const controlled = Array.isArray(record?.controlled)
    ? record.controlled.map((item) => textFromUnknown(item)).filter((item): item is string => !!item)
    : undefined;
  if (!independent) return undefined;
  return {
    independent,
    ...(dependent ? { dependent } : {}),
    ...(controlled?.length ? { controlled } : {}),
  };
}

function normalizeSnapshot(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  const record = optionalRecord(value);
  if (!record) return textFromUnknown(value);
  const rows = [
    textFromUnknown(record.title),
    textFromUnknown(record.originalInterest ?? record.original_interest) ? `原始兴趣：${textFromUnknown(record.originalInterest ?? record.original_interest)}` : undefined,
    textFromUnknown(record.retainedFeature ?? record.retained_feature) ? `保留特征：${textFromUnknown(record.retainedFeature ?? record.retained_feature)}` : undefined,
    textFromUnknown(record.classroomProxy ?? record.classroom_proxy) ? `课堂代理：${textFromUnknown(record.classroomProxy ?? record.classroom_proxy)}` : undefined,
    textFromUnknown(record.question ?? record.researchQuestion ?? record.research_question) ? `研究问题：${textFromUnknown(record.question ?? record.researchQuestion ?? record.research_question)}` : undefined,
    textFromUnknown(record.independent ?? record.independentVariable) ? `自变量：${textFromUnknown(record.independent ?? record.independentVariable)}` : undefined,
    textFromUnknown(record.dependent ?? record.dependentDirection) ? `因变量：${textFromUnknown(record.dependent ?? record.dependentDirection)}` : undefined,
    Array.isArray(record.controlled) && record.controlled.length
      ? `控制变量：${record.controlled.map((item) => textFromUnknown(item)).filter(Boolean).join('、')}`
      : undefined,
  ].filter((item): item is string => !!item?.trim());
  return rows.join('\n') || textFromUnknown(value);
}

function normalizeStage2ColumnType(value: unknown): 'text' | 'number' | 'image' {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('number') || raw.includes('integer') || raw.includes('float')) return 'number';
  if (raw.includes('image') || raw.includes('photo') || raw.includes('file')) return 'image';
  return 'text';
}

function normalizeStage2Schema(value: unknown): Record<string, unknown> | undefined {
  const record = optionalRecord(value);
  if (!record || !Array.isArray(record.columns)) return undefined;
  const columns = record.columns
    .map((column) => optionalRecord(column))
    .filter((column): column is Record<string, unknown> => !!column)
    .map((column, index) => {
      const title = textFromUnknown(column.title ?? column.label ?? column.header ?? column.name ?? column.key) ?? `字段${index + 1}`;
      const rawKey = textFromUnknown(column.key ?? column.name ?? title) ?? `field_${index + 1}`;
      const key = /备注|异常|notes?/i.test(`${rawKey}\n${title}`) ? 'notes' : rawKey;
      return {
        key,
        title,
        type: normalizeStage2ColumnType(column.type),
        required: column.required === false ? false : true,
      };
    })
    .filter((column) => column.key.trim() && column.title.trim());

  if (!columns.some((column) => column.key === 'notes' && column.type === 'text')) {
    columns.push({ key: 'notes', title: '备注', type: 'text', required: false });
  }
  if (columns.length === 0) return undefined;
  return {
    columns,
    minRows: typeof record.minRows === 'number' ? record.minRows : 1,
    maxRows: 200,
  };
}

function normalizeAssistantObject(value: unknown, phase: Phase, task: DistillTask): unknown {
  const sanitized = sanitizeChatResponseStrings(value);
  const record = optionalRecord(sanitized);
  if (!record) return sanitized;

  const phaseComplete = record.phase_complete === true;
  if (phase === 1 && (phaseComplete || record.stage1_confirmed === true)) {
    record.next_action_type = 'confirmation';
    record.stage1_confirmed = true;
    record.theme_mapping = normalizeThemeMapping(record.theme_mapping, task);
    record.variables = normalizeVariables(record.variables, task);
    const snapshot = normalizeSnapshot(record.snapshot);
    if (snapshot) {
      record.snapshot = snapshot;
    } else {
      const expected = expectedForTask(task);
      if (expected) {
        record.snapshot = [
          `原始兴趣：${expected.originalInterest}`,
          `保留特征：${expected.retainedFeature}`,
          `课堂代理：${expected.classroomProxy}`,
          `研究问题：${expected.researchQuestion}`,
        ].join('\n');
      }
    }
  }

  if (phase === 2 && record.data_table_schema !== undefined) {
    record.data_table_schema = normalizeStage2Schema(record.data_table_schema);
  }
  if (phase === 2 && phaseComplete) {
    record.next_action_type = 'confirmation';
  }

  if (
    record.next_action_type === 'confirmation' &&
    record.phase_complete !== true &&
    record.stage1_confirmed !== true &&
    record.stage2_confirmed !== true
  ) {
    record.next_action_type = 'text_input';
  }
  if (Array.isArray(record.options) && record.options.length > 0 && record.next_action_type !== 'ask_choice') {
    record.options = [];
  }

  return record;
}

function sanitizeChatResponseStrings<T>(value: T): T {
  if (typeof value === 'string') return stripMarkdownArtifacts(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeChatResponseStrings(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, sanitizeChatResponseStrings(item)])
    ) as T;
  }
  return value;
}

function normalizeAssistantValue(value: unknown, phase: Phase, task: DistillTask): string {
  if (typeof value === 'string') {
    const parsed = safeParseChatResponse(value);
    if (parsed) return JSON.stringify(normalizeAssistantObject(parsed, phase, task));
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('assistant-value-not-object');
  return JSON.stringify(normalizeAssistantObject(value, phase, task));
}

function normalizeConversations(value: unknown, phase: Phase, task: DistillTask): ShareGPTMessage[] {
  if (!Array.isArray(value)) throw new Error('conversations-not-array');
  const conversations: ShareGPTMessage[] = value.map((item, index) => {
    const msg = asRecordObject(item);
    const from = msg.from;
    if (from !== 'human' && from !== 'gpt') throw new Error(`message-${index}-from-invalid`);
    const rawValue = msg.value;
    const messageValue = from === 'gpt' ? normalizeAssistantValue(rawValue, phase, task) : String(rawValue ?? '').trim();
    if (!messageValue) throw new Error(`message-${index}-empty`);
    return { from, value: messageValue };
  });

  if (phase === 2) {
    let latestSchema: unknown;
    for (const message of conversations) {
      if (message.from !== 'gpt') continue;
      const parsed = asRecordObject(JSON.parse(message.value));
      if (parsed.data_table_schema) latestSchema = parsed.data_table_schema;
      if (parsed.phase_complete === true && !parsed.data_table_schema && latestSchema) {
        parsed.data_table_schema = latestSchema;
        parsed.next_action_type = 'confirmation';
        message.value = JSON.stringify(parsed);
      }
    }
  }

  return conversations;
}

function recordFromRaw(task: DistillTask, raw: RawGeneration, options: CleanOptions): ShareGPTRecord {
  const parsed = asRecordObject(parseTeacherJson(raw.raw));
  const teacherRecord = asRecordObject(parsed.record ?? parsed);
  const phase = Number(teacherRecord.phase);
  if (!PHASES.includes(phase as Phase) || phase !== task.phase) throw new Error(`phase-mismatch:${phase}`);

  const conversations = normalizeConversations(teacherRecord.conversations, task.phase, task);
  const id = [
    'stem-distill-dsv4',
    safeFilePart(task.id),
    'v1',
  ].join('-');
  const gradeReasons = gradeReasonsForTask(task);
  const tier = task.tierHint;
  return {
    id,
    source: 'distill_dsv4',
    scenario: String(teacherRecord.scenario ?? task.scenario),
    phase: task.phase,
    rubricTargets: Array.isArray(teacherRecord.rubricTargets)
      ? [...new Set(teacherRecord.rubricTargets.map((item) => String(item)).filter(Boolean))]
      : task.rubricTargets,
    evidence: [`${options.plan}:${task.id}`],
    qualityNotes: String(teacherRecord.qualityNotes ?? `DSV4 distilled sample for ${task.id}.`),
    conversations,
    meta: {
      sourceTag: 'distill-dsv4',
      distillTaskId: task.id,
      sourceKind: task.sourceKind,
      personaId: task.persona?.id,
      topicId: task.topic?.id,
      subject: task.persona?.subject ?? task.topic?.subjectTags?.join(','),
      studentType: task.persona?.studentType,
      difficulty: task.persona?.difficulty,
      failureModes: task.persona?.failureModes,
      expectedTransformation: task.persona?.expectedTransformation ?? (task.topic ? topicToExpected(task.topic) : undefined),
      tier,
      reviewStatus: 'unreviewed',
      gradeReasons,
      batchId: options.batchId,
    },
  };
}

function gradeReasonsForTask(task: DistillTask): string[] {
  const reasons = [`priority:${task.priority}`, `phase:P${task.phase}`, `source:${task.sourceKind}`];
  if (task.phase === 1 || task.phase === 2) reasons.push('phase:high-impact');
  if (task.persona?.difficulty === 'hard') reasons.push('difficulty:hard');
  if (task.persona?.studentType) reasons.push(`studentType:${task.persona.studentType}`);
  for (const mode of task.persona?.failureModes ?? []) reasons.push(`failureMode:${mode}`);
  if (task.tierHint === 'silver') reasons.push('tierHint:silver');
  return reasons;
}

function hasLineMarker(dialogue: string): boolean {
  return /(^|\n)\s*[-*]\s+/.test(dialogue.replace(/\*\*[^*]+\*\*/g, ''));
}

function tooMuchBold(dialogue: string): boolean {
  const count = (dialogue.match(/\*\*/g) ?? []).length;
  return count % 2 !== 0 || count / 2 > 4;
}

function phase1LooksChoicey(response: ChatResponse): boolean {
  const text = [response.dialogue, ...(response.hints ?? [])].join('\n');
  return (
    response.next_action_type === 'ask_choice' ||
    (response.options?.length ?? 0) > 0 ||
    /你想.*还是.*还是/.test(text) ||
    /光照时间、光的颜色|生命怎么生存|材料怎么保护|设备怎么自动工作/.test(text)
  );
}

function hasNotesColumn(response: ChatResponse): boolean {
  return !!response.data_table_schema?.columns.some((column) => column.key === 'notes' && column.type === 'text');
}

function validateRecord(record: ShareGPTRecord): string[] {
  const reasons: string[] = [];
  if (!record.id.trim()) reasons.push('id-empty');
  if (!record.scenario.trim()) reasons.push('scenario-empty');
  if (!PHASES.includes(record.phase)) reasons.push('phase-invalid');
  if (record.conversations.length < 2) reasons.push('conversations-too-short');
  if (record.conversations[0]?.from !== 'human') reasons.push('conversation-not-start-human');

  for (let i = 0; i < record.conversations.length; i++) {
    const msg = record.conversations[i];
    if (i > 0 && record.conversations[i - 1].from === msg.from) reasons.push(`message-${i}-not-alternating`);
    if (!msg.value.trim()) reasons.push(`message-${i}-empty`);
    if (msg.from !== 'gpt') continue;
    const parsed = safeParseChatResponse(msg.value);
    if (!parsed) {
      reasons.push(`assistant-${i}-invalid-chat-response`);
      continue;
    }
    if (!parsed.dialogue.trim()) reasons.push(`assistant-${i}-empty-dialogue`);
    if (hasLineMarker(parsed.dialogue)) reasons.push(`assistant-${i}-markdown-list`);
    if (tooMuchBold(parsed.dialogue)) reasons.push(`assistant-${i}-bold-bad`);
    if ((parsed.options?.length ?? 0) > 0 && parsed.next_action_type !== 'ask_choice') reasons.push(`assistant-${i}-options-action-mismatch`);

    if (record.phase === 1) {
      if (phase1LooksChoicey(parsed)) reasons.push(`assistant-${i}-phase1-choicey`);
      if (parsed.phase_complete === true || parsed.stage1_confirmed === true) {
        if (parsed.stage1_confirmed !== true) reasons.push(`assistant-${i}-phase1-confirm-no-stage1-confirmed`);
        if (!parsed.theme_mapping) reasons.push(`assistant-${i}-phase1-confirm-no-theme-mapping`);
        if (!parsed.snapshot?.trim()) reasons.push(`assistant-${i}-phase1-confirm-no-snapshot`);
        if (!parsed.variables?.independent?.trim()) reasons.push(`assistant-${i}-phase1-confirm-no-independent`);
      }
    }

    if (record.phase === 2 && parsed.phase_complete === true) {
      if (!parsed.data_table_schema) reasons.push(`assistant-${i}-phase2-confirm-no-schema`);
      if (!hasNotesColumn(parsed)) reasons.push(`assistant-${i}-phase2-schema-no-notes`);
      if (parsed.data_table_schema?.maxRows !== 200) reasons.push(`assistant-${i}-phase2-schema-maxRows-not-200`);
    }

    if (record.phase === 5) {
      const sections = parsed.report_sections;
      if (!sections) reasons.push(`assistant-${i}-phase5-no-report-sections`);
      if (sections) {
        for (const key of ['purpose', 'hypothesis', 'materials', 'procedure', 'dataSummary', 'analysis'] as const) {
          if (!sections[key].trim()) reasons.push(`assistant-${i}-phase5-section-${key}-empty`);
        }
      }
    }
  }

  const semantic = evaluateShareGPTRecordSemantic(record);
  if (semantic.status !== 'ok') reasons.push(semantic.reason ?? `semantic-${semantic.status}`);
  return [...new Set(reasons)];
}

function rejectedTier(reasons: string[]): Extract<DataTier, 'needs_review' | 'reject'> {
  if (reasons.some((reason) => reason.startsWith('semantic-proxy-drift') || reason.includes('invalid-chat-response') || reason.includes('phase1-choicey'))) {
    return 'reject';
  }
  return 'needs_review';
}

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function summarize(records: ShareGPTRecord[], rejected: CleanRejectedRecord[], totalRaw: number) {
  const byPhase: Record<string, number> = {};
  const rejectReasons: Record<string, number> = {};
  for (const record of records) increment(byPhase, `P${record.phase}`);
  for (const item of rejected) {
    increment(byPhase, `P${item.phase}`);
    for (const reason of item.reasons) increment(rejectReasons, reason);
  }
  return {
    totalRaw,
    clean: records.length,
    goldCandidate: records.filter((record) => record.meta.tier === 'gold_candidate').length,
    silver: records.filter((record) => record.meta.tier === 'silver').length,
    needsReview: rejected.filter((record) => record.tier === 'needs_review').length,
    rejected: rejected.filter((record) => record.tier === 'reject').length,
    byPhase,
    rejectReasons,
  };
}

function manifestRecord(record: ShareGPTRecord, outputFile: string): ReviewManifestRecord {
  return {
    id: record.id,
    taskId: record.meta.distillTaskId,
    tier: record.meta.tier,
    reviewStatus: record.meta.reviewStatus,
    gradeReasons: record.meta.gradeReasons,
    sourceKind: record.meta.sourceKind,
    phase: record.phase,
    scenario: record.scenario,
    personaId: record.meta.personaId,
    topicId: record.meta.topicId,
    subject: record.meta.subject ? String(record.meta.subject) : undefined,
    studentType: record.meta.studentType,
    failureModes: record.meta.failureModes,
    outputFile,
  };
}

async function runClean(options: CleanOptions) {
  const plan = await readJsonFile<DistillPlan>(options.plan);
  const rawFile = await readJsonFile<RawGenerationFile>(options.raw);
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]));
  const clean: ShareGPTRecord[] = [];
  const rejected: CleanRejectedRecord[] = [];

  for (const raw of rawFile.records) {
    const task = taskById.get(raw.taskId);
    if (!task) {
      rejected.push({ taskId: raw.taskId, phase: 1, scenario: 'unknown', tier: 'reject', reasons: ['task-not-found'], raw: raw.raw });
      continue;
    }
    if (raw.error) {
      rejected.push({ taskId: task.id, phase: task.phase, scenario: task.scenario, tier: 'reject', reasons: [`generation-error:${raw.error}`], raw: raw.raw });
      continue;
    }
    try {
      const record = recordFromRaw(task, raw, options);
      const reasons = validateRecord(record);
      if (reasons.length > 0) {
        rejected.push({ taskId: task.id, phase: task.phase, scenario: task.scenario, tier: rejectedTier(reasons), reasons, raw: raw.raw });
        continue;
      }
      clean.push(record);
    } catch (err) {
      rejected.push({
        taskId: task.id,
        phase: task.phase,
        scenario: task.scenario,
        tier: 'reject',
        reasons: [err instanceof Error ? err.message : String(err)],
        raw: raw.raw,
      });
    }
  }

  const goldCandidate = clean.filter((record) => record.meta.tier === 'gold_candidate');
  const silver = clean.filter((record) => record.meta.tier === 'silver');
  await writeJsonFile(options.cleanOut, clean);
  await writeJsonFile(options.goldCandidateOut, goldCandidate);
  await writeJsonFile(options.silverOut, silver);
  await writeJsonFile(options.rejectedOut, rejected);

  const manifest: ReviewManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    batchId: options.batchId,
    createdAt: new Date().toISOString(),
    planFile: options.plan,
    rawFile: options.raw,
    outputs: {
      clean: options.cleanOut,
      goldCandidate: options.goldCandidateOut,
      silver: options.silverOut,
      rejected: options.rejectedOut,
    },
    summary: summarize(clean, rejected, rawFile.records.length),
    records: [
      ...goldCandidate.map((record) => manifestRecord(record, options.goldCandidateOut)),
      ...silver.map((record) => manifestRecord(record, options.silverOut)),
    ],
    rejected,
  };
  await writeJsonFile(options.manifestOut, manifest);
  console.log(`Wrote ${options.cleanOut}`);
  console.log(`Wrote ${options.goldCandidateOut}`);
  console.log(`Wrote ${options.silverOut}`);
  console.log(`Wrote ${options.rejectedOut}`);
  console.log(`Wrote ${options.manifestOut}`);
  console.log(JSON.stringify(manifest.summary, null, 2));
}

async function runPlan(options: PlanOptions) {
  const plan = await buildPlan(options);
  await writeJsonFile(options.out, plan);
  console.log(`Wrote ${options.out}`);
  console.log(JSON.stringify({ target: plan.target, quota: plan.quota, tasks: plan.tasks.length }, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }
  if (cmd === 'plan') {
    await runPlan(parsePlanOptions(args));
    return;
  }
  if (cmd === 'generate') {
    await runGenerate(parseGenerateOptions(args));
    return;
  }
  if (cmd === 'clean') {
    await runClean(parseCleanOptions(args));
    return;
  }
  throw new Error(`未知命令: ${cmd}`);
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
