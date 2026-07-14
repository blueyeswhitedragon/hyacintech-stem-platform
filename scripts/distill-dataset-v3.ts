#!/usr/bin/env tsx
/**
 * Dataset schema v3 rollout.
 *
 * The three roles have separate inputs:
 * - student simulator: studentVisible + legitimate prior state + dialogue
 * - tutor: tutorVisible + production prompt/contract path
 * - evaluator: evaluatorOnly + completed rollout
 *
 * Existing files are never modified. A run is resumable by --run-id/--out-dir.
 */
import { createHash } from 'crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { groundAnalysisEvidence } from '../app/lib/analysisGrounding';
import type { ShareGPTRecord } from '../app/lib/dataLab/types';
import { validateShareGPTRecord } from '../app/lib/dataLab/validation';
import { callLLM } from '../app/lib/llm/chat';
import { LLMError } from '../app/lib/llm/errors';
import { createLLMProvider, validateConfig } from '../app/lib/llm/provider';
import type { LLMCompletion, LLMMessage, LLMProvider, LLMRuntimeRole } from '../app/lib/llm/types';
import type { ChatResponse, Message } from '../app/models/types';
import { PhaseEnum } from '../app/models/types';
import { getPromptForPhase, type PromptContext } from '../app/prompts';
import { STAGE_CONTRACT_VERSION, type StageTriggerType } from '../app/lib/stageContract';
import { DEFAULT_STYLE_POLICY_VERSION, evaluateStyleAuthenticity, STYLE_FAMILIES, type StyleFamily } from '../app/lib/stylePolicy';
import type { DatasetV3Phase, DatasetV3Plan, DatasetV3Task } from './dataset-v3-types';
import { maxTurnsForPhase, reachedDatasetV3Stop } from './dataset-v3-rollout-policy';
import './load-script-env';

interface RuntimeIdentity {
  provider: string;
  model: string;
  role: LLMRuntimeRole;
}

interface EvaluationResult {
  accepted: boolean;
  reasons: string[];
  scores: Record<string, number>;
  failedRules: Array<{ ruleCode: string; turn: number | null; evidence: string }>;
}

interface RejectedRollout {
  taskId: string;
  attempt: number;
  error?: string;
  evaluation?: EvaluationResult;
  validationIssues?: unknown[];
  record?: ShareGPTRecord;
  diagnostics?: unknown;
}

interface RolloutProgressContext {
  taskPosition: number;
  taskTotal: number;
  attempt: number;
  maxAttempts: number;
}

function logProgress(message: string): void {
  if (process.argv.includes('--quiet')) return;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${time}] ${message}`);
}

function formatDuration(startedAt: number): string {
  const seconds = (Date.now() - startedAt) / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function responseArtifacts(response: ChatResponse): string {
  const artifacts = [
    response.stage1_confirmed ? 'stage1_confirmed' : '',
    response.experiment_plan ? 'experiment_plan' : '',
    response.data_table_schema ? 'data_table_schema' : '',
    response.safety_quiz ? 'safety_quiz' : '',
    response.analysis_progress ? 'analysis_progress' : '',
    response.report_sections ? 'report_sections' : '',
  ].filter(Boolean);
  return artifacts.length > 0 ? artifacts.join(',') : 'none';
}

function ruleCodes(items: unknown[]): string {
  const codes = items.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const code = (item as { ruleCode?: unknown }).ruleCode;
    return typeof code === 'string' ? [code] : [];
  });
  return codes.length > 0 ? [...new Set(codes)].join(',') : 'none';
}

class RolloutTaskError extends Error {
  diagnostics: unknown;

  constructor(message: string, diagnostics: unknown) {
    super(message);
    this.name = 'RolloutTaskError';
    this.diagnostics = diagnostics;
  }
}

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function intFlag(name: string): number | undefined {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} 必须是非负整数`);
  return value;
}

function phaseFlag(): DatasetV3Phase | undefined {
  const value = intFlag('--phase');
  if (value === undefined) return undefined;
  if (value < 1 || value > 6) throw new Error('--phase 必须为 1-6');
  return value as DatasetV3Phase;
}

function styleFlag(): Set<StyleFamily> | undefined {
  const raw = flag('--styles');
  if (!raw) return undefined;
  const values = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const invalid = values.filter((value) => !STYLE_FAMILIES.includes(value as StyleFamily));
  if (invalid.length) throw new Error(`未知风格：${invalid.join(', ')}`);
  return new Set(values as StyleFamily[]);
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* strict JSON caller reports the failure */ }
  throw new Error('模型没有返回 JSON 对象');
}

async function completeJsonObject(
  provider: LLMProvider,
  messages: LLMMessage[],
  component: 'student' | 'evaluator',
  validate?: (value: Record<string, unknown>) => string | null,
): Promise<Record<string, unknown>> {
  const attempts: Array<Record<string, unknown>> = [];
  let repair = '';
  let useJsonFormat = true;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const requestMessages = messages.map((message, index) => (
      index === messages.length - 1 && message.role === 'user' && repair
        ? { ...message, content: `${message.content}\n\n${repair}` }
        : message
    ));
    let completion: LLMCompletion;
    try {
      completion = await provider.complete(requestMessages, { useJsonFormat });
    } catch (error) {
      logProgress(`${component} 传输尝试 ${attempt}/3 失败：${error instanceof Error ? error.message : String(error)}`);
      if (attempt < 3) {
        repair = '【传输重试】保持思考模式，只在最终 content 中输出一个完整合法的 JSON 对象。';
        continue;
      }
      throw error;
    }
    let failureCode = '';
    let parsed: Record<string, unknown> | null = null;
    if (completion.finishReason === 'length') failureCode = 'OUTPUT_TRUNCATED';
    else if (completion.finishReason === 'content_filter') failureCode = 'CONTENT_FILTERED';
    else if (completion.finishReason === 'insufficient_system_resource') failureCode = 'INSUFFICIENT_SYSTEM_RESOURCE';
    else if (!completion.content.trim()) failureCode = 'EMPTY_CONTENT';
    else {
      try { parsed = parseObject(completion.content); } catch { failureCode = 'INVALID_JSON'; }
    }
    if (parsed) {
      const semanticFailure = validate?.(parsed) ?? null;
      if (!semanticFailure) return parsed;
      failureCode = semanticFailure;
      parsed = null;
    }
    attempts.push({
      attempt,
      failureCode,
      raw: completion.content.slice(0, 20_000),
      finishReason: completion.finishReason,
      reasoningChars: completion.reasoningChars,
      usage: completion.usage,
      request: completion.request,
    });
    logProgress(`${component} JSON 尝试 ${attempt}/3 失败：${failureCode}，finish=${completion.finishReason ?? 'unknown'}，content=${completion.content.length}字符，reasoning=${completion.reasoningChars}字符`);
    if (failureCode === 'EMPTY_CONTENT') useJsonFormat = false;
    repair = [
      '【JSON 重试】',
      `上一次失败类型：${failureCode}。`,
      '保持思考模式，但必须在最终 content 中只返回一个完整合法的 JSON 对象，不要输出 Markdown 或其他前后缀。',
      failureCode === 'STUDENT_FACT_ID_INVALID'
        ? 'confirmedFactId 必须从本轮 availableDecisionFacts 的 id 中选择，不能省略、重复或自造。'
        : '',
    ].join('\n');
  }
  throw new LLMError('parse_error', `${component} 没有返回合法 JSON`, 502, { component, attempts });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

async function withRunLock<T>(outDir: string, work: () => Promise<T>): Promise<T> {
  await mkdir(outDir, { recursive: true });
  const lockFile = path.join(outDir, 'run.lock');
  let handle;
  try {
    handle = await open(lockFile, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stale = await readJson<{ pid?: number }>(lockFile, {});
    let active = false;
    if (Number.isInteger(stale.pid)) {
      try { process.kill(stale.pid!, 0); active = true; } catch { active = false; }
    }
    if (active) throw new Error(`运行目录正由进程 ${stale.pid} 写入：${outDir}`);
    await unlink(lockFile).catch(() => undefined);
    handle = await open(lockFile, 'wx');
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
  try {
    return await work();
  } finally {
    await handle.close();
    await unlink(lockFile).catch(() => undefined);
  }
}

function runtimeFor(role: 'TUTOR' | 'STUDENT' | 'EVALUATOR'): RuntimeIdentity {
  const base = validateConfig();
  if (!base.valid || !base.provider || !base.model) throw new Error(base.issues.join(' '));
  return {
    provider: process.env[`${role}_LLM_PROVIDER`] || process.env.LLM_PROVIDER || base.provider,
    model: process.env[`${role}_LLM_MODEL`] || process.env.LLM_MODEL || base.model,
    role,
  };
}

function tutorContext(task: DatasetV3Task, triggerType: StageTriggerType, allP2FactsConfirmed = false): PromptContext {
  return {
    styleFamily: task.styleFamily,
    stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION,
    triggerType,
    priorSummary: task.tutorVisible.priorSummary,
    dataRows: task.phase === 4 ? task.tutorVisible.dataRows : undefined,
    dataSchema: task.phase === 4 ? task.tutorVisible.dataSchema : undefined,
    needSafetyQuiz: task.phase === 3 && triggerType === 'STAGE_ENTER',
    nudgeConverge: task.phase === 2 && allP2FactsConfirmed,
  };
}

function effectiveTutorVisible(task: DatasetV3Task): DatasetV3Task['tutorVisible'] {
  if ((task.phase === 4 || task.phase === 5) && !task.tutorVisible.dataRows?.length) {
    return { ...task.tutorVisible, dataRows: task.studentVisible.realRows };
  }
  return task.tutorVisible;
}

function contractContext(task: DatasetV3Task, confirmedFactIds: string[], confirmedFacts: string[]): string {
  return JSON.stringify({
    ...effectiveTutorVisible(task),
    confirmedFactIds,
    confirmedFacts,
  });
}

interface SimulatedStudentTurn {
  message: string;
  confirmedFactId?: string;
}

async function simulateStudent(input: {
  task: DatasetV3Task;
  history: Message[];
  tutorResponse: ChatResponse;
  runtime: RuntimeIdentity;
  confirmedFactIds: string[];
}): Promise<SimulatedStudentTurn> {
  const provider = createLLMProvider(input.runtime);
  const visibleTutor = input.tutorResponse.safety_quiz
    ? {
        ...input.tutorResponse,
        safety_quiz: {
          question: input.tutorResponse.safety_quiz.question,
          options: input.tutorResponse.safety_quiz.options,
        },
      }
    : input.tutorResponse;
  const phase4Rule = input.task.phase === 4
    ? '每次回答都必须从 realRows 中逐字引用至少两个不同的具体值，并说明它们来自哪一行或哪一条件；不能使用表外数字。'
    : '';
  const phase2Rule = input.task.phase === 2
    ? '回答方案问题时，必须从 availableDecisionFacts 中选择与本轮问题直接相关的一条，返回它的 id。平台会用该 id 对应的原文作为学生消息；不要同意导师没有问到的额外细节。'
    : '';
  const phase3Rule = input.task.phase === 3
    ? '若导师给出 safety_quiz，只能从可见选项中选择你认为安全的一项；安全确认后，只回答导师关于实际记录或当前操作的一个问题，不分析趋势。'
    : '';
  const phase5Rule = input.task.phase === 5
    ? '报告框架生成后，只选择其中一个字段提出具体核对问题；不能新增框架中没有的事实、数字、材料、步骤、分析或结论。'
    : '';
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: [
        '你只扮演一名初中生。你不能扮演或评价导师。',
        '只能看到 studentVisible、legitimatePriorState、realRows 和已经发生的对话，绝不能猜测 evaluatorOnly。',
        '可以根据主题表达普通学生自己的选择，但不得编造已经做过的步骤、数据或结果。',
        '简短自然地只回答导师本轮问题；若导师给出选择题，选择一个可接受选项。',
        phase4Rule,
        phase2Rule,
        phase3Rule,
        phase5Rule,
        input.task.phase === 2
          ? '只输出 JSON：{"message":"简短自然的学生表达","confirmedFactId":"fact_1"}。'
          : '只输出 JSON：{"message":"学生下一句"}。',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        phase: input.task.phase,
        scenario: input.task.scenario,
        studentVisible: input.task.studentVisible,
        availableDecisionFacts: input.task.studentVisible.decisionFacts
          .map((text, index) => ({ id: `fact_${index + 1}`, text }))
          .filter((fact) => !input.confirmedFactIds.includes(fact.id)),
        legitimatePriorState: input.task.tutorVisible.priorSummary ?? null,
        realRows: input.task.studentVisible.realRows,
        dialogueHistory: input.history.map((message) => ({ role: message.role, content: message.content })),
        tutorReply: visibleTutor,
      }),
    },
  ];
  const availableFactIds = input.task.studentVisible.decisionFacts
    .map((_, index) => `fact_${index + 1}`)
    .filter((id) => !input.confirmedFactIds.includes(id));
  const parsed = await completeJsonObject(provider, messages, 'student', (value) => {
    if (typeof value.message !== 'string' || !value.message.trim()) return 'STUDENT_MESSAGE_MISSING';
    if (input.task.phase !== 2) return null;
    return typeof value.confirmedFactId === 'string' && availableFactIds.includes(value.confirmedFactId.trim())
      ? null
      : 'STUDENT_FACT_ID_INVALID';
  });
  const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
  if (!message) throw new Error('学生模拟器返回空消息');
  if (input.task.phase !== 2) return { message };
  const factId = typeof parsed.confirmedFactId === 'string' ? parsed.confirmedFactId.trim() : '';
  const factIndex = Number(factId.match(/^fact_(\d+)$/)?.[1] ?? 0) - 1;
  const fact = input.task.studentVisible.decisionFacts[factIndex];
  if (!fact || input.confirmedFactIds.includes(factId)) {
    throw new Error(`学生模拟器返回无效或重复的 confirmedFactId：${factId || '空'}`);
  }
  return { message: fact, confirmedFactId: factId };
}

async function evaluate(input: {
  task: DatasetV3Task;
  record: ShareGPTRecord;
  turnSystemPrompts: string[];
  runtime: RuntimeIdentity;
}): Promise<EvaluationResult> {
  const provider = createLLMProvider(input.runtime);
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: [
        '你是独立的 STEM 教学数据评估器，不参与学生或导师生成。',
        '检查阶段纪律、学生主体性、真实数据落地、结构契约、停止条件、风格一致性和隐藏答案泄露。',
        '结构字段以平台生产校验器为准：hints、options 等可选字段缺失不是错误，不能据此拒绝；只评估实际出现的字段是否矛盾。',
        '只有存在会污染训练的实质问题时才返回 accepted=false，并给出可定位到具体轮次和规则的原因。',
        'evaluatorOnly 只供评估，不能因为导师在当前阶段没有提前说出后续答案而扣分。',
        'P4 的证据必须能在 realRows 中逐值核对；P5 只能使用 tutorVisible 的既有方案、数据和分析。',
        '若响应含 artifact_provenance.data_table_schema/report_sections="server_composed"，对应字段是平台根据可见结构化状态附加的确定性成果，不得误判为 Tutor 自行生成；仍需逐字段核验其事实是否与可见状态一致。',
        'P4 若 Tutor 在学生之前首次指出趋势、重复完全相同、异常值或平台期，必须以 P4_TUTOR_DISCOVERED_PATTERN 拒绝；analysis_progress 若含学生原话没有表达的评价或解释，必须拒绝。',
        'P5 核对轮若诱导学生回忆或补填前序状态未记录的规格、数值、材料或步骤，必须以 P5_RETROACTIVE_FACT_FILL 拒绝；诚实保留“未记录”才是合格。',
        '逐轮检查并用规则代码定位问题；failedRules 中每项必须给 ruleCode、turn（从1开始）和原文 evidence。',
        'scores 使用0-2：0=失败，1=证据不足，2=明确通过；accepted=true 时五项必须全为2且 failedRules 为空。禁止无依据地全部打1分。',
        'reasons 必须具体说明通过或失败依据，不能只写“全部通过”“无问题”。',
        '只输出 JSON：{"accepted":boolean,"reasons":["具体依据"],"failedRules":[{"ruleCode":"P4_UNSEEN_NUMBER","turn":2,"evidence":"原文"}],"scores":{"stageDiscipline":2,"grounding":2,"studentAgency":2,"structure":2,"style":2}}。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        phase: input.task.phase,
        styleFamily: input.task.styleFamily,
        scenario: input.task.scenario,
        studentVisible: input.task.studentVisible,
        tutorVisible: effectiveTutorVisible(input.task),
        evaluatorOnly: input.task.evaluatorOnly,
        turnSystemPrompts: input.turnSystemPrompts,
        conversations: input.record.conversations,
      }),
    },
  ];
  const parsed = await completeJsonObject(provider, messages, 'evaluator');
  const scores = parsed.scores && typeof parsed.scores === 'object' && !Array.isArray(parsed.scores)
    ? Object.fromEntries(Object.entries(parsed.scores as Record<string, unknown>).map(([key, value]) => [key, Number(value)]))
    : {};
  const failedRules = Array.isArray(parsed.failedRules)
    ? parsed.failedRules.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const value = item as Record<string, unknown>;
        if (typeof value.ruleCode !== 'string' || typeof value.evidence !== 'string') return [];
        return [{
          ruleCode: value.ruleCode,
          turn: Number.isInteger(value.turn) ? Number(value.turn) : null,
          evidence: value.evidence,
        }];
      })
    : [];
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map(String).filter((item) => item.trim()) : [];
  const scoreKeys = ['stageDiscipline', 'grounding', 'studentAgency', 'structure', 'style'];
  const acceptedByScores = scoreKeys.every((key) => scores[key] === 2);
  return {
    accepted: parsed.accepted === true && acceptedByScores && failedRules.length === 0 && reasons.length > 0,
    reasons: reasons.length > 0 ? reasons : ['EVALUATOR_REASONS_MISSING：评估器没有给出具体依据'],
    scores,
    failedRules,
  };
}

async function rolloutTask(input: {
  task: DatasetV3Task;
  tutorRuntime: RuntimeIdentity;
  studentRuntime: RuntimeIdentity;
  evaluatorRuntime: RuntimeIdentity;
  progress: RolloutProgressContext;
}): Promise<{ record: ShareGPTRecord; evaluation: EvaluationResult; validationIssues: unknown[] }> {
  const { task } = input;
  const scope = `[${input.progress.taskPosition}/${input.progress.taskTotal} ${task.cellKey} 尝试 ${input.progress.attempt}/${input.progress.maxAttempts}]`;
  const conversations: ShareGPTRecord['conversations'] = [];
  const history: Message[] = [];
  const turnSystemPrompts: string[] = [];
  const turnTriggerTypes: StageTriggerType[] = [];
  const neutralSystemResponseTurns: number[] = [];
  const styleEvidenceTurns: number[] = [];
  let nextMessage = task.studentVisible.openingMessage;
  let triggerType: StageTriggerType = task.triggerType;
  let lastResponse: ChatResponse | undefined;
  let acceptedEvidence = 0;
  let hasStage2Schema = false;
  let hasSafetyQuiz = false;
  let hasReportSections = false;
  const confirmedFactIds: string[] = [];
  const confirmedFacts: string[] = [];

  for (let turn = 0; turn < maxTurnsForPhase(task.phase); turn++) {
    const allP2FactsConfirmed = task.phase === 2
      && confirmedFactIds.length === task.studentVisible.decisionFacts.length;
    const systemPrompt = getPromptForPhase(task.phase as PhaseEnum, tutorContext(task, triggerType, allP2FactsConfirmed));
    let response: ChatResponse;
    const tutorStartedAt = Date.now();
    logProgress(`${scope} Tutor 第 ${turn + 1}/${maxTurnsForPhase(task.phase)} 轮请求中，trigger=${triggerType}`);
    try {
      response = await callLLM(
        systemPrompt,
        nextMessage,
        history,
        {
          stage: task.phase,
          triggerType,
          visibleContext: contractContext(task, confirmedFactIds, confirmedFacts),
          hasStage2Schema,
        },
        input.tutorRuntime,
      );
    } catch (error) {
      throw new RolloutTaskError(error instanceof Error ? error.message : String(error), {
        failedTurn: turn + 1,
        triggerType,
        studentMessage: nextMessage,
        partialConversations: conversations,
        llm: error instanceof LLMError ? error.diagnostics : undefined,
      });
    }
    lastResponse = response;
    turnSystemPrompts.push(systemPrompt);
    turnTriggerTypes.push(triggerType);
    conversations.push({ from: 'human', value: nextMessage });
    conversations.push({ from: 'gpt', value: JSON.stringify(response) });
    const styleCheck = evaluateStyleAuthenticity(task.styleFamily, response, { phase: task.phase, triggerType });
    if (styleCheck.neutralSystemResponse) neutralSystemResponseTurns.push(turn + 1);
    else if (styleCheck.issues.length === 0) styleEvidenceTurns.push(turn + 1);
    const styleState = styleCheck.neutralSystemResponse
      ? 'neutral'
      : styleCheck.issues.length === 0
        ? 'evidence'
        : `missing(${styleCheck.issues.join('；')})`;
    logProgress(
      `${scope} Tutor 第 ${turn + 1} 轮完成，用时 ${formatDuration(tutorStartedAt)}，action=${response.next_action_type}，artifacts=${responseArtifacts(response)}，style=${styleState}`,
    );
    history.push({ id: uuidv4(), role: 'user', content: nextMessage, status: 'sent' });
    history.push({ id: uuidv4(), role: 'assistant', content: response.dialogue, actionType: response.next_action_type, status: 'sent' });
    if (response.data_table_schema) hasStage2Schema = true;
    if (response.safety_quiz) hasSafetyQuiz = true;
    if (response.report_sections) hasReportSections = true;
    if (task.phase === 4 && response.analysis_progress) {
      const grounding = groundAnalysisEvidence(response.analysis_progress, nextMessage, task.tutorVisible.dataRows ?? []);
      if (grounding.accepted) acceptedEvidence++;
    }
    if (reachedDatasetV3Stop(task.phase, response, {
      turns: turn + 1,
      acceptedEvidence,
      hasSafetyQuiz,
      hasReportSections,
    })) {
      logProgress(`${scope} 已满足 P${task.phase} 停止条件，共 ${turn + 1} 个 Tutor 轮次`);
      break;
    }
    if (allP2FactsConfirmed) {
      nextMessage = '以上内容都按我刚才的选择确定了，请只根据这些内容整理成完整方案让我核对，不要再增加或追问额外参数。';
      logProgress(`${scope} P2 事实已全部确认，发送确定性收敛请求`);
      triggerType = 'USER_MESSAGE';
      continue;
    }
    const studentStartedAt = Date.now();
    logProgress(`${scope} 学生模拟器第 ${turn + 1} 次响应中`);
    try {
      const studentTurn = await simulateStudent({
        task,
        history,
        tutorResponse: response,
        runtime: input.studentRuntime,
        confirmedFactIds,
      });
      nextMessage = studentTurn.message;
      if (studentTurn.confirmedFactId) {
        confirmedFactIds.push(studentTurn.confirmedFactId);
        confirmedFacts.push(studentTurn.message);
      }
    } catch (error) {
      throw new RolloutTaskError(error instanceof Error ? error.message : String(error), {
        failedTurn: turn + 1,
        component: 'student_simulator',
        triggerType,
        partialConversations: conversations,
      });
    }
    logProgress(`${scope} 学生模拟器第 ${turn + 1} 次完成，用时 ${formatDuration(studentStartedAt)}，返回 ${nextMessage.length} 字符`);
    triggerType = 'USER_MESSAGE';
  }

  if (!lastResponse || !reachedDatasetV3Stop(task.phase, lastResponse, {
    turns: turnSystemPrompts.length,
    acceptedEvidence,
    hasSafetyQuiz,
    hasReportSections,
  })) {
    throw new Error(`未在动态上限内达到阶段 P${task.phase} 的停止条件`);
  }

  const idHash = createHash('sha256').update(`${task.id}:${JSON.stringify(conversations)}`).digest('hex').slice(0, 12);
  const evaluatorIndependent = `${input.evaluatorRuntime.provider}:${input.evaluatorRuntime.model}` !== `${input.tutorRuntime.provider}:${input.tutorRuntime.model}`;
  const record: ShareGPTRecord = {
    id: `stem-dataset-v3-${task.id}-${idHash}`,
    source: 'dataset_v3_role_separated_rollout',
    scenario: task.scenario,
    phase: task.phase,
    rubricTargets: task.evaluatorOnly.rubricTargets,
    evidence: [
      `v3-plan-task:${task.id}`,
      `legacy-scenario-seed:${task.parentLegacyRecordId}`,
      'student-simulator+production-tutor+evaluator',
    ],
    conversations,
    meta: {
      tier: evaluatorIndependent ? 'gold_candidate' : 'needs_review',
      sourceKind: 'stage_contract_rollout',
      distillTaskId: task.id,
      parentLegacyRecordId: task.parentLegacyRecordId,
      familyKey: task.familyKey,
      styleFamily: task.styleFamily,
      stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION,
      stageContractVersion: STAGE_CONTRACT_VERSION,
      systemPrompt: turnSystemPrompts[0],
      stageTriggerType: turnTriggerTypes[0],
      visibleContext: JSON.stringify({
        tutorVisible: effectiveTutorVisible(task),
        studentMessages: conversations.filter((message) => message.from === 'human').map((message) => message.value),
        confirmedFactIds,
        confirmedFacts,
      }),
      generationContext: {
        schemaVersion: 3,
        mechanism: 'role-separated-dynamic-rollout',
        cellKey: task.cellKey,
        reportPath: task.reportPath,
        turnSystemPrompts,
        turnTriggerTypes,
        neutralSystemResponseTurns,
        styleEvidenceTurns,
        dynamicStop: true,
        acceptedGroundedEvidenceRounds: acceptedEvidence,
        confirmedFactIds,
        confirmedFacts,
        tutorRuntime: input.tutorRuntime,
        studentRuntime: input.studentRuntime,
        evaluatorRuntime: input.evaluatorRuntime,
        evaluatorIndependent,
      },
    },
  };
  const hardCheck = validateShareGPTRecord(record, 'submit');
  const hardErrors = hardCheck.issues.filter((item) => item.severity === 'error');
  const warnings = hardCheck.issues.filter((item) => item.severity === 'warning');
  logProgress(`${scope} 确定性门禁完成：hard=${hardErrors.length}，warning=${warnings.length}，rules=${ruleCodes(hardCheck.issues)}`);
  const evaluatorStartedAt = Date.now();
  logProgress(`${scope} Evaluator 评估中`);
  let evaluation: EvaluationResult;
  try {
    evaluation = await evaluate({ task, record, turnSystemPrompts, runtime: input.evaluatorRuntime });
  } catch (error) {
    throw new RolloutTaskError(error instanceof Error ? error.message : String(error), {
      component: 'evaluator',
      partialConversations: conversations,
    });
  }
  logProgress(
    `${scope} Evaluator 完成，用时 ${formatDuration(evaluatorStartedAt)}，accepted=${evaluation.accepted}，failedRules=${ruleCodes(evaluation.failedRules)}`,
  );
  record.qualityNotes = evaluation.reasons.join('；');
  record.meta = {
    ...record.meta,
    generationContext: {
      ...(record.meta?.generationContext ?? {}),
      evaluatorAccepted: evaluation.accepted,
      evaluatorReasons: evaluation.reasons,
      evaluatorFailedRules: evaluation.failedRules,
      evaluatorScores: evaluation.scores,
    },
  };
  return { record, evaluation, validationIssues: hardCheck.issues };
}

function summarize(records: ShareGPTRecord[]) {
  return {
    byPhase: Object.fromEntries([1, 2, 3, 4, 5, 6].map((phase) => [`P${phase}`, records.filter((record) => record.phase === phase).length])),
    byStyle: Object.fromEntries(STYLE_FAMILIES.map((style) => [style, records.filter((record) => record.meta?.styleFamily === style).length])),
    byTier: records.reduce<Record<string, number>>((acc, record) => {
      const tier = String(record.meta?.tier ?? 'unknown');
      acc[tier] = (acc[tier] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

async function main() {
  const planFile = path.resolve(flag('--plan', 'data/sft/v3/plans/plan-v3.json')!);
  const runId = flag('--run-id', new Date().toISOString().replace(/[:.]/g, '-'))!;
  const outDir = path.resolve(flag('--out-dir', `data/sft/v3/runs/${runId}`)!);
  const acceptedFile = path.join(outDir, 'candidates.json');
  const rejectedFile = path.join(outDir, 'rejected.json');
  const manifestFile = path.join(outDir, 'manifest.json');
  const limit = intFlag('--limit');
  const offset = intFlag('--offset') ?? 0;
  const onlyPhase = phaseFlag();
  const onlyStyles = styleFlag();
  const resume = flag('--resume', 'true') !== 'false';
  const dryRun = hasFlag('--dry-run');
  const maxAttempts = intFlag('--max-attempts') ?? 3;
  if (maxAttempts < 1) throw new Error('--max-attempts 必须至少为1');
  const plan = JSON.parse(await readFile(planFile, 'utf8')) as DatasetV3Plan;
  if (plan.schemaVersion !== 3) throw new Error('计划文件不是 dataset schema v3');
  if (plan.stageContractVersion !== STAGE_CONTRACT_VERSION) throw new Error(`计划合同版本不是当前 ${STAGE_CONTRACT_VERSION}`);
  let tasks = plan.tasks;
  if (onlyPhase) tasks = tasks.filter((task) => task.phase === onlyPhase);
  if (onlyStyles) tasks = tasks.filter((task) => onlyStyles.has(task.styleFamily));
  tasks = tasks.slice(offset, limit === undefined ? undefined : offset + limit);

  if (dryRun) {
    console.log(JSON.stringify({ planFile, runId, outDir, selected: tasks.length, ...summarize(tasks.map((task) => ({ phase: task.phase, meta: { styleFamily: task.styleFamily } } as ShareGPTRecord))) }, null, 2));
    return;
  }

  await withRunLock(outDir, async () => {
    const tutorRuntime = runtimeFor('TUTOR');
    const studentRuntime = runtimeFor('STUDENT');
    const evaluatorRuntime = runtimeFor('EVALUATOR');
    const acceptedRaw = resume ? await readJson<ShareGPTRecord[]>(acceptedFile, []) : [];
    const rejectedRaw = resume ? await readJson<RejectedRollout[]>(rejectedFile, []) : [];
    const accepted = [...new Map(acceptedRaw.map((record) => [String(record.meta?.distillTaskId ?? record.id), record])).values()];
    const acceptedIds = new Set(accepted.map((record) => String(record.meta?.distillTaskId ?? '')));
    const rejected = rejectedRaw
      .filter((item) => !acceptedIds.has(item.taskId))
      .map((item, index) => ({ ...item, attempt: Number.isInteger(item.attempt) ? item.attempt : index + 1 }));
    const evaluatorIndependent = `${evaluatorRuntime.provider}:${evaluatorRuntime.model}` !== `${tutorRuntime.provider}:${tutorRuntime.model}`;
    logProgress(`启动蒸馏 run=${runId}，格子=${tasks.length}，resume=${resume}，每格最多尝试=${maxAttempts}`);
    logProgress(`输出目录：${outDir}`);
    logProgress(`Tutor=${tutorRuntime.provider}/${tutorRuntime.model}；Student=${studentRuntime.provider}/${studentRuntime.model}；Evaluator=${evaluatorRuntime.provider}/${evaluatorRuntime.model}；独立评估=${evaluatorIndependent}`);
    logProgress(`恢复状态：已有候选=${accepted.length}，已有拒绝尝试=${rejected.length}`);

    const persist = async () => {
      const failedCells = tasks.filter((task) => {
        if (accepted.some((record) => record.meta?.distillTaskId === task.id)) return false;
        return rejected.filter((item) => item.taskId === task.id).length >= maxAttempts;
      });
      const manifest = {
        schemaVersion: 3,
        runId,
        planFile: path.relative(process.cwd(), planFile),
        stageContractVersion: STAGE_CONTRACT_VERSION,
        updatedAt: new Date().toISOString(),
        selectedTaskCount: tasks.length,
        completedTaskCount: accepted.filter((record) => tasks.some((task) => task.id === record.meta?.distillTaskId)).length + failedCells.length,
        candidateCount: accepted.length,
        rejectedAttemptCount: rejected.length,
        failedCellCount: failedCells.length,
        failedCells: failedCells.map((task) => task.cellKey),
        maxAttemptsPerCell: maxAttempts,
        runtimes: { tutor: tutorRuntime, student: studentRuntime, evaluator: evaluatorRuntime },
        evaluatorIndependent,
        automaticHumanGoldCount: 0,
        humanDoubleReviewRequired: !evaluatorIndependent,
        humanReviewRequiredCount: accepted.length,
        ...summarize(accepted),
      };
      await Promise.all([
        writeJsonAtomic(acceptedFile, accepted),
        writeJsonAtomic(rejectedFile, rejected),
        writeJsonAtomic(manifestFile, manifest),
      ]);
    };

    for (const [taskIndex, task] of tasks.entries()) {
      if (acceptedIds.has(task.id)) {
        logProgress(`[${taskIndex + 1}/${tasks.length} ${task.cellKey}] 跳过：候选已存在`);
        continue;
      }
      let attempt = rejected.filter((item) => item.taskId === task.id).length;
      if (attempt >= maxAttempts) {
        logProgress(`[${taskIndex + 1}/${tasks.length} ${task.cellKey}] 跳过：已耗尽 ${maxAttempts} 次尝试`);
      }
      while (attempt < maxAttempts && !acceptedIds.has(task.id)) {
        attempt++;
        const attemptStartedAt = Date.now();
        logProgress(`[${taskIndex + 1}/${tasks.length} ${task.cellKey}] 开始尝试 ${attempt}/${maxAttempts}，scenario=${task.scenario}`);
        try {
          const result = await rolloutTask({
            task,
            tutorRuntime,
            studentRuntime,
            evaluatorRuntime,
            progress: { taskPosition: taskIndex + 1, taskTotal: tasks.length, attempt, maxAttempts },
          });
          const hardErrors = result.validationIssues.filter((item) => (item as { severity?: string }).severity === 'error');
          if (hardErrors.length || !result.evaluation.accepted) {
            rejected.push({
              taskId: task.id,
              attempt,
              evaluation: result.evaluation,
              validationIssues: result.validationIssues,
              record: result.record,
            });
            logProgress(
              `[${taskIndex + 1}/${tasks.length} ${task.cellKey}] 尝试 ${attempt}/${maxAttempts} 被拒绝，用时 ${formatDuration(attemptStartedAt)}，hardRules=${ruleCodes(hardErrors)}，evaluatorRules=${ruleCodes(result.evaluation.failedRules)}`,
            );
          } else {
            accepted.push(result.record);
            acceptedIds.add(task.id);
            logProgress(`[${taskIndex + 1}/${tasks.length} ${task.cellKey}] 候选入选，用时 ${formatDuration(attemptStartedAt)}，tier=${String(result.record.meta?.tier)}`);
          }
        } catch (error) {
          rejected.push({
            taskId: task.id,
            attempt,
            error: error instanceof Error ? error.message : String(error),
            diagnostics: error instanceof RolloutTaskError
              ? error.diagnostics
              : error instanceof LLMError
                ? error.diagnostics
                : undefined,
          });
          const diagnostics = error instanceof RolloutTaskError && error.diagnostics && typeof error.diagnostics === 'object'
            ? error.diagnostics as { component?: unknown; failedTurn?: unknown }
            : {};
          console.error(
            `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] [${taskIndex + 1}/${tasks.length} ${task.cellKey}] 尝试 ${attempt}/${maxAttempts} 失败，用时 ${formatDuration(attemptStartedAt)}，component=${String(diagnostics.component ?? 'tutor')}，turn=${String(diagnostics.failedTurn ?? 'unknown')}：${error instanceof Error ? error.message : String(error)}`,
          );
        }
        await persist();
        const completedCells = tasks.filter((selectedTask) => (
          acceptedIds.has(selectedTask.id)
          || rejected.filter((item) => item.taskId === selectedTask.id).length >= maxAttempts
        )).length;
        logProgress(`总进度 ${completedCells}/${tasks.length}；候选=${accepted.length}；拒绝尝试=${rejected.length}`);
      }
    }
    await persist();
    logProgress(`运行结束 run=${runId}；候选=${accepted.length}；拒绝尝试=${rejected.length}`);
    console.log(JSON.stringify({ runId, selected: tasks.length, candidates: accepted.length, rejected: rejected.length, outDir }, null, 2));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
