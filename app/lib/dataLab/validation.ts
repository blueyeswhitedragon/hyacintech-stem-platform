import { createHash } from 'crypto';
import type { ChatResponse } from '@/app/models/types';
import { safeParseChatResponse } from '@/app/lib/llm/parser';
import { evaluateShareGPTRecordSemantic } from '@/scripts/semantic-guardrails';
import type {
  AutoCheckIssue,
  AutoCheckResult,
  RevisionInput,
  ShareGPTRecord,
} from './types';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

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

function issue(ruleCode: string, message: string, evidence?: string, severity: 'error' | 'warning' = 'error'): AutoCheckIssue {
  return { ruleCode, severity, message, evidence };
}

function hasNotesColumn(response: ChatResponse): boolean {
  return !!response.data_table_schema?.columns.some((column) => column.key === 'notes' && column.type === 'text');
}

export function validateShareGPTRecord(record: ShareGPTRecord): AutoCheckResult {
  const issues: AutoCheckIssue[] = [];
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
      const response = parseAssistantResponse(message.value);
      if ((response.options?.length ?? 0) > 0 && response.next_action_type !== 'ask_choice') {
        issues.push(issue('OPTIONS_ACTION_MISMATCH', `导师消息 ${index} 的 options 与动作类型不一致`));
      }
      if (record.phase === 1 && response.phase_complete) {
        if (!response.stage1_confirmed || !response.theme_mapping || !response.snapshot?.trim() || !response.variables?.independent?.trim()) {
          issues.push(issue('PHASE1_CONFIRMATION_INCOMPLETE', `导师消息 ${index} 缺少阶段1确认结构`));
        }
      }
      if (record.phase === 2 && response.phase_complete) {
        if (!response.data_table_schema || !hasNotesColumn(response) || response.data_table_schema.maxRows !== 200) {
          issues.push(issue('PHASE2_SCHEMA_INVALID', `导师消息 ${index} 缺少合法数据表 schema`));
        }
      }
      if (record.phase === 5) {
        const sections = response.report_sections;
        if (!sections || Object.values(sections).some((value) => !value.trim())) {
          issues.push(issue('PHASE5_SECTIONS_INCOMPLETE', `导师消息 ${index} 的报告框架不完整`));
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

  const semantic = evaluateShareGPTRecordSemantic(record);
  if (semantic.status !== 'ok') {
    issues.push(issue(
      semantic.reason ?? `SEMANTIC_${semantic.status.toUpperCase()}`,
      semantic.status === 'reject' ? '语义守卫判定为机制漂移' : '语义守卫建议人工复核',
      semantic.details.join('; '),
      semantic.status === 'reject' ? 'error' : 'warning'
    ));
  }

  const status = issues.some((item) => item.severity === 'error') ? 'error' : issues.length > 0 ? 'warning' : 'ok';
  return { status, issues };
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

export function canonicalizeRecord(record: ShareGPTRecord): ShareGPTRecord {
  return {
    ...record,
    conversations: record.conversations.map((message) => message.from === 'gpt'
      ? { ...message, value: JSON.stringify(parseAssistantResponse(message.value)) }
      : { ...message, value: message.value.trim() }),
  };
}
