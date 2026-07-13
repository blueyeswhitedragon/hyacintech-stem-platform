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
  if (perTurnPrompts.length > 0) {
    let turnIndex = 0;
    const history: Array<{ from: 'human' | 'gpt'; value: string }> = [];
    const records: TrainingShareGPTRecord[] = [];
    for (const message of enriched.conversations) {
      if (message.from === 'human') {
        history.push(message);
        continue;
      }
      history.push(message);
      const prompt = perTurnPrompts[turnIndex] ?? perTurnPrompts.at(-1) ?? systemPrompt;
      records.push({
        ...enriched,
        id: `${enriched.id}-turn-${turnIndex + 1}`,
        meta: { ...trainingMeta, trainingTurnIndex: turnIndex },
        conversations: [
          { from: 'system', value: prompt },
          ...history,
        ],
      });
      turnIndex++;
    }
    return records;
  }
  return [{
    ...enriched,
    meta: trainingMeta,
    conversations: [
      { from: 'system', value: systemPrompt },
      ...modelVisibleHistory,
      ...enriched.conversations,
    ],
  }];
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
