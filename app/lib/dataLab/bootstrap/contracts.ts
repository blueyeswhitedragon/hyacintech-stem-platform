import { createHash } from 'crypto';
import { buildTutorLanguagePrompt, parseTutorLanguageResponse, type TutorLanguagePromptVersion, type TutorLanguageResponse } from '@/app/lib/tutorLanguage';
import { inferModelFamily } from '@/app/lib/stateExtractor';
import { deriveAcceptableDirections, normalizeInquiryBridges, TOPIC_CARD_SCHEMA_V2, validateTopicCardV2, type TopicActivityMode, type TopicCardV2Fields, type TopicContextModule, type TopicDisciplineAnchor, type TopicInquiryBridge } from './topicCardV2';

export const BOOTSTRAP_SUBJECTS = [
  'biology_ecology',
  'chemistry',
  'physics',
  'engineering',
  'high_concept_interdisciplinary',
] as const;
export type BootstrapSubject = (typeof BOOTSTRAP_SUBJECTS)[number];

export const TUTOR_CASE_SPLITS = ['TRAIN', 'PILOT', 'EVAL'] as const;
export type TutorCaseSplit = (typeof TUTOR_CASE_SPLITS)[number];

export interface TopicCardInput {
  displayTitle: string;
  studentOpening: string;
  internalArchetype: string;
  subject: BootstrapSubject;
  gradeBand: string;
  coreMechanism: string;
  acceptableDirections: string[];
  forbiddenDirections: string[];
  curriculumAnchors: string[];
  source: Record<string, unknown>;
  compilerEvidence?: Record<string, unknown>;
  criticOverrideReason?: string;
  schemaVersion?: 1 | 2;
  activityMode?: TopicActivityMode;
  contextModule?: TopicContextModule;
  disciplineAnchors?: TopicDisciplineAnchor[];
  authenticNeed?: string;
  stakeholder?: string;
  engineeringGoal?: string;
  constraints?: string[];
  performanceCriteria?: string[];
  inquiryBridges?: TopicInquiryBridge[];
  sourceCandidateId?: string;
}

export function topicCardV2Fields(input: TopicCardInput): TopicCardV2Fields | null {
  if (input.schemaVersion !== TOPIC_CARD_SCHEMA_V2) return null;
  return {
    schemaVersion: TOPIC_CARD_SCHEMA_V2,
    activityMode: input.activityMode as TopicActivityMode,
    contextModule: input.contextModule as TopicContextModule,
    disciplineAnchors: input.disciplineAnchors ?? [],
    authenticNeed: input.authenticNeed ?? '',
    stakeholder: input.stakeholder,
    engineeringGoal: input.engineeringGoal,
    constraints: input.constraints ?? [],
    performanceCriteria: input.performanceCriteria ?? [],
    inquiryBridges: normalizeInquiryBridges(input.inquiryBridges),
    sourceCandidateId: input.sourceCandidateId,
  };
}

export interface CandidateModelConfig {
  provider: string;
  model: string;
  family?: string;
  tag?: string;
}

export interface DeterministicIssue {
  id: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  evidence?: string;
}

export interface CandidateCheck {
  ok: boolean;
  hardErrorCount: number;
  warningCount: number;
  issues: DeterministicIssue[];
}

export const TUTOR_CRITIQUE_CATEGORIES = ['grounding', 'pedagogy', 'safety', 'leakage', 'contract'] as const;
export type TutorCritiqueCategory = (typeof TUTOR_CRITIQUE_CATEGORIES)[number];
export type TutorCritiqueConfidence = 'high' | 'medium' | 'low';

export interface TutorCritiqueIssue {
  quote: string;
  category: TutorCritiqueCategory;
  message: string;
  sourceQuote: string;
  confidence: TutorCritiqueConfidence;
}

export function validateTutorCritiqueIssues(input: unknown, candidateText: string, visibleEvidenceText: string) {
  const rawIssues = Array.isArray(input) ? input : [];
  const blocking: TutorCritiqueIssue[] = [];
  const advisories: TutorCritiqueIssue[] = [];
  for (const raw of rawIssues) {
    if (!raw || typeof raw !== 'object') continue;
    const value = raw as Record<string, unknown>;
    const quote = typeof value.quote === 'string' ? value.quote.trim() : '';
    const category = typeof value.category === 'string' && TUTOR_CRITIQUE_CATEGORIES.includes(value.category as TutorCritiqueCategory)
      ? value.category as TutorCritiqueCategory
      : null;
    const message = typeof value.message === 'string' ? value.message.trim() : '';
    const sourceQuote = typeof value.sourceQuote === 'string' ? value.sourceQuote.trim() : '';
    const confidence: TutorCritiqueConfidence = value.confidence === 'high' || value.confidence === 'medium' ? value.confidence : 'low';
    if (!quote || !category || !message) continue;
    const issue: TutorCritiqueIssue = { quote, category, message, sourceQuote, confidence };
    const quoteLocated = candidateText.includes(quote);
    const sourceLocated = category !== 'grounding' || Boolean(sourceQuote && visibleEvidenceText.includes(sourceQuote));
    if (confidence === 'high' && quoteLocated && sourceLocated) blocking.push(issue);
    else advisories.push(issue);
  }
  return { blocking, advisories };
}

const INTERNAL_TEXT = [
  'internalArchetype', 'privateReviewSpec', 'acceptableDirections', 'forbiddenMoves',
  'rubric', 'gold', 'archetype', '高概念降级型-火星基地植物',
];
const INTERNAL_SCHEMA_KEY = /\b(?:result_[a-z0-9]+|level_\d+_result|private_review_spec|internal_archetype)\b/i;

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeModelFamily(config: CandidateModelConfig): string {
  return config.family?.trim().toLowerCase() || inferModelFamily(config.provider, config.model);
}

export function assertIndependentModelFamilies(a: CandidateModelConfig, b: CandidateModelConfig) {
  const familyA = normalizeModelFamily(a);
  const familyB = normalizeModelFamily(b);
  if (!familyA || !familyB || familyA === familyB) {
    throw new Error(`候选 A/B 必须来自不同模型家族；当前为 ${familyA || 'unknown'} / ${familyB || 'unknown'}`);
  }
  return { familyA, familyB };
}

function issue(code: string, severity: DeterministicIssue['severity'], message: string, evidence?: string): DeterministicIssue {
  return { id: `${code}:${sha256(`${message}:${evidence ?? ''}`).slice(0, 10)}`, code, severity, message, evidence };
}

function hintLooksLikeMenu(hint: string): boolean {
  const explicitSeparators = hint.match(/、|[；;\/]|，(?:或者|或|也可以|还可以)/g) ?? [];
  if (explicitSeparators.length >= 2) return true;
  const commaChunks = hint.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
  const shortNounList = commaChunks.length >= 3
    && commaChunks.every((item) => item.length <= 10 && !/[？?。！!：:]/.test(item))
    && !/(如果|是否|会不会|可以|应该|保持|改变|结果|怎样|怎么)/.test(hint);
  return shortNounList || /光照.{0,6}大气.{0,6}土壤/.test(hint);
}

function dialogueLooksLikeAnswerMenu(dialogue: string): boolean {
  const example = dialogue.match(/(?:比如|例如)([^。！!]+)/)?.[1] ?? '';
  const exampleHasAlternatives = /还是|或者|、.*(?:、|或)/.test(example);
  const explicitChoiceList = /(?:选择|选一个|从中选)[^。！!？?]{0,100}(?:还是|或者|、.*(?:、|或))/.test(dialogue);
  const pairedChoiceQuestion = /哪(?:一|个|些)[^。！!？?]{0,100}(?:还是|或者)/.test(dialogue);
  const directAlternativeQuestion = /(?:具体是|指的是|是指|究竟是|到底是)[^。！!？?]{0,120}(?:还是|或者)/.test(dialogue);
  const choiceIndex = dialogue.search(/(?:哪(?:一|个|些|点)|选择|选一个)/);
  const beforeChoice = choiceIndex >= 0 ? dialogue.slice(0, choiceIndex) : '';
  const introducedList = /(?:可以指|包括|有(?:这些|几种)|例如|比如|[：:])/.test(beforeChoice)
    && (beforeChoice.match(/、/g) ?? []).length >= 2;
  return exampleHasAlternatives || explicitChoiceList || pairedChoiceQuestion || directAlternativeQuestion || introducedList;
}

export function checkTutorCandidate(input: {
  rawOutput: string;
  allowedFocusIds: string[];
  phase: number;
  triggerType: string;
  studentMessage: string;
}): { normalized: TutorLanguageResponse | null; check: CandidateCheck } {
  const normalized = parseTutorLanguageResponse(input.rawOutput, input.allowedFocusIds);
  const issues: DeterministicIssue[] = [];
  if (!normalized) issues.push(issue('CONTRACT_INVALID', 'error', '候选不符合 tutor-language-v1 结构或 allowed focus 约束'));
  if (normalized) {
    const text = `${normalized.dialogue}\n${normalized.hints.join('\n')}`;
    for (const internal of INTERNAL_TEXT) {
      if (text.toLowerCase().includes(internal.toLowerCase())) issues.push(issue('INTERNAL_LABEL_LEAK', 'error', '候选泄漏内部标签', internal));
    }
    if (INTERNAL_SCHEMA_KEY.test(text)) issues.push(issue('INTERNAL_SCHEMA_KEY', 'error', '候选包含内部数据字段 key', text.match(INTERNAL_SCHEMA_KEY)?.[0]));
    if (normalized.hints.some(hintLooksLikeMenu)) issues.push(issue('HIDDEN_HINT_MENU', 'error', 'hints 形成了三个及以上方向的隐藏答案菜单', normalized.hints.join('；')));
    const answerMenu = dialogueLooksLikeAnswerMenu(normalized.dialogue);
    if (answerMenu) issues.push(issue('DIALOGUE_ANSWER_MENU', 'warning', 'dialogue 可能直接给出多个候选答案或观察指标，需确认是否压缩了学生自主选择', normalized.dialogue));
    if (normalized.hints.some((hint) => normalized.dialogue.includes(hint) || hint.includes(normalized.dialogue))) {
      issues.push(issue('DIALOGUE_HINT_DUPLICATE', 'error', 'dialogue 与 hints 重复'));
    }
    if (input.triggerType === 'SYSTEM_TRIGGER' && /你刚才|你说|学生说|系统触发/.test(normalized.dialogue)) {
      issues.push(issue('SYSTEM_TRIGGER_AS_STUDENT', 'error', '系统触发被描述成学生发言', normalized.dialogue));
    }
    if (input.phase === 4 && INTERNAL_SCHEMA_KEY.test(normalized.dialogue)) issues.push(issue('P4_INTERNAL_KEY', 'error', 'P4 导师语言引用内部列 key'));
    const questionCount = (normalized.dialogue.match(/[？?]/g) ?? []).length;
    if (questionCount > 1 && !answerMenu) issues.push(issue('MULTIPLE_QUESTION_MARKS', 'warning', 'dialogue 出现多个问号；这只是表面结构信号，需由人工判断它们是同一任务的反问/递进，还是多个独立问题', normalized.dialogue));
    if (normalized.dialogue.length > 220) issues.push(issue('DIALOGUE_TOO_LONG', 'warning', 'dialogue 超过 220 字，需确认认知负担和单任务边界', normalized.dialogue));
    if (/太棒了|非常好|做得很好|真厉害/.test(normalized.dialogue)) issues.push(issue('GENERIC_PRAISE', 'warning', '出现可能模板化的泛化表扬', normalized.dialogue));
  }
  const hardErrorCount = issues.filter((item) => item.severity === 'error').length;
  return { normalized, check: { ok: hardErrorCount === 0, hardErrorCount, warningCount: issues.length - hardErrorCount, issues } };
}

export function buildCaseTutorPrompt(input: {
  phase: number;
  triggerType: string;
  visibleFacts: unknown;
  allowedFocusIds: string[];
  focusDescriptions?: Record<string, string>;
  promptVersion?: TutorLanguagePromptVersion;
}) {
  const { promptVersion, ...promptInput } = input;
  return buildTutorLanguagePrompt(promptInput, promptVersion);
}

export function validateTopicCardInput(input: TopicCardInput): string[] {
  const errors: string[] = [];
  if (!input.displayTitle.trim() || input.displayTitle.trim().length > 80) errors.push('学生可见标题需为 1-80 字');
  if (!input.studentOpening.trim()) errors.push('自然开场必填');
  if (!BOOTSTRAP_SUBJECTS.includes(input.subject)) errors.push('无法匹配五个目标领域，禁止回退到通用模板');
  if (!input.coreMechanism.trim()) errors.push('核心机制必填');
  const v2 = topicCardV2Fields(input);
  const directions = v2 ? deriveAcceptableDirections(v2.inquiryBridges) : input.acceptableDirections.filter(Boolean);
  if (directions.length < 2) errors.push('至少需要两个可接受方向，避免唯一答案');
  if (input.curriculumAnchors.filter(Boolean).length === 0) errors.push('至少需要一个课程锚点');
  const sourceTitle = typeof input.source.title === 'string' ? input.source.title.trim() : '';
  if (sourceTitle && sourceTitle === input.displayTitle.trim()) errors.push('学生可见标题不得直接复制原始资源标题');
  if (/archetype|rubric|高概念降级型|变量混乱型|一次给全型/.test(input.displayTitle + input.studentOpening)) errors.push('学生可见文本包含内部术语');
  if (v2) errors.push(...validateTopicCardV2(v2));
  return [...new Set(errors)];
}

export function casePromptLeaksPrivate(prompt: string, privateSpec: Record<string, unknown>): string[] {
  const leaks: string[] = [];
  const values = [
    ...(Array.isArray(privateSpec.acceptableDirections) ? privateSpec.acceptableDirections : []),
    ...(Array.isArray(privateSpec.forbiddenMoves) ? privateSpec.forbiddenMoves : []),
    privateSpec.internalArchetype,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length >= 4);
  for (const value of values) if (prompt.includes(value)) leaks.push(value);
  return leaks;
}

export function tutorTargetContainsServerArtifact(target: string): boolean {
  try {
    const parsed = JSON.parse(target) as Record<string, unknown>;
    return ['stage1_confirmed', 'snapshot', 'data_table_schema', 'safety_quiz', 'analysis_progress', 'report_sections', 'phase_complete'].some((key) => Object.hasOwn(parsed, key));
  } catch {
    return true;
  }
}
