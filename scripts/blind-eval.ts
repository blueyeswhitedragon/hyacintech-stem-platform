/**
 * 双盲成对偏好评测（LLM-as-judge pairwise blind eval）
 *
 * collect:
 *   MODEL_TAG=qwen-smoke OPENAI_API_KEY=... OPENAI_API_BASE=https://llm.wtsht.cn/v1/v1 \
 *     LLM_PROVIDER=openai LLM_MODEL=Qwen3.5-35B-A3B LLM_TIMEOUT_MS=180000 LLM_MAX_TOKENS=1600 \
 *     npx tsx scripts/blind-eval.ts collect --scope smoke
 *   MODEL_TAG=dsv4-smoke DEEPSEEK_API_KEY=... DEEPSEEK_API_BASE=https://api.deepseek.com \
 *     LLM_PROVIDER=deepseek LLM_MODEL=deepseek-v4-pro LLM_TIMEOUT_MS=180000 LLM_MAX_TOKENS=1600 \
 *     npx tsx scripts/blind-eval.ts collect --scope smoke
 *
 * judge:
 *   JUDGE_API_KEY=... JUDGE_API_BASE=... JUDGE_MODEL=... \
 *     npx tsx scripts/blind-eval.ts judge qwen-smoke dsv4-smoke --scope smoke
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { getPromptForPhase, type PromptContext } from '../app/prompts/index';
import { validateStageResponseBehavior, type StageTriggerType } from '../app/lib/stageContract';
import { repairJson } from '../app/lib/llm/jsonRepair';
import { safeParseChatResponse } from '../app/lib/llm/parser';
import { shouldNudgeConvergence } from '../app/lib/pacing';
import { createLLMProvider, validateConfig } from '../app/lib/llm/provider';
import { PhaseEnum, type ChatResponse } from '../app/models/types';
import type { LLMMessage } from '../app/lib/llm/types';
import {
  DEFAULT_STYLE_FAMILY,
  DEFAULT_STYLE_POLICY_VERSION,
  STYLE_LABELS,
  isStyleFamily,
  type StyleFamily,
} from '../app/lib/stylePolicy';
import {
  FILLER,
  PERSONAS,
  personaToScenarioId,
  selectPersonas,
  type ExpectedTransformation,
  type FailureMode,
  type StemPersona,
  type SubjectArea,
  type StudentType,
} from './persona-library';

const OUT_DIR = path.join(process.cwd(), 'data/blind-eval');
const TRANSCRIPT_SCHEMA_VERSION = 2;
const VERDICT_SCHEMA_VERSION = 3;
let evaluationStyleFamily: StyleFamily = DEFAULT_STYLE_FAMILY;
let evaluationStylePolicyVersion = DEFAULT_STYLE_POLICY_VERSION;
const FALLBACKS = [
  '抱歉，AI服务返回了空内容，请重试。',
  '抱歉，AI回复格式出现异常，请重试。',
  '抱歉，我暂时无法处理您的请求，请重新描述您的问题。',
];

type Scope = 'smoke' | 'full';
type JudgeLevel = 'scenario' | 'full';
type ScenarioKind = 'persona' | 'phase3' | 'phase4' | 'phase5' | 'phase6' | 'fixed-regression';
type StageSelector = 'persona' | '3' | '4' | '5' | '6';
type Winner = 'A' | 'B' | 'tie';
type JudgeWinner = 'X' | 'Y' | 'tie';
type DimensionKey =
  | 'teaching_guidance'
  | 'theme_fidelity'
  | 'student_agency'
  | 'proxy_quality'
  | 'transformation_reasoning'
  | 'interdisciplinary_integration'
  | 'cognitive_load_control'
  | 'stage_discipline'
  | 'stem_fit'
  | 'safety'
  | 'structure_compliance'
  | 'expression';

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
    subject?: SubjectArea;
    studentType?: StudentType;
    difficulty?: string;
    failureModes?: FailureMode[];
    expectedTransformation?: ExpectedTransformation;
  };
  turns: TurnRecord[];
}

interface Transcript {
  schemaVersion: number;
  tag: string;
  createdAt: string;
  scope: Scope;
  styleFamily?: StyleFamily;
  stylePolicyVersion?: string;
  modelConfig: {
    provider: string | null;
    model: string | null;
    baseURL: string | null;
    timeoutMs: string | null;
    maxTokens: string | null;
  };
  summary: {
    scenarios: number;
    turns: number;
    parseOk: number;
    cleanTurns: number;
    violationsByRule: Record<string, number>;
  };
  scenarios: ScenarioRecord[];
}

interface JudgeResponse {
  winner: JudgeWinner;
  dimensions?: Partial<Record<DimensionKey, JudgeWinner>>;
  reason: string;
  preferencePair?: {
    winnerExcerpt?: string;
    loserExcerpt?: string;
  };
}

interface FinalVerdict {
  id: string;
  title: string;
  winner: Winner;
  inconsistent: boolean;
  dimensions: Partial<Record<DimensionKey, Winner>>;
  reasons: {
    aAsX: string;
    bAsX: string;
  };
  rawJudgeResponses: {
    aAsX: JudgeResponse;
    bAsX: JudgeResponse;
  };
}

interface VerdictFile {
  schemaVersion: number;
  createdAt: string;
  scope: Scope;
  judgeLevel: JudgeLevel;
  tags: { A: string; B: string };
  styleFamily?: StyleFamily;
  stylePolicyVersion?: string;
  judgeConfig: {
    baseURL: string;
    model: string;
    timeoutMs: number;
    maxTokens: number;
    temperature: 0;
  };
  summary: {
    scenario: CountSummary;
    turn: CountSummary;
    dimensions: Record<DimensionKey, CountSummary>;
  };
  scenarioVerdicts: FinalVerdict[];
  turnVerdicts: FinalVerdict[];
}

interface CountSummary {
  A: number;
  B: number;
  tie: number;
  inconsistent: number;
}

const P2_TRIGGER = '我已确认选题，现在开始设计实验方案。';
const DIMENSIONS: DimensionKey[] = [
  'teaching_guidance',
  'theme_fidelity',
  'student_agency',
  'proxy_quality',
  'transformation_reasoning',
  'interdisciplinary_integration',
  'cognitive_load_control',
  'stage_discipline',
  'stem_fit',
  'safety',
  'structure_compliance',
  'expression',
];

const DATA_ROWS = [
  { day: 1, group_a: '0/10', group_b: '0/10', group_c: '0/10', group_d: '1/10' },
  { day: 2, group_a: '1/10', group_b: '2/10', group_c: '0/10', group_d: '3/10' },
  { day: 3, group_a: '3/10', group_b: '4/10', group_c: '1/10', group_d: '5/10' },
  { day: 4, group_a: '5/10', group_b: '6/10', group_c: '2/10', group_d: '7/10' },
  { day: 5, group_a: '7/10', group_b: '8/10', group_c: '4/10', group_d: '9/10' },
];

const PRIOR_SUMMARY = `【选题确认书】
研究不同颜色光对绿豆发芽速度的影响
自变量：光的颜色（红、蓝、绿、白），因变量：每天发芽数，控制变量：温度、水量、绿豆品种

【实验方案-数据表列】天数(number)、红光组发芽数(number)、蓝光组发芽数(number)、绿光组发芽数(number)、白光组发芽数(number)、备注(text)，最少3行，最多200行

【实验数据-共5行】
天数 | 红光组 | 蓝光组 | 绿光组 | 白光组
1 | 0/10 | 0/10 | 0/10 | 1/10
2 | 1/10 | 2/10 | 0/10 | 3/10
3 | 3/10 | 4/10 | 1/10 | 5/10
4 | 5/10 | 6/10 | 2/10 | 7/10
5 | 7/10 | 8/10 | 4/10 | 9/10`;

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/blind-eval.ts collect [--scope smoke|full] [--style <style-family>] [--stages persona,3,4,5,6] [--limit N] [--subject <area>] [--student-type <type>] [--difficulty easy|medium|hard] [--persona <id-or-name>] [--tag <tag>] [--include-regression true|false]
  npx tsx scripts/blind-eval.ts judge <tagA> <tagB> [--scope smoke|full] [--judge-level scenario|full] [--scenario <id-or-name>]

Collect env:
  MODEL_TAG=<safe-tag>
  LLM_PROVIDER=openai|deepseek
  OPENAI_API_KEY / DEEPSEEK_API_KEY
  OPENAI_API_BASE / DEEPSEEK_API_BASE=https://api.deepseek.com
  LLM_MODEL=deepseek-v4-pro | Qwen3.5-35B-A3B | ...
  LLM_TIMEOUT_MS=180000
  LLM_MAX_TOKENS=1600

Judge env:
  JUDGE_API_KEY=<key>
  JUDGE_API_BASE=<base-url>
  JUDGE_MODEL=<model>
  JUDGE_TIMEOUT_MS=180000
  JUDGE_MAX_TOKENS=2000

Default scope is smoke. Collect defaults: --stages persona,4,5 --include-regression true.`);
}

function parseScope(args: string[]): Scope {
  const i = args.indexOf('--scope');
  if (i === -1) return 'smoke';
  const value = args[i + 1];
  if (value === 'smoke' || value === 'full') return value;
  throw new Error('--scope 必须是 smoke 或 full');
}

function parseJudgeLevel(args: string[]): JudgeLevel {
  const i = args.indexOf('--judge-level');
  if (i === -1) return 'full';
  const value = args[i + 1];
  if (value === 'scenario' || value === 'full') return value;
  throw new Error('--judge-level 必须是 scenario 或 full');
}

function parseScenarioFilter(args: string[]): string | undefined {
  const i = args.indexOf('--scenario');
  if (i === -1) return undefined;
  const value = args[i + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error('--scenario 需要场景 id 或名称');
  return value;
}

function safeTag(tag: string | undefined): string {
  const trimmed = tag?.trim();
  if (!trimmed) throw new Error('collect 需要设置 MODEL_TAG');
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error('MODEL_TAG 只能包含字母、数字、点、下划线和短横线');
  }
  return trimmed;
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'scenario';
}

interface CollectOptions {
  scope: Scope;
  stages: StageSelector[];
  includeRegression: boolean;
  persona?: string;
  subject?: SubjectArea;
  studentType?: StudentType;
  difficulty?: 'easy' | 'medium' | 'hard';
  tag?: string;
  limit?: number;
  styleFamily: StyleFamily;
}

function parseFlagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const value = args[i + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error(`${flag} 需要参数`);
  return value;
}

function parseLimit(args: string[]): number | undefined {
  const value = parseFlagValue(args, '--limit');
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error('--limit 必须是正整数');
  return n;
}

function parseStages(args: string[]): StageSelector[] {
  const raw = parseFlagValue(args, '--stages') ?? 'persona,4,5';
  const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = new Set<StageSelector>(['persona', '3', '4', '5', '6']);
  for (const value of values) {
    if (!allowed.has(value as StageSelector)) throw new Error(`--stages 不支持: ${value}`);
  }
  return [...new Set(values as StageSelector[])];
}

function parseBooleanFlag(args: string[], flag: string, defaultValue: boolean): boolean {
  const value = parseFlagValue(args, flag);
  if (!value) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${flag} 必须是 true 或 false`);
}

function parseCollectOptions(args: string[], scope: Scope): CollectOptions {
  const subject = parseFlagValue(args, '--subject') as SubjectArea | undefined;
  const studentType = parseFlagValue(args, '--student-type') as StudentType | undefined;
  const difficulty = parseFlagValue(args, '--difficulty') as CollectOptions['difficulty'];
  if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new Error('--difficulty 必须是 easy、medium 或 hard');
  }
  const requestedStyle = parseFlagValue(args, '--style') ?? DEFAULT_STYLE_FAMILY;
  if (!isStyleFamily(requestedStyle)) {
    throw new Error(`--style 不支持：${requestedStyle}`);
  }
  return {
    scope,
    stages: parseStages(args),
    includeRegression: parseBooleanFlag(args, '--include-regression', true),
    persona: parseFlagValue(args, '--persona'),
    subject,
    studentType,
    difficulty,
    tag: parseFlagValue(args, '--tag'),
    limit: parseLimit(args),
    styleFamily: requestedStyle,
  };
}

function selectedPersonas(options: CollectOptions | Scope): StemPersona[] {
  if (typeof options === 'string') {
    return selectPersonas({ scope: options });
  }
  return selectPersonas({
    scope: options.scope,
    persona: options.persona,
    subject: options.subject,
    studentType: options.studentType,
    difficulty: options.difficulty,
    tag: options.tag,
    limit: options.limit,
  });
}

function personaForScenario(scenario: Pick<ScenarioRecord, 'name' | 'kind' | 'id' | 'meta'>): StemPersona | undefined {
  const personaId = scenario.meta?.personaId;
  if (personaId) return PERSONAS.find((p) => p.id === personaId);
  if (scenario.kind !== 'persona') return undefined;
  return PERSONAS.find((p) => personaToScenarioId(p) === scenario.id || p.name === scenario.name);
}

function checkMarkdown(dialogue: string): Violation[] {
  const v: Violation[] = [];
  const starCount = (dialogue.match(/\*\*/g) ?? []).length;
  if (starCount % 2 !== 0) v.push({ rule: 'md-unpaired-bold', detail: `**出现${starCount}次（奇数，未配对）` });
  if (starCount / 2 > 4) v.push({ rule: 'md-too-many-bold', detail: `加粗${starCount / 2}处 > 4` });
  if (/(^|\n)\s*[-*]\s+(?!\*)/.test(dialogue.replace(/\*\*[^*]+\*\*/g, ''))) {
    v.push({ rule: 'md-list-marker', detail: '使用了 - 或 * 列表符号' });
  }
  if (/(^|\n)\s*#{1,6}\s/.test(dialogue)) v.push({ rule: 'md-heading', detail: '使用了 # 标题' });
  if (dialogue.includes('```')) v.push({ rule: 'md-codeblock', detail: '使用了代码块' });
  return v;
}

function checkOptions(r: ChatResponse): Violation[] {
  const v: Violation[] = [];
  if (r.options && r.options.length > 0) {
    if (r.next_action_type !== 'ask_choice') {
      v.push({ rule: 'options-wrong-action', detail: `options非空但 action=${r.next_action_type}` });
    }
    for (const opt of r.options) {
      if (opt.length > 15) {
        v.push({ rule: 'options-too-long', detail: `选项超15字："${opt.slice(0, 25)}…"` });
        break;
      }
    }
  }
  return v;
}

function stage1VisibleText(r: ChatResponse): string {
  return [r.dialogue, ...(r.hints ?? []), ...(r.options ?? [])].join('\n');
}

function checkStage1AntiChoice(r: ChatResponse): Violation[] {
  const v: Violation[] = [];
  const text = stage1VisibleText(r);
  if (r.next_action_type === 'ask_choice' || (r.options?.length ?? 0) > 0) {
    v.push({ rule: 'p1-hidden-abc-options', detail: '阶段1使用 ask_choice/options，容易把启发变成选项题' });
  }
  const explicitChoicePattern = /(是|比如|例如|可以|你可以|你想|你会|你更想|你打算|你准备)[^。！？\n]{0,45}(还是|或者|或)[^。！？\n]{0,45}(还是|或者|或)/;
  const pickOnePattern = /(选|选择|挑|先从)[^。！？\n]{0,30}(一个|一种|其中)/;
  if (
    /生命怎么生存|物体怎么运动|材料怎么保护人|设备怎么自动工作/.test(text) ||
    /光照时间|光的颜色|光的强弱/.test(text) ||
    explicitChoicePattern.test(text) ||
    pickOnePattern.test(text)
  ) {
    v.push({ rule: 'p1-hidden-abc-options', detail: '出现隐藏 ABC 式提问' });
  }
  return v;
}

function checkReadyMadeTopicList(r: ChatResponse): Violation[] {
  const text = stage1VisibleText(r);
  if (r.stage1_confirmed) return [];
  if (
    /(可以|建议)[\s\S]*(研究|选择)[\s\S]*(①|1\.|一是|首先)[\s\S]*(②|2\.|二是|其次)/.test(text) ||
    /(几个|2-3个|三[个种]).*(课题|方向|选题)/.test(text)
  ) {
    return [{ rule: 'p1-ready-made-topic-list', detail: '阶段1给出成组选题方向，削弱学生自己的转化过程' }];
  }
  return [];
}

function checkThemeMapping(r: ChatResponse): Violation[] {
  if (!r.stage1_confirmed) return [];
  const m = r.theme_mapping;
  if (!m) return [{ rule: 'p1-missing-theme-mapping', detail: '阶段1确认缺少 theme_mapping 转化链' }];
  const missing = [
    ['originalInterest', m.originalInterest],
    ['retainedFeature', m.retainedFeature],
    ['classroomProxy', m.classroomProxy],
    ['researchQuestion', m.researchQuestion],
  ].filter(([, value]) => !String(value).trim());
  if (missing.length > 0) {
    return [{ rule: 'p1-missing-theme-mapping', detail: `theme_mapping 字段为空: ${missing.map(([k]) => k).join(',')}` }];
  }
  return [];
}

function checkOverhelpedTopic(r: ChatResponse): Violation[] {
  if (r.stage1_confirmed) return [];
  const text = stage1VisibleText(r);
  const hasFullQuestion = /研究问题[:：]|你的研究问题可以(是|表述为)|可以把.*定为/.test(text);
  const hasVariable = /自变量|要改变的因素|因变量|观察指标/.test(text);
  const hasProxy = /课堂代理|模拟|用.*来代表|用.*来模拟/.test(text);
  if (hasFullQuestion && hasVariable && hasProxy) {
    return [{ rule: 'p1-overhelped-topic', detail: '阶段1未确认前导师给出完整题目、变量和代理路径，削弱学生主体性' }];
  }
  return [];
}

function checkMissingRelevanceExplanation(r: ChatResponse): Violation[] {
  if (!r.stage1_confirmed || !r.theme_mapping) return [];
  const text = [r.dialogue, r.snapshot ?? ''].join('\n');
  if (!/保留|对应|模拟|代表|因为|关系|仍然/.test(text)) {
    return [{ rule: 'p1-missing-relevance-explanation', detail: '确认书有课堂代理，但没有解释代理与原主题特征的关系' }];
  }
  return [];
}

const CREATIVE_EXPECTATIONS: Record<string, { theme: RegExp; feature: RegExp; proxy: RegExp; avoid?: RegExp }> = {
  高概念降级型: {
    theme: /太空|火星|基地/,
    feature: /人工|控制|资源|光照|环境/,
    proxy: /代理|模拟|人工光照|光照时长|课堂/,
  },
  现实问题抽象型: {
    theme: /教室|夏天|热|室内/,
    feature: /遮光|阳光|变凉|温度/,
    proxy: /纸盒|台灯|遮光材料|模拟|代理/,
  },
  工程保真型: {
    theme: /智能遮光|遮光系统|自动/,
    feature: /自动|判断|阈值|触发/,
    proxy: /光照触发阈值|阈值|测试|课堂|代理/,
  },
  工程项目型: {
    theme: /自动浇花|浇花器|土壤/,
    feature: /湿度|阈值|传感|自动|触发/,
    proxy: /湿度阈值|传感器|阈值百分比|触发/,
    avoid: /棉线|毛细|虹吸|浮球/,
  },
};

function checkCreativeScaffolding(persona: StemPersona, r: ChatResponse): Violation[] {
  if (!r.stage1_confirmed) return [];
  const expected = CREATIVE_EXPECTATIONS[persona.name];
  if (!expected) return [];
  const m = r.theme_mapping;
  const text = [r.dialogue, r.snapshot ?? '', m ? JSON.stringify(m) : ''].join('\n');
  const v: Violation[] = [];
  if (!expected.theme.test(text)) {
    v.push({ rule: 'p1-lost-original-theme', detail: '确认书未保留学生原始兴趣主题' });
  }
  if (!expected.feature.test(text)) {
    v.push({ rule: 'p1-lost-original-feature', detail: '确认书未说明从原主题保留的关键特征或约束' });
  }
  if (!expected.proxy.test(text)) {
    v.push({ rule: 'p1-no-classroom-proxy', detail: '确认书未说明课堂安全代理或模拟关系' });
  }
  if (expected.avoid?.test(text)) {
    v.push({ rule: 'p1-proxy-drift', detail: '课堂代理偏离学生原始机制，疑似擅自换题' });
  }
  return v;
}


function keywordPattern(text: string): RegExp | null {
  const keywords = text
    .split(/[\s,，、。；;：:（）()\[\]【】"“”'‘’/\\]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .slice(0, 8);
  if (keywords.length === 0) return null;
  return new RegExp(keywords.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
}

function checkPersonaExpectation(persona: StemPersona, r: ChatResponse): Violation[] {
  if (!r.stage1_confirmed) return [];
  const expected = persona.expectedTransformation;
  const text = [
    r.dialogue,
    r.snapshot ?? '',
    r.theme_mapping ? JSON.stringify(r.theme_mapping) : '',
    r.topic_direction ? JSON.stringify(r.topic_direction) : '',
    r.variables ? JSON.stringify(r.variables) : '',
  ].join('\n');
  const v: Violation[] = [];
  const theme = keywordPattern(expected.originalInterest);
  const proxy = keywordPattern(`${expected.classroomProxy} ${expected.independentVariable}`);
  if (theme && !theme.test(text)) {
    v.push({ rule: 'p1-theme-loss', detail: `确认书疑似丢失原始兴趣：${expected.originalInterest}` });
  }
  if (proxy && !proxy.test(text)) {
    v.push({ rule: 'p1-proxy-drift', detail: `确认书疑似未保留课堂代理/自变量：${expected.classroomProxy} / ${expected.independentVariable}` });
  }
  if (
    persona.subject === 'engineering_automation' &&
    !/阈值|触发|传感|响应|准确率|自动|判断|分拣|提醒|报警/.test(text)
  ) {
    v.push({ rule: 'p1-engineering-flattening', detail: '工程项目确认书没有保留自动判断、阈值触发或响应准确率等机制' });
  }
  return v;
}

function checkRedundantConfirm(r: ChatResponse): Violation[] {
  if (/准备好了|可以进入|要不要进入|是否进入|进入下一阶段了吗|生成确认书吗/.test(r.dialogue) && !r.stage1_confirmed) {
    return [{ rule: 'p1-redundant-confirm', detail: '口头问是否进入下一阶段而未直接输出确认书' }];
  }
  return [];
}

function checkStage1Boundary(r: ChatResponse): Violation[] {
  if (r.stage1_confirmed) return [];
  const v: Violation[] = [];
  const d = r.dialogue;
  if (/怎么测量|如何测量|测量方式|记录哪些数据|怎样记录/.test(d)) {
    v.push({ rule: 'p1-boundary-measure', detail: '追问测量方式（阶段2事项）' });
  }
  if (/哪些控制变量|控制变量有|需要保持一致的|保持不变的因素/.test(d) && /[？?]/.test(d)) {
    v.push({ rule: 'p1-boundary-controlled', detail: '追问控制变量清单（阶段2事项）' });
  }
  if (/实验步骤|准备哪些材料|分几组|设计数据表/.test(d)) {
    v.push({ rule: 'p1-boundary-procedure', detail: '讨论实验步骤/材料/分组（阶段2事项）' });
  }
  return v;
}

function checkConfirmationPairing(phase: number, r: ChatResponse): Violation[] {
  if (r.next_action_type !== 'confirmation') return [];
  if (phase === 1 && (!r.stage1_confirmed || !r.snapshot || !r.topic_direction?.factor || !r.topic_direction?.phenomenon)) {
    return [{ rule: 'p1-confirm-no-v2-doc', detail: 'confirmation 未伴随 stage1_confirmed+snapshot+topic_direction' }];
  }
  if (phase === 2 && (!r.data_table_schema || !r.experiment_plan)) {
    return [{ rule: 'p2-confirm-no-plan-schema', detail: 'confirmation 未同时包含 experiment_plan 与 data_table_schema' }];
  }
  return [];
}

function checkReportSections(r: ChatResponse): Violation[] {
  const need = ['purpose', 'hypothesis', 'materials', 'procedure', 'dataSummary', 'analysis'] as const;
  if (!r.report_sections) return [{ rule: 'p5-no-sections', detail: '首轮未输出 report_sections' }];
  const missing = need.filter((k) => !r.report_sections?.[k]?.trim());
  if (missing.length > 0) return [{ rule: 'p5-missing-sections', detail: `缺节: ${missing.join(',')}` }];
  return [];
}

function structuredFields(r: ChatResponse): string[] {
  const out: string[] = [];
  if (r.stage1_confirmed) out.push('stage1_confirmed');
  if (r.snapshot) out.push('snapshot');
  if (r.theme_mapping) out.push('theme_mapping');
  if (r.topic_direction) out.push('topic_direction');
  if (r.variables) out.push('variables');
  if (r.experiment_plan) out.push('experiment_plan');
  if (r.data_table_schema) out.push('data_table_schema');
  if (r.risks) out.push('risks');
  if (r.safety_quiz) out.push('safety_quiz');
  if (r.analysis_progress) out.push('analysis_progress');
  if (r.report_sections) out.push('report_sections');
  return out;
}

function sharedStageContractViolations(phase: number, parsed: ChatResponse): Violation[] {
  const triggerType: StageTriggerType = phase === 3 && parsed.safety_quiz
    ? 'STAGE_ENTER'
    : phase === 5
      ? 'REPORT_BOOTSTRAP'
      : phase === 6
        ? 'OPTIONAL_COACHING'
        : 'USER_MESSAGE';
  return validateStageResponseBehavior(phase, parsed, { triggerType })
    .map((item) => ({ rule: item.code.toLowerCase(), detail: item.message }));
}

function currentViolationsForTurn(
  scenario: Pick<ScenarioRecord, 'id' | 'name' | 'kind' | 'meta'>,
  phase: number,
  parsed: ChatResponse
): Violation[] {
  if (phase === 1) {
    const persona = personaForScenario(scenario);
    return [
      ...checkMarkdown(parsed.dialogue),
      ...checkOptions(parsed),
      ...checkStage1AntiChoice(parsed),
      ...checkReadyMadeTopicList(parsed),
      ...checkOverhelpedTopic(parsed),
      ...checkRedundantConfirm(parsed),
      ...checkStage1Boundary(parsed),
      ...checkConfirmationPairing(1, parsed),
      ...checkThemeMapping(parsed),
      ...checkMissingRelevanceExplanation(parsed),
      ...(persona ? checkCreativeScaffolding(persona, parsed) : []),
      ...(persona ? checkPersonaExpectation(persona, parsed) : []),
      ...sharedStageContractViolations(phase, parsed),
    ];
  }
  if (phase === 2) {
    return [
      ...checkMarkdown(parsed.dialogue),
      ...checkOptions(parsed),
      ...checkConfirmationPairing(2, parsed),
      ...sharedStageContractViolations(phase, parsed),
    ];
  }
  if (phase === 5) {
    return [
      ...checkMarkdown(parsed.dialogue),
      ...checkOptions(parsed),
      ...checkReportSections(parsed),
      ...sharedStageContractViolations(phase, parsed),
    ];
  }
  return [
    ...checkMarkdown(parsed.dialogue),
    ...checkOptions(parsed),
    ...sharedStageContractViolations(phase, parsed),
  ];
}

async function callOnce(provider: ReturnType<typeof createLLMProvider>, systemPrompt: string, history: LLMMessage[], userMsg: string) {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMsg },
  ];
  const raw = await provider.chat(messages, { useJsonFormat: true });
  const parsed = safeParseChatResponse(raw);
  return { raw, parsed, parseOk: !FALLBACKS.includes(parsed.dialogue) };
}

function evaluationPrompt(phase: PhaseEnum, context?: PromptContext): string {
  return getPromptForPhase(phase, {
    ...(context ?? {}),
    styleFamily: evaluationStyleFamily,
    stylePolicyVersion: evaluationStylePolicyVersion,
  });
}

function makeTurn(
  scenario: Pick<ScenarioRecord, 'id' | 'name'>,
  phase: number,
  turn: number,
  userMsg: string,
  raw: string,
  parsed: ChatResponse,
  parseOk: boolean,
  violations: Violation[]
): TurnRecord {
  return {
    id: `${scenario.id}:p${phase}:t${turn}`,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    phase,
    turn,
    userMsg,
    raw,
    parsed,
    parseOk,
    actionType: parsed.next_action_type,
    structuredFields: structuredFields(parsed),
    violations,
  };
}

function personaMeta(persona: StemPersona): ScenarioRecord['meta'] {
  return {
    personaId: persona.id,
    subject: persona.subject,
    studentType: persona.studentType,
    difficulty: persona.difficulty,
    failureModes: persona.failureModes,
    expectedTransformation: persona.expectedTransformation,
  };
}

async function runPersona(provider: ReturnType<typeof createLLMProvider>, persona: StemPersona): Promise<ScenarioRecord> {
  const scenario: ScenarioRecord = {
    id: personaToScenarioId(persona),
    name: persona.name,
    kind: 'persona' as const,
    meta: personaMeta(persona),
    turns: [] as TurnRecord[],
  };
  const history: LLMMessage[] = [];
  const roundCounts: Record<number, number> = {};
  const promptFor = (phase: PhaseEnum, extra?: PromptContext) => {
    const round = (roundCounts[phase] ?? 0) + 1;
    roundCounts[phase] = round;
    let ctx = extra;
    if (shouldNudgeConvergence(phase, round)) ctx = { ...(ctx ?? {}), nudgeConverge: true };
    return evaluationPrompt(phase, ctx);
  };

  let confirmed = false;
  for (let t = 1; t <= 8 && !confirmed; t++) {
    const msg = persona.phase1[t - 1] ?? FILLER;
    const { raw, parsed, parseOk } = await callOnce(provider, promptFor(PhaseEnum.TopicSelection), history, msg);
    const violations = currentViolationsForTurn(scenario, 1, parsed);
    scenario.turns.push(makeTurn(scenario, 1, t, msg, raw, parsed, parseOk, violations));
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: raw });
    confirmed = !!parsed.stage1_confirmed;
  }
  if (!confirmed) {
    scenario.turns.push({
      id: `${scenario.id}:p1:never-converged`,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      phase: 1,
      turn: 99,
      userMsg: '(未收敛)',
      raw: '',
      parsed: { dialogue: '', next_action_type: 'info', phase_complete: false },
      parseOk: false,
      actionType: 'none',
      structuredFields: [],
      violations: [{ rule: 'p1-never-converged', detail: '8轮未输出确认书' }],
    });
  }

  let gotSchema = false;
  const p2Messages = [P2_TRIGGER, ...persona.phase2];
  for (let t = 1; t <= 6 && !gotSchema; t++) {
    const msg = p2Messages[t - 1] ?? FILLER;
    const { raw, parsed, parseOk } = await callOnce(provider, promptFor(PhaseEnum.PlanDesign), history, msg);
    const violations = currentViolationsForTurn(scenario, 2, parsed);
    scenario.turns.push(makeTurn(scenario, 2, t, msg, raw, parsed, parseOk, violations));
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: raw });
    gotSchema = !!parsed.data_table_schema;
  }
  if (!gotSchema) {
    scenario.turns.push({
      id: `${scenario.id}:p2:never-schema`,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      phase: 2,
      turn: 99,
      userMsg: '(未产表)',
      raw: '',
      parsed: { dialogue: '', next_action_type: 'info', phase_complete: false },
      parseOk: false,
      actionType: 'none',
      structuredFields: [],
      violations: [{ rule: 'p2-never-schema', detail: '6轮未输出 data_table_schema' }],
    });
  }

  return scenario;
}


function defaultRowsForPersona(persona: StemPersona): Record<string, unknown>[] {
  if (persona.stage3Rows?.length) return persona.stage3Rows;
  const iv = persona.expectedTransformation.independentVariable;
  return [
    { trial: 1, condition: `${iv}-低水平`, result: '较低', notes: '' },
    { trial: 2, condition: `${iv}-中水平`, result: '中等', notes: '' },
    { trial: 3, condition: `${iv}-高水平`, result: '较高', notes: '' },
  ];
}

function renderRowsAsTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '（学生尚未录入数据）';
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const header = keys.join(' | ');
  const body = rows.map((r, i) => `${i + 1}. ` + keys.map((k) => String(r[k] ?? '')).join(' | ')).join('\n');
  return `${header}\n${body}`;
}

function buildSchemaSummaryFromPersona(persona: StemPersona): string {
  const rows = defaultRowsForPersona(persona);
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const cols = keys.map((key) => `${key}(${typeof rows[0]?.[key] === 'number' ? 'number' : 'text'})`).join('、');
  return cols || 'condition(text)、result(text)、notes(text)';
}

function buildPriorSummaryFromPersona(persona: StemPersona): string {
  const e = persona.expectedTransformation;
  return [
    `【选题确认书】\n原始兴趣：${e.originalInterest}\n\n保留的情境特征：${e.retainedFeature}\n\n课堂代理：${e.classroomProxy}\n\n研究问题：${e.researchQuestion}\n\n要改变的（自变量方向）：${e.independentVariable}\n\n想观察/比较的现象：${e.dependentDirection}`,
    `【课题转化链】原始兴趣：${e.originalInterest}；保留特征：${e.retainedFeature}；课堂代理：${e.classroomProxy}；研究问题：${e.researchQuestion}`,
    `自变量：${e.independentVariable}，因变量：${e.dependentDirection}`,
    `【实验方案-数据表列】${buildSchemaSummaryFromPersona(persona)}，最少3行，最多200行`,
    `【实验数据-共${defaultRowsForPersona(persona).length}行】\n${renderRowsAsTable(defaultRowsForPersona(persona))}`,
  ].join('\n\n');
}

async function runPhase3FromPersona(provider: ReturnType<typeof createLLMProvider>, persona: StemPersona): Promise<ScenarioRecord> {
  const scenario: ScenarioRecord = {
    id: `${personaToScenarioId(persona)}-phase3`,
    name: `${persona.name}-阶段3过程执行`,
    kind: 'phase3' as const,
    meta: personaMeta(persona),
    turns: [],
  };
  const history: LLMMessage[] = [];
  const messages = [
    '老师已经通过了我的实验方案，我现在准备开始实验，数据应该记录在哪里？',
    persona.expectedTransformation.safetyNotes?.length
      ? `我会注意安全：${persona.expectedTransformation.safetyNotes.join('；')}。如果实验中出现异常数据怎么办？`
      : '如果实验中出现异常数据怎么办？',
  ];
  for (let t = 1; t <= messages.length; t++) {
    const msg = messages[t - 1];
    const prompt = evaluationPrompt(PhaseEnum.Execution, { needSafetyQuiz: t === 1 });
    const { raw, parsed, parseOk } = await callOnce(provider, prompt, history, msg);
    const violations = currentViolationsForTurn(scenario, 3, parsed);
    scenario.turns.push(makeTurn(scenario, 3, t, msg, raw, parsed, parseOk, violations));
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: raw });
  }
  return scenario;
}

async function runPhase4FromPersona(provider: ReturnType<typeof createLLMProvider>, persona: StemPersona): Promise<ScenarioRecord> {
  const scenario: ScenarioRecord = {
    id: `${personaToScenarioId(persona)}-phase4`,
    name: `${persona.name}-阶段4数据分析`,
    kind: 'phase4' as const,
    meta: personaMeta(persona),
    turns: [],
  };
  const history: LLMMessage[] = [];
  const prompt = evaluationPrompt(PhaseEnum.DataAnalysis, { dataRows: defaultRowsForPersona(persona) });
  const messages = persona.phase4?.length
    ? persona.phase4
    : [
        '这是我收集的数据，帮我看看有什么规律',
        `我发现${persona.expectedTransformation.independentVariable}不同的时候，${persona.expectedTransformation.dependentDirection}好像也不一样，这说明什么？`,
      ];
  for (let t = 1; t <= messages.length; t++) {
    const msg = messages[t - 1];
    const { raw, parsed, parseOk } = await callOnce(provider, prompt, history, msg);
    const violations = currentViolationsForTurn(scenario, 4, parsed);
    scenario.turns.push(makeTurn(scenario, 4, t, msg, raw, parsed, parseOk, violations));
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: raw });
  }
  return scenario;
}

async function runPhase5FromPersona(provider: ReturnType<typeof createLLMProvider>, persona: StemPersona): Promise<ScenarioRecord> {
  const scenario: ScenarioRecord = {
    id: `${personaToScenarioId(persona)}-phase5`,
    name: `${persona.name}-阶段5报告成型`,
    kind: 'phase5' as const,
    meta: personaMeta(persona),
    turns: [],
  };
  const prompt = evaluationPrompt(PhaseEnum.ResultsFormation, { priorSummary: buildPriorSummaryFromPersona(persona) });
  const msg = '开始报告成型，请根据前序阶段摘要自动生成 report_sections 六节预填内容。';
  const { raw, parsed, parseOk } = await callOnce(provider, prompt, [], msg);
  const violations = currentViolationsForTurn(scenario, 5, parsed);
  scenario.turns.push(makeTurn(scenario, 5, 1, msg, raw, parsed, parseOk, violations));
  return scenario;
}

async function runPhase6FromPersona(provider: ReturnType<typeof createLLMProvider>, persona: StemPersona): Promise<ScenarioRecord> {
  const scenario: ScenarioRecord = {
    id: `${personaToScenarioId(persona)}-phase6`,
    name: `${persona.name}-阶段6结果反思`,
    kind: 'phase6' as const,
    meta: personaMeta(persona),
    turns: [],
  };
  const history: LLMMessage[] = [];
  const prompt = evaluationPrompt(PhaseEnum.Reflection);
  const messages = persona.phase6?.length
    ? persona.phase6
    : [
        `这次我研究的是${persona.expectedTransformation.researchQuestion}，我想反思一下有什么不足`,
        '如果下次继续做，我应该怎么改进？',
      ];
  for (let t = 1; t <= messages.length; t++) {
    const msg = messages[t - 1];
    const { raw, parsed, parseOk } = await callOnce(provider, prompt, history, msg);
    const violations = currentViolationsForTurn(scenario, 6, parsed);
    scenario.turns.push(makeTurn(scenario, 6, t, msg, raw, parsed, parseOk, violations));
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: raw });
  }
  return scenario;
}

async function runPhase4(provider: ReturnType<typeof createLLMProvider>): Promise<ScenarioRecord> {
  const scenario = {
    id: 'phase4-data-analysis',
    name: '阶段4数据分析',
    kind: 'phase4' as const,
    turns: [] as TurnRecord[],
  };
  const history: LLMMessage[] = [];
  const prompt = evaluationPrompt(PhaseEnum.DataAnalysis, { dataRows: DATA_ROWS });
  const messages = ['这是我收集的数据，帮我看看有什么规律', '我发现白光组发芽最快，绿光组最慢，这说明什么？'];
  for (let t = 1; t <= messages.length; t++) {
    const msg = messages[t - 1];
    const { raw, parsed, parseOk } = await callOnce(provider, prompt, history, msg);
    const violations = currentViolationsForTurn(scenario, 4, parsed);
    scenario.turns.push(makeTurn(scenario, 4, t, msg, raw, parsed, parseOk, violations));
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: raw });
  }
  return scenario;
}

async function runPhase5(provider: ReturnType<typeof createLLMProvider>): Promise<ScenarioRecord> {
  const scenario = {
    id: 'phase5-report',
    name: '阶段5报告成型',
    kind: 'phase5' as const,
    turns: [] as TurnRecord[],
  };
  const prompt = evaluationPrompt(PhaseEnum.ResultsFormation, { priorSummary: PRIOR_SUMMARY });
  const msg = '开始报告成型';
  const { raw, parsed, parseOk } = await callOnce(provider, prompt, [], msg);
  const violations = currentViolationsForTurn(scenario, 5, parsed);
  scenario.turns.push(makeTurn(scenario, 5, 1, msg, raw, parsed, parseOk, violations));
  return scenario;
}

function collectSummary(scenarios: ScenarioRecord[]): Transcript['summary'] {
  const turns = scenarios.flatMap((s) => s.turns);
  const violationsByRule: Record<string, number> = {};
  for (const turn of turns) {
    for (const violation of turn.violations) {
      violationsByRule[violation.rule] = (violationsByRule[violation.rule] ?? 0) + 1;
    }
  }
  return {
    scenarios: scenarios.length,
    turns: turns.length,
    parseOk: turns.filter((t) => t.parseOk).length,
    cleanTurns: turns.filter((t) => t.parseOk && t.violations.length === 0).length,
    violationsByRule,
  };
}

function collectModelConfig(): Transcript['modelConfig'] {
  const config = validateConfig();
  const provider = config.provider;
  const baseURL = provider === 'deepseek'
    ? (process.env.DEEPSEEK_API_BASE ?? 'https://api.deepseek.com')
    : provider === 'openai'
      ? (process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1')
      : null;
  return {
    provider,
    model: config.model,
    baseURL,
    timeoutMs: process.env.LLM_TIMEOUT_MS ?? null,
    maxTokens: process.env.LLM_MAX_TOKENS ?? null,
  };
}

async function collect(options: CollectOptions) {
  const tag = safeTag(process.env.MODEL_TAG);
  evaluationStyleFamily = options.styleFamily;
  evaluationStylePolicyVersion = DEFAULT_STYLE_POLICY_VERSION;
  const provider = createLLMProvider();
  const scenarios: ScenarioRecord[] = [];
  await mkdir(OUT_DIR, { recursive: true });

  const personas = selectedPersonas(options);
  console.log(`Collecting ${tag} (${options.scope}; ${STYLE_LABELS[options.styleFamily]})`);
  console.log(`Personas: ${personas.length}; stages: ${options.stages.join(',')}; regression: ${options.includeRegression}`);

  for (const persona of personas) {
    if (options.stages.includes('persona')) {
      console.log(`- persona: ${persona.name}`);
      scenarios.push(await runPersona(provider, persona));
    }
    if (options.stages.includes('3')) {
      console.log(`- phase3: ${persona.name}`);
      scenarios.push(await runPhase3FromPersona(provider, persona));
    }
    if (options.stages.includes('4')) {
      console.log(`- phase4: ${persona.name}`);
      scenarios.push(await runPhase4FromPersona(provider, persona));
    }
    if (options.stages.includes('5')) {
      console.log(`- phase5: ${persona.name}`);
      scenarios.push(await runPhase5FromPersona(provider, persona));
    }
    if (options.stages.includes('6')) {
      console.log(`- phase6: ${persona.name}`);
      scenarios.push(await runPhase6FromPersona(provider, persona));
    }
  }

  if (options.includeRegression) {
    console.log('- regression phase4');
    scenarios.push(await runPhase4(provider));
    console.log('- regression phase5');
    scenarios.push(await runPhase5(provider));
  }

  const transcript: Transcript = {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    tag,
    createdAt: new Date().toISOString(),
    scope: options.scope,
    styleFamily: options.styleFamily,
    stylePolicyVersion: evaluationStylePolicyVersion,
    modelConfig: collectModelConfig(),
    summary: collectSummary(scenarios),
    scenarios,
  };
  const outPath = path.join(OUT_DIR, `transcript-${tag}.json`);
  await writeFile(outPath, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath}`);
  console.log(`Scenarios: ${transcript.summary.scenarios}, turns: ${transcript.summary.turns}, parseOk: ${transcript.summary.parseOk}, clean: ${transcript.summary.cleanTurns}`);
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const direct = tryParseJson(trimmed);
  if (direct !== undefined) return direct;
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) {
    const parsed = tryParseJson(fence[1].trim()) ?? tryParseJson(repairJson(fence[1].trim()));
    if (parsed !== undefined) return parsed;
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    const parsed = tryParseJson(slice) ?? tryParseJson(repairJson(slice));
    if (parsed !== undefined) return parsed;
  }
  throw new Error(`无法解析裁判 JSON: ${trimmed.slice(0, 200)}`);
}

function tryParseJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function validateJudgeResponse(raw: string): JudgeResponse {
  const obj = parseJsonObject(raw);
  if (!obj || typeof obj !== 'object') throw new Error('裁判输出不是 JSON 对象');
  const rec = obj as Record<string, unknown>;
  if (rec.winner !== 'X' && rec.winner !== 'Y' && rec.winner !== 'tie') {
    throw new Error('裁判 winner 必须是 X、Y 或 tie');
  }
  const dimensions: Partial<Record<DimensionKey, JudgeWinner>> = {};
  if (rec.dimensions && typeof rec.dimensions === 'object') {
    const dimRec = rec.dimensions as Record<string, unknown>;
    for (const key of DIMENSIONS) {
      const value = dimRec[key];
      if (value === 'X' || value === 'Y' || value === 'tie') dimensions[key] = value;
    }
  }
  return {
    winner: rec.winner,
    dimensions,
    reason: typeof rec.reason === 'string' ? rec.reason : '',
    preferencePair: rec.preferencePair && typeof rec.preferencePair === 'object'
      ? rec.preferencePair as JudgeResponse['preferencePair']
      : undefined,
  };
}

function judgeConfig() {
  const apiKey = process.env.JUDGE_API_KEY?.trim();
  const baseURL = process.env.JUDGE_API_BASE?.trim();
  const model = process.env.JUDGE_MODEL?.trim();
  if (!apiKey || !baseURL || !model) {
    throw new Error('judge 需要 JUDGE_API_KEY、JUDGE_API_BASE、JUDGE_MODEL');
  }
  return {
    apiKey,
    baseURL: baseURL.replace(/\/+$/, ''),
    model,
    timeoutMs: Number(process.env.JUDGE_TIMEOUT_MS ?? 180_000),
    maxTokens: Number(process.env.JUDGE_MAX_TOKENS ?? 2000),
  };
}

async function callJudge(systemPrompt: string, userPrompt: string): Promise<JudgeResponse> {
  const cfg = judgeConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: cfg.maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`裁判模型请求失败 HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('裁判模型返回空内容');
    return validateJudgeResponse(content);
  } finally {
    clearTimeout(timer);
  }
}

function judgeSystemPrompt(): string {
  return `你是严谨的 STEM 教育产品双盲评测裁判。你只比较导师X和导师Y在同一场景中的表现，不知道它们来自哪个模型。

评估维度：
1. teaching_guidance：启发式引导，避免代答，适合初中学生。
2. theme_fidelity：是否保留学生原始兴趣里的关键机制、约束或情境特征；禁止把题目偷偷换成另一个更好做但不保真的题。
3. student_agency：关键变量、代理方向是否由学生逐步说出；禁止隐藏 ABC、成组选项、导师代定题或一次性给完整路线。
4. proxy_quality：课堂代理是否安全、可操作、低成本，且能有效模拟原主题的关键特征。
5. transformation_reasoning：是否解释清楚“为什么这个课堂代理仍然和原主题有关”，而不是只给最终题目。
6. interdisciplinary_integration：是否真实连接科学、工程、技术、数学等视角；禁止堆跨学科名词。
7. cognitive_load_control：是否控制学生认知负荷，每轮只给一个核心思考任务；禁止一次塞入变量、材料、步骤、方案。
8. stage_discipline：遵守阶段边界，该收敛时收敛，不越界拖延。
9. stem_fit：能把科学探究/工程项目转化为可变量化、可记录的任务。
10. safety：识别安全风险，给出低风险替代。
11. structure_compliance：按协议产出确认书、theme_mapping、数据表、报告结构等字段。
12. expression：表达简洁、清楚、少废话，格式稳定。

判定原则：
- theme_mapping 只是结构化证据，不等于已经完成创造性启发；必须优先看对话过程。
- 若导师使用隐藏 ABC、现成课题清单或替学生直接定题，student_agency 必须判负。
- 若课堂代理偏离学生原始机制，theme_fidelity 必须判负，即使代理本身很聪明。
- 阶段1/创造性场景中，theme_fidelity、student_agency、proxy_quality 的重要性高于表达流畅度。
- reason 中请点名关键失败类型：换题、代答、ABC、代理弱关联、跨学科空泛、越阶段。

输出必须是 JSON 对象，格式：
{
  "winner": "X" | "Y" | "tie",
  "dimensions": {
    "teaching_guidance": "X" | "Y" | "tie",
    "theme_fidelity": "X" | "Y" | "tie",
    "student_agency": "X" | "Y" | "tie",
    "proxy_quality": "X" | "Y" | "tie",
    "transformation_reasoning": "X" | "Y" | "tie",
    "interdisciplinary_integration": "X" | "Y" | "tie",
    "cognitive_load_control": "X" | "Y" | "tie",
    "stage_discipline": "X" | "Y" | "tie",
    "stem_fit": "X" | "Y" | "tie",
    "safety": "X" | "Y" | "tie",
    "structure_compliance": "X" | "Y" | "tie",
    "expression": "X" | "Y" | "tie"
  },
  "reason": "不超过120字的中文理由",
  "preferencePair": {
    "winnerExcerpt": "胜出方关键片段",
    "loserExcerpt": "落败方关键片段"
  }
}
不要输出 JSON 以外的任何文字。`;
}

function formatTurnForJudge(turn: TurnRecord): string {
  const violations = turn.violations.length
    ? turn.violations.map((v) => `${v.rule}: ${v.detail}`).join('; ')
    : '无';
  const hints = turn.parsed.hints?.length ? turn.parsed.hints.join('；') : '无';
  const mapping = turn.parsed.theme_mapping ? JSON.stringify(turn.parsed.theme_mapping) : '无';
  return [
    `轮次: P${turn.phase}T${turn.turn}`,
    `学生: ${turn.userMsg}`,
    `导师: ${turn.parsed.dialogue}`,
    `思考线索: ${hints}`,
    `动作: ${turn.actionType}`,
    `结构化字段: ${turn.structuredFields.length ? turn.structuredFields.join(', ') : '无'}`,
    `课题转化链: ${mapping}`,
    `自动检查: ${violations}`,
  ].join('\n');
}

function formatScenarioForJudge(scenario: ScenarioRecord): string {
  return scenario.turns.map(formatTurnForJudge).join('\n\n');
}

function buildJudgePrompt(title: string, xText: string, yText: string): string {
  return `请比较同一场景下两位导师的表现。

【场景】
${title}

${xText}

${yText}

请按系统给出的维度综合判断。自动检查项可作为结构化合规参考，但不要只按违规数量机械判定；连续教学质量、学生主体性、原题保真和阶段推进效果更重要。`;
}

function mapJudgeWinner(winner: JudgeWinner, xIsA: boolean): Winner {
  if (winner === 'tie') return 'tie';
  if (winner === 'X') return xIsA ? 'A' : 'B';
  return xIsA ? 'B' : 'A';
}

function mapDimensions(dim: Partial<Record<DimensionKey, JudgeWinner>>, xIsA: boolean): Partial<Record<DimensionKey, Winner>> {
  const out: Partial<Record<DimensionKey, Winner>> = {};
  for (const key of DIMENSIONS) {
    const value = dim[key];
    if (value) out[key] = mapJudgeWinner(value, xIsA);
  }
  return out;
}

function mergeDimensions(
  left: Partial<Record<DimensionKey, Winner>>,
  right: Partial<Record<DimensionKey, Winner>>
): Partial<Record<DimensionKey, Winner>> {
  const out: Partial<Record<DimensionKey, Winner>> = {};
  for (const key of DIMENSIONS) {
    out[key] = left[key] && left[key] === right[key] ? left[key] : 'tie';
  }
  return out;
}

async function bidirectionalJudge(id: string, title: string, aText: string, bText: string): Promise<FinalVerdict> {
  const systemPrompt = judgeSystemPrompt();
  const aAsX = await callJudge(systemPrompt, buildJudgePrompt(title, `【导师X】\n${aText}`, `【导师Y】\n${bText}`));
  const bAsX = await callJudge(systemPrompt, buildJudgePrompt(title, `【导师X】\n${bText}`, `【导师Y】\n${aText}`));
  const winner1 = mapJudgeWinner(aAsX.winner, true);
  const winner2 = mapJudgeWinner(bAsX.winner, false);
  const winner = winner1 === winner2 ? winner1 : 'tie';
  return {
    id,
    title,
    winner,
    inconsistent: winner1 !== winner2,
    dimensions: mergeDimensions(mapDimensions(aAsX.dimensions ?? {}, true), mapDimensions(bAsX.dimensions ?? {}, false)),
    reasons: {
      aAsX: aAsX.reason,
      bAsX: bAsX.reason,
    },
    rawJudgeResponses: {
      aAsX,
      bAsX,
    },
  };
}


function normalizeScenarioRecord(scenario: ScenarioRecord): ScenarioRecord {
  if (scenario.kind !== 'persona') return scenario;
  const persona = personaForScenario(scenario);
  if (!persona) return scenario;
  const normalizedId = personaToScenarioId(persona);
  return {
    ...scenario,
    id: normalizedId,
    meta: scenario.meta ?? personaMeta(persona),
    turns: scenario.turns.map((turn) => ({
      ...turn,
      scenarioId: normalizedId,
      scenarioName: scenario.name,
    })),
  };
}

async function readTranscript(tag: string): Promise<Transcript> {
  const file = path.join(OUT_DIR, `transcript-${safeTag(tag)}.json`);
  const raw = await readFile(file, 'utf8');
  const parsed = JSON.parse(raw) as Transcript;
  if (parsed.schemaVersion !== TRANSCRIPT_SCHEMA_VERSION) {
    throw new Error(`${file} schemaVersion 不兼容：需要 ${TRANSCRIPT_SCHEMA_VERSION}，实际 ${parsed.schemaVersion}`);
  }
  return {
    ...parsed,
    scenarios: parsed.scenarios.map((rawScenario) => {
      const scenario = normalizeScenarioRecord(rawScenario);
      return {
        ...scenario,
        turns: scenario.turns.map((turn) => ({
          ...turn,
          structuredFields: structuredFields(turn.parsed),
          violations: currentViolationsForTurn(scenario, turn.phase, turn.parsed),
        })),
      };
    }),
  };
}

function scenarioMatchesPersonaScope(scenario: ScenarioRecord, persona: StemPersona): boolean {
  const base = personaToScenarioId(persona);
  return (
    scenario.meta?.personaId === persona.id ||
    scenario.id === base ||
    scenario.id.startsWith(`${base}-`) ||
    scenario.id === `persona-${persona.name}`
  );
}

function filterScenarios(transcript: Transcript, scope: Scope, scenarioFilter?: string): ScenarioRecord[] {
  if (scenarioFilter) {
    const scenarios = transcript.scenarios.filter((s) => s.id === scenarioFilter || s.name === scenarioFilter || s.meta?.personaId === scenarioFilter);
    if (scenarios.length === 0) {
      throw new Error(`${transcript.tag} transcript 找不到场景: ${scenarioFilter}`);
    }
    return scenarios;
  }

  const personas = selectedPersonas(scope);
  const scenarios = transcript.scenarios.filter((s) =>
    s.id === 'phase4-data-analysis' ||
    s.id === 'phase5-report' ||
    personas.some((p) => scenarioMatchesPersonaScope(s, p))
  );
  if (scenarios.length === 0) {
    throw new Error(`${transcript.tag} transcript 在 scope=${scope} 下没有可评测场景`);
  }
  return scenarios;
}

function pairScenarios(a: ScenarioRecord[], b: ScenarioRecord[]) {
  const bMap = new Map(b.map((s) => [s.id, s]));
  const pairs = a.flatMap((left) => {
    const right = bMap.get(left.id);
    return right ? [{ left, right }] : [];
  });
  if (pairs.length === 0) throw new Error('两个 transcript 没有可对齐的共同场景');
  const skipped = a.length - pairs.length;
  if (skipped > 0) console.warn(`跳过 ${skipped} 个 B transcript 中不存在的场景`);
  return pairs;
}

function missingTurn(existing: TurnRecord, side: 'A' | 'B'): TurnRecord {
  return {
    ...existing,
    id: `${existing.id}:missing-${side}`,
    raw: '',
    parsed: {
      dialogue: '（该模型在此前已完成本阶段或场景，因此没有此轮回复。）',
      next_action_type: 'info',
      phase_complete: true,
    },
    parseOk: true,
    actionType: 'none',
    structuredFields: [],
    violations: [],
  };
}

function pairTurns(a: ScenarioRecord, b: ScenarioRecord[]) {
  const bScenario = b.find((s) => s.id === a.id);
  if (!bScenario) return [];
  const aTurns = new Map(a.turns.map((t) => [`p${t.phase}:t${t.turn}`, t]));
  const bTurns = new Map(bScenario.turns.map((t) => [`p${t.phase}:t${t.turn}`, t]));
  const keys = [...new Set([...aTurns.keys(), ...bTurns.keys()])].sort();
  return keys.map((key) => {
    const left = aTurns.get(key);
    const right = bTurns.get(key);
    if (left && right) return { left, right };
    if (left) return { left, right: missingTurn(left, 'B') };
    if (right) return { left: missingTurn(right, 'A'), right };
    throw new Error(`无法对齐轮次 ${key}`);
  });
}

function countSummary(verdicts: FinalVerdict[]): CountSummary {
  return {
    A: verdicts.filter((v) => v.winner === 'A').length,
    B: verdicts.filter((v) => v.winner === 'B').length,
    tie: verdicts.filter((v) => v.winner === 'tie').length,
    inconsistent: verdicts.filter((v) => v.inconsistent).length,
  };
}

function dimensionSummary(scenarioVerdicts: FinalVerdict[]): Record<DimensionKey, CountSummary> {
  const out = {} as Record<DimensionKey, CountSummary>;
  for (const key of DIMENSIONS) {
    const values = scenarioVerdicts.map((v) => ({
      winner: v.dimensions[key] ?? 'tie',
      inconsistent: false,
    })) as Array<{ winner: Winner; inconsistent: boolean }>;
    out[key] = {
      A: values.filter((v) => v.winner === 'A').length,
      B: values.filter((v) => v.winner === 'B').length,
      tie: values.filter((v) => v.winner === 'tie').length,
      inconsistent: 0,
    };
  }
  return out;
}

async function judge(tagA: string, tagB: string, scope: Scope, judgeLevel: JudgeLevel, scenarioFilter?: string) {
  const transcriptA = await readTranscript(tagA);
  const transcriptB = await readTranscript(tagB);
  if (transcriptA.styleFamily && transcriptB.styleFamily && transcriptA.styleFamily !== transcriptB.styleFamily) {
    throw new Error(`不能比较不同目标风格：${transcriptA.styleFamily} vs ${transcriptB.styleFamily}`);
  }
  if (transcriptA.stylePolicyVersion && transcriptB.stylePolicyVersion && transcriptA.stylePolicyVersion !== transcriptB.stylePolicyVersion) {
    throw new Error(`不能比较不同风格规范版本：${transcriptA.stylePolicyVersion} vs ${transcriptB.stylePolicyVersion}`);
  }
  const scenariosA = filterScenarios(transcriptA, scope, scenarioFilter);
  const scenariosB = filterScenarios(transcriptB, scope, scenarioFilter);
  const scenarioPairs = pairScenarios(scenariosA, scenariosB);

  const scenarioVerdicts: FinalVerdict[] = [];
  const turnVerdicts: FinalVerdict[] = [];

  console.log(`Judging ${tagA} vs ${tagB} (${scope})`);
  for (const { left, right } of scenarioPairs) {
    console.log(`- scenario: ${left.name}`);
    scenarioVerdicts.push(await bidirectionalJudge(
      left.id,
      left.name,
      formatScenarioForJudge(left),
      formatScenarioForJudge(right)
    ));
  }

  if (judgeLevel === 'full') {
    for (const scenario of scenariosA) {
      for (const { left, right } of pairTurns(scenario, scenariosB)) {
        const title = `${left.scenarioName} P${left.phase}T${left.turn}`;
        turnVerdicts.push(await bidirectionalJudge(
          left.id,
          title,
          formatTurnForJudge(left),
          formatTurnForJudge(right)
        ));
      }
    }
  }

  const cfg = judgeConfig();
  const verdict: VerdictFile = {
    schemaVersion: VERDICT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    scope,
    judgeLevel,
    tags: { A: transcriptA.tag, B: transcriptB.tag },
    styleFamily: transcriptA.styleFamily ?? transcriptB.styleFamily,
    stylePolicyVersion: transcriptA.stylePolicyVersion ?? transcriptB.stylePolicyVersion,
    judgeConfig: {
      baseURL: cfg.baseURL,
      model: cfg.model,
      timeoutMs: cfg.timeoutMs,
      maxTokens: cfg.maxTokens,
      temperature: 0,
    },
    summary: {
      scenario: countSummary(scenarioVerdicts),
      turn: countSummary(turnVerdicts),
      dimensions: dimensionSummary(scenarioVerdicts),
    },
    scenarioVerdicts,
    turnVerdicts,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const scenarioSuffix = scenarioFilter ? `-${safeFilePart(scenarioFilter)}` : '';
  const outPath = path.join(OUT_DIR, `verdict-${safeTag(tagA)}-vs-${safeTag(tagB)}${scenarioSuffix}.json`);
  await writeFile(outPath, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath}`);
  console.log(`Scenario wins: A=${verdict.summary.scenario.A}, B=${verdict.summary.scenario.B}, tie=${verdict.summary.scenario.tie}, inconsistent=${verdict.summary.scenario.inconsistent}`);
  if (judgeLevel === 'full') {
    console.log(`Turn wins: A=${verdict.summary.turn.A}, B=${verdict.summary.turn.B}, tie=${verdict.summary.turn.tie}, inconsistent=${verdict.summary.turn.inconsistent}`);
  } else {
    console.log('Turn wins: skipped (--judge-level scenario)');
  }
}

async function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  let raw = '';
  try {
    raw = await readFile(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let value = trimmed.slice(idx + 1).replace(/\s+#.*$/, '').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}


function positionalArgs(args: string[]): string[] {
  const valueFlags = new Set([
    '--scope', '--judge-level', '--scenario', '--stages', '--limit', '--subject',
    '--student-type', '--difficulty', '--persona', '--tag', '--style', '--include-regression',
  ]);
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (valueFlags.has(arg)) i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

async function main() {
  await loadDotEnv();
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const command = args[0];
  const scope = parseScope(args);
  const judgeLevel = parseJudgeLevel(args);
  const scenarioFilter = parseScenarioFilter(args);
  if (command === 'collect') {
    await collect(parseCollectOptions(args, scope));
    return;
  }
  if (command === 'judge') {
    const [tagA, tagB] = positionalArgs(args).slice(1);
    if (!tagA || !tagB) throw new Error('judge 需要两个 transcript tag');
    await judge(tagA, tagB, scope, judgeLevel, scenarioFilter);
    return;
  }
  throw new Error(`未知命令: ${command}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
