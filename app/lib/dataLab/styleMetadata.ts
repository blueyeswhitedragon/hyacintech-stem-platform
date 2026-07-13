import {
  DEFAULT_STYLE_FAMILY,
  DEFAULT_STYLE_POLICY_VERSION,
  STYLE_FAMILIES,
  buildStyleInstruction,
  isStyleFamily,
  type StyleFamily,
} from '@/app/lib/stylePolicy';
import type { ShareGPTRecord, TrainingShareGPTRecord } from './types';

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
  return {
    ...enriched,
    conversations: [
      { from: 'system', value: buildStyleInstruction(style.styleFamily, style.stylePolicyVersion) },
      ...enriched.conversations,
    ],
  };
}

export function summarizeStyles(styles: RecordStyle[]): Record<StyleFamily, number> {
  const summary = Object.fromEntries(STYLE_FAMILIES.map((family) => [family, 0])) as Record<StyleFamily, number>;
  for (const style of styles) summary[style.styleFamily]++;
  return summary;
}
