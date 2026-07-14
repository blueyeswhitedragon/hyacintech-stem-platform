import {
  DEFAULT_STYLE_FAMILY,
  DEFAULT_STYLE_POLICY_VERSION,
  STYLE_FAMILIES,
  isStyleFamily,
  type StyleFamily,
} from '@/app/lib/stylePolicy';
import type { ShareGPTRecord, TrainingShareGPTRecord } from './types';
import { getPromptForPhase } from '@/app/prompts';
import { PhaseEnum } from '@/app/models/types';
import { parseAssistantResponse } from './validation';

export interface RecordStyle {
  styleFamily: StyleFamily;
  stylePolicyVersion: string;
}

export function resolveRecordStyle(
  record: ShareGPTRecord,
  fallbackFamily?: string | null,
  fallbackVersion?: string | null,
): RecordStyle {
  return {
    styleFamily: isStyleFamily(record.meta?.styleFamily)
      ? record.meta.styleFamily
      : isStyleFamily(fallbackFamily)
        ? fallbackFamily
        : DEFAULT_STYLE_FAMILY,
    stylePolicyVersion: typeof record.meta?.stylePolicyVersion === 'string' && record.meta.stylePolicyVersion.trim()
      ? record.meta.stylePolicyVersion
      : fallbackVersion?.trim() || DEFAULT_STYLE_POLICY_VERSION,
  };
}

export function withStyleMetadata(record: ShareGPTRecord, style: RecordStyle): ShareGPTRecord {
  return {
    ...record,
    meta: {
      ...(record.meta ?? {}),
      styleFamily: style.styleFamily,
      stylePolicyVersion: style.stylePolicyVersion,
    },
  };
}

function looksLikeStructuredAssistantTarget(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return !!parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && typeof (parsed as { dialogue?: unknown }).dialogue === 'string';
  } catch {
    return false;
  }
}

/**
 * Training records have one structured supervision target. Earlier tutor turns
 * must match production history and therefore contain dialogue text only.
 */
export function assertTrainingConversationFormat(record: TrainingShareGPTRecord): void {
  const systems = record.conversations
    .map((message, index) => message.from === 'system' ? index : -1)
    .filter((index) => index >= 0);
  if (systems.length !== 1 || systems[0] !== 0) {
    throw new Error(`${record.id}: 训练记录必须且只能以一条 system 消息开头`);
  }
  const assistantIndexes = record.conversations
    .map((message, index) => message.from === 'gpt' ? index : -1)
    .filter((index) => index >= 0);
  if (assistantIndexes.length === 0) throw new Error(`${record.id}: 训练记录缺少导师监督目标`);
  const targetIndex = assistantIndexes.at(-1)!;
  for (const index of assistantIndexes.slice(0, -1)) {
    if (looksLikeStructuredAssistantTarget(record.conversations[index].value)) {
      throw new Error(`${record.id}: 历史导师消息 ${index} 含 ChatResponse JSON，必须改为纯 dialogue`);
    }
  }
  if (!looksLikeStructuredAssistantTarget(record.conversations[targetIndex].value)) {
    throw new Error(`${record.id}: 当前导师监督目标必须保留完整 ChatResponse JSON`);
  }
}

export function toTrainingShareGPTRecords(record: ShareGPTRecord, style: RecordStyle): TrainingShareGPTRecord[] {
  const enriched = withStyleMetadata(record, style);
  // 新数据必须保存生成时的完整生产 system prompt。旧记录仅保留可读回退，
  // 严格发布校验会阻止缺少该快照的数据进入训练集。
  const systemPrompt = typeof enriched.meta?.systemPrompt === 'string' && enriched.meta.systemPrompt.trim()
    ? enriched.meta.systemPrompt
    : getPromptForPhase(enriched.phase as PhaseEnum, {
        styleFamily: style.styleFamily,
        stylePolicyVersion: style.stylePolicyVersion,
      });
  // expectedTransformation is evaluator-only metadata and must never be emitted in an SFT artifact.
  const trainingMeta = enriched.meta
    ? Object.fromEntries(Object.entries(enriched.meta).filter(([key]) => key !== 'expectedTransformation'))
    : undefined;
  const perTurnPrompts = Array.isArray(enriched.meta?.generationContext?.turnSystemPrompts)
    ? enriched.meta.generationContext.turnSystemPrompts.filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0
      )
    : [];
  const modelVisibleHistory = Array.isArray(enriched.meta?.generationContext?.modelVisibleHistory)
    ? enriched.meta.generationContext.modelVisibleHistory.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const role = (item as { role?: unknown }).role;
        const content = (item as { content?: unknown }).content;
        if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) return [];
        return [{ from: role === 'user' ? 'human' as const : 'gpt' as const, value: content }];
      })
    : [];
  const assistantTurnCount = enriched.conversations.filter((message) => message.from === 'gpt').length;
  if (perTurnPrompts.length > 0 || assistantTurnCount > 1) {
    let turnIndex = 0;
    const history: Array<{ from: 'human' | 'gpt'; value: string }> = [...modelVisibleHistory];
    const records: TrainingShareGPTRecord[] = [];
    for (const message of enriched.conversations) {
      if (message.from === 'human') {
        history.push(message);
        continue;
      }
      const response = parseAssistantResponse(message.value);
      const prompt = perTurnPrompts[turnIndex] ?? perTurnPrompts.at(-1) ?? systemPrompt;
      const trainingRecord: TrainingShareGPTRecord = {
        ...enriched,
        id: `${enriched.id}-turn-${turnIndex + 1}`,
        meta: { ...trainingMeta, trainingTurnIndex: turnIndex },
        conversations: [
          { from: 'system', value: prompt },
          ...history,
          message,
        ],
      };
      assertTrainingConversationFormat(trainingRecord);
      records.push(trainingRecord);
      history.push({ from: 'gpt', value: response.dialogue });
      turnIndex++;
    }
    return records;
  }
  const trainingRecord: TrainingShareGPTRecord = {
    ...enriched,
    meta: trainingMeta,
    conversations: [
      { from: 'system', value: systemPrompt },
      ...modelVisibleHistory,
      ...enriched.conversations,
    ],
  };
  assertTrainingConversationFormat(trainingRecord);
  return [trainingRecord];
}

/** Backward-compatible helper for one-turn fixtures and callers. */
export function toTrainingShareGPTRecord(record: ShareGPTRecord, style: RecordStyle): TrainingShareGPTRecord {
  return toTrainingShareGPTRecords(record, style)[0];
}

export function summarizeStyles(styles: RecordStyle[]): Record<StyleFamily, number> {
  const summary = Object.fromEntries(STYLE_FAMILIES.map((family) => [family, 0])) as Record<StyleFamily, number>;
  for (const style of styles) summary[style.styleFamily]++;
  return summary;
}
