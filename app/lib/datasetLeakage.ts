import type { ShareGPTRecord } from '@/app/lib/dataLab/types';
import { productionContentFingerprint } from '@/app/lib/redaction';

export interface LeakageSource {
  id: string;
  record: ShareGPTRecord;
}

function normalizedText(record: ShareGPTRecord): string {
  return record.conversations
    .map((message) => `${message.from}:${message.value}`)
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：“”‘’（）,.!?;:'"()]/g, '');
}

function shingles(value: string, size = 5): Set<string> {
  const result = new Set<string>();
  if (value.length <= size) return new Set([value]);
  for (let index = 0; index <= value.length - size; index++) {
    result.add(value.slice(index, index + size));
  }
  return result;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function detectDatasetLeakage(candidate: ShareGPTRecord, sources: LeakageSource[]) {
  const fingerprint = productionContentFingerprint(candidate);
  const candidateShingles = shingles(normalizedText(candidate));
  const exactMatches: string[] = [];
  const nearDuplicates: Array<{ id: string; similarity: number }> = [];

  for (const source of sources) {
    if (productionContentFingerprint(source.record) === fingerprint) {
      exactMatches.push(source.id);
      continue;
    }
    const similarity = jaccard(candidateShingles, shingles(normalizedText(source.record)));
    if (similarity >= 0.9) nearDuplicates.push({ id: source.id, similarity: Number(similarity.toFixed(4)) });
  }

  return {
    policyVersion: 'dataset-leakage-v1',
    blocked: exactMatches.length > 0,
    exactMatches: exactMatches.slice(0, 20),
    nearDuplicates: nearDuplicates.sort((a, b) => b.similarity - a.similarity).slice(0, 20),
    checkedRecords: sources.length,
  };
}
