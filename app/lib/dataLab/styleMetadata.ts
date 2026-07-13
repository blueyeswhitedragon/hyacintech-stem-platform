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

export function toTrainingShareGPTRecord(record: ShareGPTRecord, style: RecordStyle): TrainingShareGPTRecord {
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
  if (perTurnPrompts.length > 0) {
    let turnIndex = 0;
    const conversations: TrainingShareGPTRecord['conversations'] = [];
    for (const message of enriched.conversations) {
      if (message.from === 'human') {
        conversations.push({
          from: 'system',
          value: perTurnPrompts[turnIndex] ?? perTurnPrompts.at(-1) ?? systemPrompt,
        });
        turnIndex++;
      }
      conversations.push(message);
    }
    return { ...enriched, meta: trainingMeta, conversations };
  }
  return {
    ...enriched,
    meta: trainingMeta,
    conversations: [
      { from: 'system', value: systemPrompt },
      ...enriched.conversations,
    ],
  };
}

export function summarizeStyles(styles: RecordStyle[]): Record<StyleFamily, number> {
  const summary = Object.fromEntries(STYLE_FAMILIES.map((family) => [family, 0])) as Record<StyleFamily, number>;
  for (const style of styles) summary[style.styleFamily]++;
  return summary;
}
