#!/usr/bin/env tsx
/**
 * stage-contract-v2 turn-by-turn distillation.
 *
 * Roles are isolated:
 * 1. Student Simulator sees only the student brief, legitimate prior state and tutor reply.
 * 2. Production Tutor is the real getPromptForPhase + callLLM runtime path.
 * 3. Independent Evaluator alone sees expectedTransformation.
 *
 * Existing datasets are never modified. This script writes new v2 accepted/rejected files.
 *
 * Example:
 *   npx tsx scripts/distill-stage-contract-rollout.ts \
 *     --plan data/sft/distill-plan-dsv4.json \
 *     --out data/sft/sharegpt-stage-contract-v2.json \
 *     --rejected-out data/sft/sharegpt-stage-contract-v2-rejected.json \
 *     --limit 20
 */

import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { callLLM } from '@/app/lib/llm/chat';
import { createLLMProvider } from '@/app/lib/llm/provider';
import type { LLMMessage } from '@/app/lib/llm/types';
import { getPromptForPhase, type PromptContext } from '@/app/prompts';
import { PhaseEnum, type ChatResponse, type Message } from '@/app/models/types';
import type { Stage2Data } from '@/app/models/stageData';
import { DEFAULT_STYLE_FAMILY, DEFAULT_STYLE_POLICY_VERSION } from '@/app/lib/stylePolicy';
import { STAGE_CONTRACT_VERSION, type StageTriggerType } from '@/app/lib/stageContract';
import type { ShareGPTRecord } from '@/app/lib/dataLab/types';

const PHASES = [1, 2, 3, 4, 5, 6] as const;
type Phase = typeof PHASES[number];

interface ExpectedTransformation {
  originalInterest?: string;
  retainedFeature?: string;
  classroomProxy?: string;
  researchQuestion?: string;
  independentVariable?: string;
  dependentDirection?: string;
  safetyNotes?: string[];
}

interface PlanTask {
  id: string;
  phase: Phase;
  scenario: string;
  rubricTargets?: string[];
  studentProfile?: string;
  focus?: string[];
  priorSummary?: string;
  persona?: {
    id?: string;
    name?: string;
    phase1?: string[];
    phase2?: string[];
    expectedTransformation?: ExpectedTransformation;
  };
  topic?: {
    id?: string;
    title?: string;
    questionStem?: string;
    independentVariable?: string;
    dependentVariable?: string;
    engineeringTranslation?: string;
    safetyNote?: string;
  };
}

interface PlanFile {
  tasks: PlanTask[];
}

interface EvaluationResult {
  accepted: boolean;
  reasons: string[];
  scores?: Record<string, number>;
}

interface RolloutResult {
  record: ShareGPTRecord;
  evaluation: EvaluationResult;
}

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function intFlag(name: string): number | undefined {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} 必须是非负整数`);
  return parsed;
}

function phaseFlag(): Phase | undefined {
  const parsed = intFlag('--phase');
  if (parsed === undefined) return undefined;
  if (!PHASES.includes(parsed as Phase)) throw new Error('--phase 必须为 1-6');
  return parsed as Phase;
}

function parseJsonObject(raw: string): Record<string, unknown> {
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

function extractRows(priorSummary?: string): Record<string, unknown>[] {
  if (!priorSummary) return [];
  const section = priorSummary.split('【实验数据】')[1]?.split(/\n\n【/)[0] ?? '';
  const rows: Record<string, unknown>[] = [];
  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rows.push(parsed as Record<string, unknown>);
    } catch {
      // Ignore non-row text; evaluator will reject ungrounded rollouts.
    }
  }
  return rows;
}

function inferSchema(rows: Record<string, unknown>[]): Stage2Data['schema'] | undefined {
  if (rows.length === 0) return undefined;
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    columns: keys.map((key) => ({
      key,
      title: key,
      type: rows.every((row) => row[key] === undefined || row[key] === null || typeof row[key] === 'number')
        ? 'number' as const
        : 'text' as const,
      required: key !== 'notes',
    })),
    minRows: Math.max(3, Math.min(rows.length, 5)),
    maxRows: 200,
  };
}

/** Build legitimate tutor-visible context without reading expectedTransformation. */
function safeTaskContext(task: PlanTask, rows: Record<string, unknown>[]): string {
  const studentLines = task.phase === 1
    ? task.persona?.phase1 ?? []
    : [...(task.persona?.phase1 ?? []), ...(task.persona?.phase2 ?? [])];
  const topicLines = task.topic
    ? [
        task.topic.title ? `主题：${task.topic.title}` : '',
        task.topic.questionStem ? `已确认研究问题：${task.topic.questionStem}` : '',
        task.phase >= 2 && task.topic.independentVariable ? `拟改变因素方向：${task.topic.independentVariable}` : '',
        task.phase >= 2 && task.topic.dependentVariable ? `关注现象方向：${task.topic.dependentVariable}` : '',
        task.topic.engineeringTranslation ? `课堂代理：${task.topic.engineeringTranslation}` : '',
        task.topic.safetyNote ? `已知安全边界：${task.topic.safetyNote}` : '',
      ].filter(Boolean)
    : [];
  const context = [
    '【学生与前序阶段已明确的信息】',
    ...studentLines.map((line) => `学生陈述：${line}`),
    ...topicLines,
    rows.length ? `【真实数据】\n${rows.map((row) => JSON.stringify(row)).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return context || '（没有额外前序信息；导师必须通过学生回答逐步澄清，不得补写。）';
}

function firstInput(task: PlanTask): { message: string; triggerType: StageTriggerType } {
  if (task.phase === 2) {
    return { message: '系统触发：学生已确认选题。请发送阶段2方案设计的开场，只推进第一个方案缺口。', triggerType: 'STAGE_TRANSITION' };
  }
  if (task.phase === 3) {
    return { message: '系统触发：学生首次进入过程执行阶段，请先进行与当前方案相关的安全问答。', triggerType: 'STAGE_ENTER' };
  }
  if (task.phase === 4) {
    return { message: '系统触发：学生已完成数据收集。请读取已提交的数据表，并发送阶段4的数据分析开场。', triggerType: 'STAGE_TRANSITION' };
  }
  if (task.phase === 5) {
    return { message: '系统触发：学生已完成数据分析，请基于前序结构化状态生成报告框架。', triggerType: 'REPORT_BOOTSTRAP' };
  }
  if (task.phase === 6) {
    return { message: '我想检查一下自己的反思还缺少什么。', triggerType: 'OPTIONAL_COACHING' };
  }
  const source = task.phase === 1 ? task.persona?.phase1 : task.persona?.phase2;
  return {
    message: source?.[0] ?? task.topic?.title ?? (task.phase === 1 ? '我有一个想研究的主题。' : '我准备开始设计实验方案。'),
    triggerType: 'USER_MESSAGE',
  };
}

function promptContext(
  task: PlanTask,
  safeContext: string,
  rows: Record<string, unknown>[],
  schema: Stage2Data['schema'] | undefined,
  triggerType: StageTriggerType,
): PromptContext {
  const context: PromptContext = {
    styleFamily: DEFAULT_STYLE_FAMILY,
    stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION,
    triggerType,
  };
  if (task.phase === 2 || task.phase === 3 || task.phase === 5 || task.phase === 6) {
    context.priorSummary = safeContext;
  }
  if (task.phase === 3 && triggerType === 'STAGE_ENTER') context.needSafetyQuiz = true;
  if (task.phase === 4) {
    context.dataRows = rows;
    context.dataSchema = schema;
  }
  return context;
}

function visibleContext(task: PlanTask, safeContext: string, rows: Record<string, unknown>[], schema?: Stage2Data['schema']): string | undefined {
  if (task.phase === 4) return JSON.stringify({ schema, rows, rowNumbers: rows.map((_, index) => index + 1) });
  if ([2, 3, 5, 6].includes(task.phase)) return safeContext;
  return undefined;
}

function reachedStop(phase: Phase, response: ChatResponse, tutorTurns: number, acceptedEvidence: number): boolean {
  if (phase === 1) return response.stage1_confirmed === true;
  if (phase === 2) return !!response.experiment_plan && !!response.data_table_schema;
  if (phase === 3) return !!response.safety_quiz;
  if (phase === 4) return tutorTurns >= 3 && acceptedEvidence >= 2;
  if (phase === 5) return !!response.report_sections;
  return tutorTurns >= 1;
}

function maxTutorTurns(phase: Phase): number {
  if (phase === 1) return 6;
  if (phase === 2) return 7;
  if (phase === 4) return 5;
  if (phase === 6) return 2;
  return 2;
}

async function simulateStudent(input: {
  task: PlanTask;
  safeContext: string;
  rows: Record<string, unknown>[];
  history: Message[];
  tutorResponse: ChatResponse;
}): Promise<string> {
  const provider = createLLMProvider();
  const visibleTutor = input.tutorResponse.safety_quiz
    ? {
        ...input.tutorResponse,
        safety_quiz: {
          question: input.tutorResponse.safety_quiz.question,
          options: input.tutorResponse.safety_quiz.options,
        },
      }
    : input.tutorResponse;
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: [
        '你只扮演一名初中生，不扮演导师，也不评价导师。',
        '只能依据给定学生背景、前序状态、真实数据和已经发生的对话作答。',
        '不得看到或猜测任何 expectedTransformation，不得编造新数据、材料、步骤或实验结果。',
        '回答自然、简短，可以不完美，但必须回应导师本轮唯一问题。',
        '只输出 {"message":"学生下一句"}。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        phase: input.task.phase,
        studentProfile: input.task.studentProfile ?? '普通初中生',
        studentBrief: input.task.phase === 1 ? input.task.persona?.phase1 ?? [input.task.topic?.title ?? ''] : input.task.persona?.phase2 ?? [],
        visibleContext: input.safeContext,
        realRows: input.rows,
        dialogueHistory: input.history.map((message) => ({ role: message.role, content: message.content })),
        tutorReply: visibleTutor,
      }),
    },
  ];
  const raw = await provider.chat(messages, { useJsonFormat: true });
  const parsed = parseJsonObject(raw);
  const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
  if (!message) throw new Error('学生模拟器返回空消息');
  return message;
}

async function evaluateRollout(input: {
  task: PlanTask;
  conversations: ShareGPTRecord['conversations'];
  turnSystemPrompts: string[];
  safeContext: string;
}): Promise<EvaluationResult> {
  const provider = createLLMProvider();
  // expectedTransformation is intentionally read only inside this evaluator boundary.
  const expectedTransformation = input.task.persona?.expectedTransformation ?? input.task.topic ?? null;
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: [
        '你是独立的 STEM 教学数据质量评估器，不参与学生或导师生成。',
        '检查阶段白名单/黑名单、学生主体性、上下文落地、结构字段、停止条件和是否泄漏后续阶段答案。',
        'expectedTransformation 只用于判断主题保真与最终结构，不得要求导师在不该知道的阶段提前说出它。',
        '只输出 JSON：{"accepted":boolean,"reasons":["..."],"scores":{"stageDiscipline":1-5,"grounding":1-5,"studentAgency":1-5,"structure":1-5}}。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        phase: input.task.phase,
        scenario: input.task.scenario,
        focus: input.task.focus ?? [],
        expectedTransformation,
        legitimateTutorContext: input.safeContext,
        turnSystemPrompts: input.turnSystemPrompts,
        conversations: input.conversations,
      }),
    },
  ];
  const raw = await provider.chat(messages, { useJsonFormat: true });
  const parsed = parseJsonObject(raw);
  return {
    accepted: parsed.accepted === true,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : ['评估器未给出 reasons'],
    scores: parsed.scores && typeof parsed.scores === 'object' && !Array.isArray(parsed.scores)
      ? Object.fromEntries(Object.entries(parsed.scores as Record<string, unknown>).map(([key, value]) => [key, Number(value)]))
      : undefined,
  };
}

async function rolloutTask(task: PlanTask): Promise<RolloutResult> {
  const rows = extractRows(task.priorSummary);
  const schema = inferSchema(rows);
  const safeContext = safeTaskContext(task, rows);
  const conversations: ShareGPTRecord['conversations'] = [];
  const history: Message[] = [];
  const turnSystemPrompts: string[] = [];
  const turnTriggerTypes: StageTriggerType[] = [];
  let next = firstInput(task);
  let lastResponse: ChatResponse | undefined;
  let acceptedEvidence = 0;
  let hasStage2Schema = false;

  for (let tutorTurns = 0; tutorTurns < maxTutorTurns(task.phase); tutorTurns++) {
    const context = promptContext(task, safeContext, rows, schema, next.triggerType);
    const systemPrompt = getPromptForPhase(task.phase as PhaseEnum, context);
    turnSystemPrompts.push(systemPrompt);
    turnTriggerTypes.push(next.triggerType);
    const response = await callLLM(
      systemPrompt,
      next.message,
      history,
      {
        stage: task.phase,
        triggerType: next.triggerType,
        visibleContext: visibleContext(task, safeContext, rows, schema),
        hasStage2Schema,
      },
    );
    lastResponse = response;
    conversations.push({ from: 'human', value: next.message });
    conversations.push({ from: 'gpt', value: JSON.stringify(response) });
    history.push({ id: uuidv4(), role: 'user', content: next.message, status: 'sent' });
    history.push({ id: uuidv4(), role: 'assistant', content: response.dialogue, actionType: response.next_action_type, status: 'sent' });
    if (response.data_table_schema) hasStage2Schema = true;
    if (response.analysis_progress?.studentEvidenceAccepted) acceptedEvidence++;
    if (reachedStop(task.phase, response, tutorTurns + 1, acceptedEvidence)) break;
    const studentMessage = await simulateStudent({ task, safeContext, rows, history, tutorResponse: response });
    next = { message: studentMessage, triggerType: 'USER_MESSAGE' };
  }

  if (!lastResponse || !reachedStop(task.phase, lastResponse, turnSystemPrompts.length, acceptedEvidence)) {
    throw new Error(`未在动态上限内达到阶段${task.phase}停止条件`);
  }

  const evaluation = await evaluateRollout({ task, conversations, turnSystemPrompts, safeContext });
  const idHash = createHash('sha1').update(`${task.id}:${JSON.stringify(conversations)}`).digest('hex').slice(0, 12);
  const record: ShareGPTRecord = {
    id: `stem-stage-contract-v2-${task.id}-${idHash}`,
    source: 'distill_stage_contract_rollout',
    scenario: task.scenario,
    phase: task.phase,
    rubricTargets: task.rubricTargets ?? [],
    evidence: [`plan-task:${task.id}`, 'student-simulator+production-tutor+independent-evaluator'],
    qualityNotes: evaluation.reasons.join('；'),
    conversations,
    meta: {
      tier: evaluation.accepted ? 'gold_candidate' : 'reject',
      sourceKind: 'stage_contract_rollout',
      distillTaskId: task.id,
      styleFamily: DEFAULT_STYLE_FAMILY,
      stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION,
      stageContractVersion: STAGE_CONTRACT_VERSION,
      systemPrompt: turnSystemPrompts[0],
      stageTriggerType: turnTriggerTypes[0],
      visibleContext: visibleContext(task, safeContext, rows, schema),
      generationContext: {
        mechanism: 'student-simulator+production-tutor+independent-evaluator',
        turnSystemPrompts,
        turnTriggerTypes,
        dynamicStop: true,
        evaluatorAccepted: evaluation.accepted,
        evaluatorReasons: evaluation.reasons,
        evaluatorScores: evaluation.scores ?? {},
      },
    },
  };
  return { record, evaluation };
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const planFile = flag('--plan', 'data/sft/distill-plan-dsv4.json')!;
  const outFile = flag('--out', 'data/sft/sharegpt-stage-contract-v2.json')!;
  const rejectedFile = flag('--rejected-out', 'data/sft/sharegpt-stage-contract-v2-rejected.json')!;
  const limit = intFlag('--limit');
  const offset = intFlag('--offset') ?? 0;
  const onlyPhase = phaseFlag();
  const plan = JSON.parse(await readFile(planFile, 'utf8')) as PlanFile;
  let tasks = plan.tasks ?? [];
  if (onlyPhase) tasks = tasks.filter((task) => task.phase === onlyPhase);
  tasks = tasks.slice(offset, limit === undefined ? undefined : offset + limit);

  const accepted: ShareGPTRecord[] = [];
  const rejected: Array<{ taskId: string; error?: string; evaluation?: EvaluationResult; record?: ShareGPTRecord }> = [];
  for (const task of tasks) {
    try {
      const result = await rolloutTask(task);
      if (result.evaluation.accepted) accepted.push(result.record);
      else rejected.push({ taskId: task.id, evaluation: result.evaluation, record: result.record });
      console.log(`${result.evaluation.accepted ? 'accepted' : 'rejected'} ${task.id}`);
    } catch (error) {
      rejected.push({ taskId: task.id, error: error instanceof Error ? error.message : String(error) });
      console.error(`failed ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await writeJson(outFile, accepted);
    await writeJson(rejectedFile, rejected);
  }
  console.log(JSON.stringify({ selected: tasks.length, accepted: accepted.length, rejected: rejected.length, outFile, rejectedFile }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
