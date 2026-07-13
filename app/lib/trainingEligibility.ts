import type { ShareGPTRecord, TransformationType } from '@/app/lib/dataLab/types';

export const TRAINING_POLICY_VERSION = 'training-policy-v1';

export interface TransformationMetrics {
  exactMatch: boolean;
  changedTurns: number;
  totalAssistantTurns: number;
  textChangeRatio: number;
  structureChanged: boolean;
  recommendedType: TransformationType;
}

function assistantValues(record: ShareGPTRecord): string[] {
  return record.conversations.filter((message) => message.from === 'gpt').map((message) => message.value);
}

function charShingles(value: string, size = 3) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const set = new Set<string>();
  if (normalized.length <= size) return new Set([normalized]);
  for (let index = 0; index <= normalized.length - size; index++) set.add(normalized.slice(index, index + size));
  return set;
}

function similarity(a: string, b: string) {
  if (a === b) return 1;
  const left = charShingles(a);
  const right = charShingles(b);
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection++;
  return intersection / Math.max(1, left.size + right.size - intersection);
}

function withoutDialogue(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    delete parsed.dialogue;
    return JSON.stringify(parsed);
  } catch {
    return value;
  }
}

export function computeTransformationMetrics(original: ShareGPTRecord, revised: ShareGPTRecord): TransformationMetrics {
  const before = assistantValues(original);
  const after = assistantValues(revised);
  const total = Math.max(before.length, after.length);
  let changedTurns = 0;
  let weightedChange = 0;
  let structureChanged = before.length !== after.length;
  for (let index = 0; index < total; index++) {
    const left = before[index] ?? '';
    const right = after[index] ?? '';
    if (left !== right) changedTurns++;
    weightedChange += 1 - similarity(left, right);
    if (withoutDialogue(left) !== withoutDialogue(right)) structureChanged = true;
  }
  const textChangeRatio = Number((weightedChange / Math.max(1, total)).toFixed(4));
  const exactMatch = changedTurns === 0;
  const recommendedType: TransformationType = exactMatch
    ? 'NO_CHANGE'
    : textChangeRatio >= 0.45
      ? 'HUMAN_REWRITE'
      : structureChanged || textChangeRatio >= 0.1
        ? 'MATERIAL_CORRECTION'
        : 'LIGHT_EDIT';
  return { exactMatch, changedTurns, totalAssistantTurns: total, textChangeRatio, structureChanged, recommendedType };
}

export function assertTransformationType(declared: TransformationType, metrics: TransformationMetrics) {
  if (declared === 'NO_CHANGE' && !metrics.exactMatch) throw new Error('回复已经修改，不能声明为无需修改');
  if (declared !== 'NO_CHANGE' && metrics.exactMatch) throw new Error('回复没有变化，变换类型必须选择无需修改');
  const rank: Record<TransformationType, number> = { NO_CHANGE: 0, LIGHT_EDIT: 1, MATERIAL_CORRECTION: 2, HUMAN_REWRITE: 3 };
  if (rank[declared] > rank[metrics.recommendedType]) {
    throw new Error(`实际差异仅支持“${metrics.recommendedType}”，不能上报为“${declared}”`);
  }
}

export interface EligibilityInput {
  sourceKind: string;
  candidateStatus?: string | null;
  consentStatus?: string | null;
  leakageBlocked?: boolean;
  transformationType?: string | null;
  metrics?: Partial<TransformationMetrics> | null;
  workReviewApproved: boolean;
  finallySelected: boolean;
}

export function evaluateTrainingEligibility(input: EligibilityInput) {
  const reasons: string[] = [];
  if (!input.workReviewApproved) reasons.push('WORK_REVIEW_NOT_APPROVED');
  if (!input.finallySelected) reasons.push('NOT_FINALLY_SELECTED');
  if (input.sourceKind !== 'production_trace') {
    return { eligibility: reasons.length ? 'BLOCKED' : 'SFT_ALLOWED', reasons, preferenceAllowed: false } as const;
  }
  if (input.candidateStatus !== 'CONVERTED') reasons.push('CANDIDATE_NOT_ACTIVE');
  if (input.consentStatus !== 'GRANTED') reasons.push('CONSENT_NOT_GRANTED');
  if (input.leakageBlocked) reasons.push('DATASET_LEAKAGE');
  const material = input.transformationType === 'MATERIAL_CORRECTION' || input.transformationType === 'HUMAN_REWRITE';
  const metricsMaterial = (input.metrics?.textChangeRatio ?? 0) >= 0.1 || input.metrics?.structureChanged === true;
  if (!material || !metricsMaterial) reasons.push('NO_MATERIAL_HUMAN_CORRECTION');
  if (reasons.length) {
    const monitoringOnly = reasons.every((reason) => reason === 'NO_MATERIAL_HUMAN_CORRECTION');
    return { eligibility: monitoringOnly ? 'MONITORING_ONLY' : 'BLOCKED', reasons, preferenceAllowed: false } as const;
  }
  return { eligibility: 'SFT_ALLOWED', reasons: [], preferenceAllowed: true } as const;
}

export function buildPreferenceRecord(input: {
  id: string;
  original: ShareGPTRecord;
  chosen: ShareGPTRecord;
  meta: Record<string, unknown>;
}) {
  return {
    id: input.id,
    prompt: input.chosen.conversations.filter((message) => message.from === 'human'),
    chosen: input.chosen.conversations.filter((message) => message.from === 'gpt'),
    rejected: input.original.conversations.filter((message) => message.from === 'gpt'),
    meta: input.meta,
  };
}
