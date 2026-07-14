import { createHash } from 'crypto';
import type { ChatResponse } from '@/app/models/types';
import { safeParseChatResponse } from '@/app/lib/llm/parser';
import { claimsStage2ArtifactReady, hasResponseStage2Schema, validateChatContract } from '@/app/lib/llm/chatContract';
import { evaluateShareGPTRecordSemantic } from '@/scripts/semantic-guardrails';
import { STAGE_CONTRACT_VERSION, validateStageResponseBehavior, type StageTriggerType } from '@/app/lib/stageContract';
import { evaluateStyleAuthenticity, isStyleFamily } from '@/app/lib/stylePolicy';
import {
  assertTransformationType,
  computeTransformationMetrics,
  type TransformationMetrics,
} from '@/app/lib/trainingEligibility';
import type {
  AutoCheckIssue,
  AutoCheckResult,
  RevisionInput,
  ShareGPTRecord,
  StyleFamily,
  TransformationType,
} from './types';
import { TRANSFORMATION_TYPES } from './types';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export type ValidationMode = 'import' | 'submit' | 'release';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseShareGPTDataset(raw: string): ShareGPTRecord[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('数据集顶层必须是数组');
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 条记录不是对象`);
    }
    return item as ShareGPTRecord;
  });
}

export function parseAssistantResponse(value: string): ChatResponse {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('导师消息必须是 ChatResponse JSON 对象');
  const response = safeParseChatResponse(value);
  if (!response.dialogue?.trim()) throw new Error('导师回复不能为空');
  if (!['ask_choice', 'text_input', 'confirmation', 'info'].includes(response.next_action_type)) {
    throw new Error('next_action_type 无效');
  }
  if (typeof response.phase_complete !== 'boolean') throw new Error('phase_complete 必须是布尔值');
  return response;
}

export function familyKey(record: ShareGPTRecord): string {
  const taskId = typeof record.meta?.distillTaskId === 'string' ? record.meta.distillTaskId : record.id;
  return taskId
    .replace(/^stem-distill-dsv4-/, '')
    .replace(/-v\d+-[0-9a-f]{8,}$/i, '')
    .replace(/-v\d+$/i, '');
}

function issue(ruleCode: string, message: string, evidence?: string, severity: 'error' | 'warning' = 'error', messageIndex?: number): AutoCheckIssue {
  return { ruleCode, severity, message, evidence, messageIndex };
}

function finalizeCheck(issues: AutoCheckIssue[]): AutoCheckResult {
  const deduplicated = new Map<string, AutoCheckIssue>();
  for (const item of issues) {
    const inferredIndex = item.messageIndex ?? (() => {
      const match = item.message.match(/导师消息\s+(\d+)/);
      return match ? Number(match[1]) : undefined;
    })();
    const normalized = inferredIndex === undefined ? item : { ...item, messageIndex: inferredIndex };
    const key = `${normalized.ruleCode}:${normalized.severity}:${normalized.messageIndex ?? 'record'}:${normalized.message}`;
    if (!deduplicated.has(key)) deduplicated.set(key, normalized);
  }
  const normalizedIssues = [...deduplicated.values()];
  const status = normalizedIssues.some((item) => item.severity === 'error') ? 'error' : normalizedIssues.length > 0 ? 'warning' : 'ok';
  return { status, issues: normalizedIssues };
}

function hasNotesColumn(response: ChatResponse): boolean {
  return !!response.data_table_schema?.columns.some((column) => column.key === 'notes' && column.type === 'text');
}

function recordBusinessContext(record: ShareGPTRecord): unknown {
  if (typeof record.meta?.visibleContext !== 'string' || !record.meta.visibleContext.trim()) return null;
  try {
    const parsed = JSON.parse(record.meta.visibleContext) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    const object = parsed as Record<string, unknown>;
    return object.tutorVisible ?? object.businessContext ?? parsed;
  } catch {
    return record.meta.visibleContext;
  }
}

function turnVisibleContext(record: ShareGPTRecord, assistantMessageIndex: number): string {
  const studentMessages = record.conversations
    .slice(0, assistantMessageIndex)
    .filter((message) => message.from === 'human')
    .map((message) => message.value);
  return JSON.stringify({
    businessContext: recordBusinessContext(record),
    currentStudentMessage: studentMessages.at(-1) ?? '',
    priorStudentMessages: studentMessages.slice(0, -1),
  });
}

export function validateShareGPTRecord(record: ShareGPTRecord, mode: ValidationMode = 'import'): AutoCheckResult {
  const issues: AutoCheckIssue[] = [];
  const strict = mode !== 'import';
  const releaseStrict = mode === 'release';
  let hasPriorStage2Schema = false;
  let styleEvidenceTurns = 0;
  let neutralSystemTurns = 0;
  const styleFailureDetails: string[] = [];
  if (record.meta?.stageContractVersion !== STAGE_CONTRACT_VERSION) {
    issues.push(issue(
      'STAGE_CONTRACT_VERSION_MISSING',
      `记录未声明当前阶段合同 ${STAGE_CONTRACT_VERSION}`,
      String(record.meta?.stageContractVersion ?? '缺失'),
      releaseStrict ? 'error' : 'warning'
    ));
  }
  if (typeof record.meta?.systemPrompt !== 'string' || !record.meta.systemPrompt.trim()) {
    issues.push(issue(
      'SYSTEM_PROMPT_SNAPSHOT_MISSING',
      '记录缺少生成时完整 system prompt，不能确认训练可见上下文与生产一致',
      undefined,
      releaseStrict ? 'error' : 'warning'
    ));
  }
  if (typeof record.meta?.stageTriggerType !== 'string' || !record.meta.stageTriggerType.trim()) {
    issues.push(issue(
      'STAGE_TRIGGER_TYPE_MISSING',
      '记录缺少 USER_MESSAGE/STAGE_ENTER/STAGE_TRANSITION 等触发类型',
      undefined,
      releaseStrict ? 'error' : 'warning'
    ));
  }
  const humanTurnCount = record.conversations?.filter((message) => message.from === 'human').length ?? 0;
  const turnSystemPrompts = record.meta?.generationContext?.turnSystemPrompts;
  if (
    turnSystemPrompts !== undefined &&
    (!Array.isArray(turnSystemPrompts) || turnSystemPrompts.length !== humanTurnCount || turnSystemPrompts.some((value) => typeof value !== 'string' || !value.trim()))
  ) {
    issues.push(issue(
      'TURN_SYSTEM_PROMPTS_INVALID',
      '逐轮 system prompt 数量必须与 human/gpt 轮次数一致且均非空',
      undefined,
      releaseStrict ? 'error' : 'warning'
    ));
  }
  if (!record.id?.trim()) issues.push(issue('ID_MISSING', '缺少记录 ID'));
  if (!record.scenario?.trim()) issues.push(issue('SCENARIO_MISSING', '缺少场景名称'));
  if (!Number.isInteger(record.phase) || record.phase < 1 || record.phase > 6) issues.push(issue('PHASE_INVALID', '阶段必须为 1-6'));
  if (!Array.isArray(record.conversations) || record.conversations.length < 2) {
    issues.push(issue('CONVERSATIONS_EMPTY', '对话至少需要一组 human/gpt'));
  }

  for (let index = 0; index < (record.conversations?.length ?? 0); index++) {
    const message = record.conversations[index];
    if (message.from !== 'human' && message.from !== 'gpt') issues.push(issue('MESSAGE_ROLE_INVALID', `消息 ${index} 角色无效`));
    if (index > 0 && record.conversations[index - 1].from === message.from) {
      issues.push(issue('MESSAGE_NOT_ALTERNATING', `消息 ${index} 未与上一条交替`));
    }
    if (!message.value?.trim()) issues.push(issue('MESSAGE_EMPTY', `消息 ${index} 为空`));
    if (message.from !== 'gpt') continue;
    try {
      let rawResponse: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(message.value) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rawResponse = parsed as Record<string, unknown>;
      } catch {
        // parseAssistantResponse 会生成统一的可读错误。
      }
      const response = parseAssistantResponse(message.value);
      const assistantTurnIndex = record.conversations
        .slice(0, index)
        .filter((item) => item.from === 'gpt').length;
      const turnTriggerTypes = record.meta?.generationContext?.turnTriggerTypes;
      const perTurnTrigger = Array.isArray(turnTriggerTypes) && typeof turnTriggerTypes[assistantTurnIndex] === 'string'
        ? turnTriggerTypes[assistantTurnIndex] as StageTriggerType
        : undefined;
      const declaredTrigger = perTurnTrigger ?? (typeof record.meta?.stageTriggerType === 'string'
        ? record.meta.stageTriggerType as StageTriggerType
        : undefined);
      const inferredTrigger: StageTriggerType = declaredTrigger
        ?? (record.phase === 3 && index === 1
          ? 'STAGE_ENTER'
          : record.phase === 5 && index === 1
            ? 'REPORT_BOOTSTRAP'
            : record.phase === 6
              ? 'OPTIONAL_COACHING'
              : 'USER_MESSAGE');
      const rawAction = rawResponse.next_action_type;
      if (typeof rawAction !== 'string' || !['ask_choice', 'text_input', 'confirmation', 'info'].includes(rawAction)) {
        issues.push(issue(
          'ACTION_TYPE_INVALID',
          `导师消息 ${index} 的原始 next_action_type 无效：${String(rawAction ?? '缺失')}`,
          undefined,
          strict ? 'error' : 'warning'
        ));
      }
      if ((response.options?.length ?? 0) > 0 && response.next_action_type !== 'ask_choice') {
        issues.push(issue('OPTIONS_ACTION_MISMATCH', `导师消息 ${index} 的 options 与动作类型不一致`));
      }
      if (record.phase === 1 && response.stage1_confirmed) {
        if (!response.theme_mapping || !response.snapshot?.trim() || !response.topic_direction?.factor?.trim() || !response.topic_direction?.phenomenon?.trim()) {
          issues.push(issue(
            'PHASE1_CONFIRMATION_INCOMPLETE',
            `导师消息 ${index} 缺少新版阶段1确认结构（theme_mapping/snapshot/topic_direction）`,
            response.dialogue,
            strict ? 'error' : 'warning'
          ));
        }
      }
      if (record.phase === 2) {
        const rawHasSchema = Object.prototype.hasOwnProperty.call(rawResponse, 'data_table_schema');
        if (rawHasSchema && !response.data_table_schema) {
          issues.push(issue('PHASE2_SCHEMA_MALFORMED', `导师消息 ${index} 的 data_table_schema 为空或格式错误`));
        }
        const contract = validateChatContract(response, {
          stage: 2,
          hasStage2Schema: hasPriorStage2Schema,
        });
        for (const contractIssue of contract.issues) {
          issues.push(issue(
            contractIssue.code,
            `导师消息 ${index}：${contractIssue.message}`,
            response.dialogue,
            contractIssue.code === 'P2_SCHEMA_ACTION_MISMATCH' && !strict ? 'warning' : 'error'
          ));
        }
        if (response.data_table_schema && (!hasNotesColumn(response) || response.data_table_schema.maxRows !== 200)) {
          issues.push(issue('PHASE2_SCHEMA_INVALID', `导师消息 ${index} 的数据表必须含 notes 文本列且 maxRows 为 200`));
        }
        if (hasResponseStage2Schema(response)) hasPriorStage2Schema = true;
      }
      if (record.phase === 5 && inferredTrigger === 'REPORT_BOOTSTRAP') {
        const sections = response.report_sections;
        if (!sections || Object.values(sections).some((value) => !value.trim())) {
          issues.push(issue('PHASE5_SECTIONS_INCOMPLETE', `导师消息 ${index} 的报告框架不完整`));
        }
      }

      for (const contractIssue of validateStageResponseBehavior(record.phase, response, {
        triggerType: inferredTrigger,
        visibleContext: turnVisibleContext(record, index),
      })) {
        issues.push(issue(
          contractIssue.code,
          `导师消息 ${index}：${contractIssue.message}`,
          contractIssue.evidence ?? response.dialogue,
          contractIssue.severity === 'warning' || !strict ? 'warning' : 'error'
        ));
      }
      if (isStyleFamily(record.meta?.styleFamily)) {
        const styleCheck = evaluateStyleAuthenticity(record.meta.styleFamily, response, {
          phase: record.phase,
          triggerType: inferredTrigger,
        });
        if (styleCheck.neutralSystemResponse) {
          neutralSystemTurns++;
        } else if (styleCheck.issues.length > 0) {
          styleFailureDetails.push(`导师消息 ${index}：${styleCheck.issues.join('；')}；原文：${response.dialogue}`);
        } else {
          styleEvidenceTurns++;
        }
      }
      if (record.phase === 5 && response.report_sections) {
        const missingContext = Object.values(response.report_sections)
          .some((value) => /待学生补充|信息缺失|尚未提供|未提供/.test(value));
        const reportPath = record.meta?.generationContext?.reportPath;
        if (missingContext && reportPath !== 'fallback') {
          issues.push(issue(
            'P5_FALLBACK_NOT_CLASSIFIED',
            `导师消息 ${index} 含缺失信息占位，但记录没有标记为 fallback`,
            JSON.stringify(response.report_sections),
          ));
        }
        if (!missingContext && reportPath === 'fallback') {
          issues.push(issue(
            'P5_FALLBACK_CLASSIFICATION_MISMATCH',
            `导师消息 ${index} 没有缺失信息占位，却被标记为 fallback`,
            JSON.stringify(response.report_sections),
          ));
        }
      }

      const questionMarks = (response.dialogue.match(/[？?]/g) ?? []).length;
      if (questionMarks > 2) {
        issues.push(issue('COGNITIVE_LOAD_RISK', `导师消息 ${index} 一次提出了 ${questionMarks} 个问题`, response.dialogue, 'warning'));
      }
      if (/我帮你|我替你|我已经帮你|为你写好/.test(response.dialogue)) {
        issues.push(issue('AGENCY_LANGUAGE_RISK', `导师消息 ${index} 含可能代劳的措辞`, response.dialogue, 'warning'));
      }
    } catch (error) {
      issues.push(issue('CHAT_RESPONSE_INVALID', `导师消息 ${index} 无法解析：${error instanceof Error ? error.message : String(error)}`));
    }
  }

  if (isStyleFamily(record.meta?.styleFamily) && styleEvidenceTurns === 0) {
    issues.push(issue(
      'STYLE_NOT_OBSERVABLE',
      neutralSystemTurns > 0
        ? '该记录只有中性结构化交付轮或其他不具备目标风格证据的回复，不能证明目标风格已经学到'
        : '该记录没有任何一轮呈现可观察的目标风格证据',
      styleFailureDetails.join('\n') || undefined,
      'warning',
    ));
  }

  const semantic = evaluateShareGPTRecordSemantic(record);
  if (semantic.status !== 'ok') {
    issues.push(issue(
      semantic.reason ?? `SEMANTIC_${semantic.status.toUpperCase()}`,
      semantic.status === 'reject' ? '语义守卫判定为机制漂移' : '语义守卫建议人工复核',
      semantic.details.join('; '),
      semantic.status === 'reject' ? 'error' : 'warning'
    ));
  }

  return finalizeCheck(issues);
}

export interface RevisionValidationOptions {
  mode?: ValidationMode;
  styleFamily?: StyleFamily | null;
  stylePolicyVersion?: string | null;
}

export interface AnnotationRevisionValidation {
  normalizedInput: RevisionInput;
  revisedRecord?: ShareGPTRecord;
  check: AutoCheckResult;
  transformationType?: TransformationType;
  transformationMetrics?: TransformationMetrics;
}

/**
 * Data Lab 修订的唯一纯校验入口。预检、正式提交和复审合并版本必须复用它，
 * 以保证同一输入得到相同的规则码与严重度。
 */
export function validateAnnotationRevision(
  original: ShareGPTRecord,
  input: RevisionInput,
  options: RevisionValidationOptions = {},
): AnnotationRevisionValidation {
  const normalizedInput = normalizeLegacyEmptyStage2Schemas(input).input;
  const preliminary: AutoCheckIssue[] = [];
  let revisedRecord: ShareGPTRecord;

  try {
    assertRevisionIntent(original, normalizedInput);
    revisedRecord = applyRevision(original, normalizedInput);
  } catch (error) {
    preliminary.push(issue(
      'REVISION_INPUT_INVALID',
      error instanceof Error ? error.message : String(error),
    ));
    return { normalizedInput, check: finalizeCheck(preliminary) };
  }

  if (isStyleFamily(options.styleFamily)) {
    revisedRecord = {
      ...revisedRecord,
      meta: {
        ...(revisedRecord.meta ?? {}),
        styleFamily: options.styleFamily,
        stylePolicyVersion: options.stylePolicyVersion?.trim()
          || (typeof revisedRecord.meta?.stylePolicyVersion === 'string' ? revisedRecord.meta.stylePolicyVersion : undefined),
      },
    };
  }

  const transformationMetrics = computeTransformationMetrics(original, revisedRecord);
  const transformationType: TransformationType = normalizedInput.transformationType
    && TRANSFORMATION_TYPES.includes(normalizedInput.transformationType)
      ? normalizedInput.transformationType
      : normalizedInput.noChange ? 'NO_CHANGE' : transformationMetrics.recommendedType;
  try {
    assertTransformationType(transformationType, transformationMetrics);
  } catch (error) {
    preliminary.push(issue(
      'TRANSFORMATION_TYPE_INVALID',
      error instanceof Error ? error.message : String(error),
    ));
  }

  const recordCheck = validateShareGPTRecord(revisedRecord, options.mode ?? 'submit');
  return {
    normalizedInput,
    revisedRecord,
    check: finalizeCheck([...preliminary, ...recordCheck.issues]),
    transformationType,
    transformationMetrics,
  };
}

export function applyRevision(record: ShareGPTRecord, input: RevisionInput): ShareGPTRecord {
  const expectedIndexes = record.conversations
    .map((message, index) => message.from === 'gpt' ? index : -1)
    .filter((index) => index >= 0);
  const supplied = new Map(input.assistantMessages.map((item) => [item.messageIndex, item.response]));
  if (supplied.size !== expectedIndexes.length || expectedIndexes.some((index) => !supplied.has(index))) {
    throw new Error('必须提交全部导师轮次，且不能修改学生消息');
  }

  return {
    ...record,
    conversations: record.conversations.map((message, index) => {
      if (message.from !== 'gpt') return message;
      return { from: 'gpt', value: JSON.stringify(supplied.get(index)) };
    }),
  };
}

/**
 * 兼容旧版标注器产生的“中间轮次空表”。只有回复仍在继续讨论、未声称表格完成时才安全移除；
 * confirmation、phase_complete 或声称已生成表格的空 schema 必须继续作为结构错误暴露。
 */
export function normalizeLegacyEmptyStage2Schemas(input: RevisionInput): {
  input: RevisionInput;
  removedMessageIndexes: number[];
} {
  const removedMessageIndexes: number[] = [];
  const assistantMessages = input.assistantMessages.map((item) => {
    const response = JSON.parse(JSON.stringify(item.response)) as ChatResponse;
    const schema = response.data_table_schema;
    const removable = schema
      && schema.columns.length === 0
      && response.next_action_type === 'text_input'
      && response.phase_complete === false
      && !claimsStage2ArtifactReady(response.dialogue);
    if (removable) {
      delete response.data_table_schema;
      removedMessageIndexes.push(item.messageIndex);
    }
    return { ...item, response };
  });
  return { input: { ...input, assistantMessages }, removedMessageIndexes };
}

/** “无需修改”只能用于导师结构化回复逐轮完全不变的提交。 */
export function assertRevisionIntent(record: ShareGPTRecord, input: RevisionInput): void {
  if (!input.noChange) return;
  const original = new Map(
    record.conversations
      .map((message, index) => message.from === 'gpt'
        ? [index, parseAssistantResponse(message.value)] as const
        : null)
      .filter((item): item is readonly [number, ChatResponse] => item !== null)
  );
  const changed = input.assistantMessages.some((item) => {
    const source = original.get(item.messageIndex);
    return !source || JSON.stringify(source) !== JSON.stringify(item.response);
  });
  if (changed) throw new Error('已修改导师回复，不能同时勾选“无需修改”');
}

export function canonicalizeRecord(record: ShareGPTRecord): ShareGPTRecord {
  return {
    ...record,
    conversations: record.conversations.map((message) => message.from === 'gpt'
      ? { ...message, value: JSON.stringify(parseAssistantResponse(message.value)) }
      : { ...message, value: message.value.trim() }),
  };
}
