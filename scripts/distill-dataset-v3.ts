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
import { createLLMProvider, validateConfig } from '../app/lib/llm/provider';
import type { LLMMessage } from '../app/lib/llm/types';
import type { ChatResponse, Message } from '../app/models/types';
import { PhaseEnum } from '../app/models/types';
import { getPromptForPhase, type PromptContext } from '../app/prompts';
import { STAGE_CONTRACT_VERSION, type StageTriggerType } from '../app/lib/stageContract';
import { DEFAULT_STYLE_POLICY_VERSION, STYLE_FAMILIES, type StyleFamily } from '../app/lib/stylePolicy';
import type { DatasetV3Phase, DatasetV3Plan, DatasetV3Task } from './dataset-v3-types';
import './load-script-env';

interface RuntimeIdentity {
  provider: string;
  model: string;
}

interface EvaluationResult {
  accepted: boolean;
  reasons: string[];
  scores: Record<string, number>;
}

interface RejectedRollout {
  taskId: string;
  error?: string;
  evaluation?: EvaluationResult;
  validationIssues?: unknown[];
  record?: ShareGPTRecord;
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
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    }
  }
  throw new Error('模型没有返回 JSON 对象');
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
  };
}

function tutorContext(task: DatasetV3Task, triggerType: StageTriggerType): PromptContext {
  return {
    styleFamily: task.styleFamily,
    stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION,
    triggerType,
    priorSummary: task.tutorVisible.priorSummary,
    dataRows: task.phase === 4 ? task.tutorVisible.dataRows : undefined,
    dataSchema: task.phase === 4 ? task.tutorVisible.dataSchema : undefined,
    needSafetyQuiz: task.phase === 3 && triggerType === 'STAGE_ENTER',
  };
}

function contractContext(task: DatasetV3Task): string {
  return JSON.stringify({
    priorSummary: task.tutorVisible.priorSummary ?? null,
    dataRows: task.tutorVisible.dataRows ?? [],
    dataSchema: task.tutorVisible.dataSchema ?? null,
  });
}

function maxTurns(phase: DatasetV3Phase): number {
  if (phase === 1) return 6;
  if (phase === 2) return 8;
  if (phase === 4) return 6;
  if (phase === 6) return 2;
  return 2;
}

function reachedStop(phase: DatasetV3Phase, response: ChatResponse, turns: number, acceptedEvidence: number): boolean {
  if (phase === 1) return response.stage1_confirmed === true;
  if (phase === 2) return !!response.experiment_plan && !!response.data_table_schema;
  if (phase === 3) return !!response.safety_quiz;
  if (phase === 4) return turns >= 3 && acceptedEvidence >= 2;
  if (phase === 5) return !!response.report_sections;
  return turns >= 1;
}

async function simulateStudent(input: {
  task: DatasetV3Task;
  history: Message[];
  tutorResponse: ChatResponse;
  runtime: RuntimeIdentity;
}): Promise<string> {
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
    ? '回答组别、数量、温度、时间、重复次数等方案数字时使用阿拉伯数字，并只确认你本轮真正选择的数字；不要同意导师没有问到的额外细节。'
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
        '只输出 JSON：{"message":"学生下一句"}。',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        phase: input.task.phase,
        scenario: input.task.scenario,
        studentVisible: input.task.studentVisible,
        legitimatePriorState: input.task.tutorVisible.priorSummary ?? null,
        realRows: input.task.studentVisible.realRows,
        dialogueHistory: input.history.map((message) => ({ role: message.role, content: message.content })),
        tutorReply: visibleTutor,
      }),
    },
  ];
  const parsed = parseObject(await provider.chat(messages, { useJsonFormat: true }));
  const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
  if (!message) throw new Error('学生模拟器返回空消息');
  return message;
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
        '只输出 JSON：{"accepted":boolean,"reasons":["..."],"scores":{"stageDiscipline":1,"grounding":1,"studentAgency":1,"structure":1,"style":1}}。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        phase: input.task.phase,
        styleFamily: input.task.styleFamily,
        scenario: input.task.scenario,
        studentVisible: input.task.studentVisible,
        tutorVisible: input.task.tutorVisible,
        evaluatorOnly: input.task.evaluatorOnly,
        turnSystemPrompts: input.turnSystemPrompts,
        conversations: input.record.conversations,
      }),
    },
  ];
  const parsed = parseObject(await provider.chat(messages, { useJsonFormat: true }));
  const scores = parsed.scores && typeof parsed.scores === 'object' && !Array.isArray(parsed.scores)
    ? Object.fromEntries(Object.entries(parsed.scores as Record<string, unknown>).map(([key, value]) => [key, Number(value)]))
    : {};
  return {
    accepted: parsed.accepted === true,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : ['评估器没有给出 reasons'],
    scores,
  };
}

async function rolloutTask(input: {
  task: DatasetV3Task;
  tutorRuntime: RuntimeIdentity;
  studentRuntime: RuntimeIdentity;
  evaluatorRuntime: RuntimeIdentity;
}): Promise<{ record: ShareGPTRecord; evaluation: EvaluationResult; validationIssues: unknown[] }> {
  const { task } = input;
  const conversations: ShareGPTRecord['conversations'] = [];
  const history: Message[] = [];
  const turnSystemPrompts: string[] = [];
  const turnTriggerTypes: StageTriggerType[] = [];
  let nextMessage = task.studentVisible.openingMessage;
  let triggerType: StageTriggerType = task.triggerType;
  let lastResponse: ChatResponse | undefined;
  let acceptedEvidence = 0;
  let hasStage2Schema = false;

  for (let turn = 0; turn < maxTurns(task.phase); turn++) {
    const systemPrompt = getPromptForPhase(task.phase as PhaseEnum, tutorContext(task, triggerType));
    const response = await callLLM(
      systemPrompt,
      nextMessage,
      history,
      {
        stage: task.phase,
        triggerType,
        visibleContext: contractContext(task),
        hasStage2Schema,
      },
      input.tutorRuntime,
    );
    lastResponse = response;
    turnSystemPrompts.push(systemPrompt);
    turnTriggerTypes.push(triggerType);
    conversations.push({ from: 'human', value: nextMessage });
    conversations.push({ from: 'gpt', value: JSON.stringify(response) });
    history.push({ id: uuidv4(), role: 'user', content: nextMessage, status: 'sent' });
    history.push({ id: uuidv4(), role: 'assistant', content: response.dialogue, actionType: response.next_action_type, status: 'sent' });
    if (response.data_table_schema) hasStage2Schema = true;
    if (task.phase === 4 && response.analysis_progress) {
      const grounding = groundAnalysisEvidence(response.analysis_progress, nextMessage, task.tutorVisible.dataRows ?? []);
      if (grounding.accepted) acceptedEvidence++;
    }
    if (reachedStop(task.phase, response, turn + 1, acceptedEvidence)) break;
    nextMessage = await simulateStudent({ task, history, tutorResponse: response, runtime: input.studentRuntime });
    triggerType = 'USER_MESSAGE';
  }

  if (!lastResponse || !reachedStop(task.phase, lastResponse, turnSystemPrompts.length, acceptedEvidence)) {
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
        tutorVisible: task.tutorVisible,
        studentMessages: conversations.filter((message) => message.from === 'human').map((message) => message.value),
      }),
      generationContext: {
        schemaVersion: 3,
        mechanism: 'role-separated-dynamic-rollout',
        turnSystemPrompts,
        turnTriggerTypes,
        dynamicStop: true,
        acceptedGroundedEvidenceRounds: acceptedEvidence,
        tutorRuntime: input.tutorRuntime,
        studentRuntime: input.studentRuntime,
        evaluatorRuntime: input.evaluatorRuntime,
        evaluatorIndependent,
      },
    },
  };
  const hardCheck = validateShareGPTRecord(record, 'submit');
  const evaluation = await evaluate({ task, record, turnSystemPrompts, runtime: input.evaluatorRuntime });
  record.qualityNotes = evaluation.reasons.join('；');
  record.meta = {
    ...record.meta,
    generationContext: {
      ...(record.meta?.generationContext ?? {}),
      evaluatorAccepted: evaluation.accepted,
      evaluatorReasons: evaluation.reasons,
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
    const rejected = [...new Map(rejectedRaw
      .filter((item) => !acceptedIds.has(item.taskId))
      .map((item) => [item.taskId, item])).values()];
    const completed = new Set([
      ...acceptedIds,
      ...rejected.map((item) => item.taskId),
    ]);

    for (const task of tasks) {
    if (completed.has(task.id)) {
      console.log(`skip ${task.id}`);
      continue;
    }
    try {
      const result = await rolloutTask({ task, tutorRuntime, studentRuntime, evaluatorRuntime });
      const hardErrors = result.validationIssues.filter((issue) => (issue as { severity?: string }).severity === 'error');
      if (hardErrors.length || !result.evaluation.accepted) {
        rejected.push({
          taskId: task.id,
          evaluation: result.evaluation,
          validationIssues: result.validationIssues,
          record: result.record,
        });
        console.log(`rejected ${task.id}`);
      } else {
        accepted.push(result.record);
        console.log(`candidate ${task.id} (${String(result.record.meta?.tier)})`);
      }
    } catch (error) {
      rejected.push({ taskId: task.id, error: error instanceof Error ? error.message : String(error) });
      console.error(`failed ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const manifest = {
      schemaVersion: 3,
      runId,
      planFile: path.relative(process.cwd(), planFile),
      stageContractVersion: STAGE_CONTRACT_VERSION,
      updatedAt: new Date().toISOString(),
      selectedTaskCount: tasks.length,
      completedTaskCount: accepted.length + rejected.length,
      candidateCount: accepted.length,
      rejectedCount: rejected.length,
      runtimes: { tutor: tutorRuntime, student: studentRuntime, evaluator: evaluatorRuntime },
      evaluatorIndependent: `${evaluatorRuntime.provider}:${evaluatorRuntime.model}` !== `${tutorRuntime.provider}:${tutorRuntime.model}`,
      ...summarize(accepted),
    };
    await Promise.all([
      writeJsonAtomic(acceptedFile, accepted),
      writeJsonAtomic(rejectedFile, rejected),
      writeJsonAtomic(manifestFile, manifest),
    ]);
    }
    console.log(JSON.stringify({ runId, selected: tasks.length, candidates: accepted.length, rejected: rejected.length, outDir }, null, 2));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
