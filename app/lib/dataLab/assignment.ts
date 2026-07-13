import { STYLE_FAMILIES, type StyleFamily } from '@/app/lib/stylePolicy';

type StyleWeights = Partial<Record<StyleFamily, number>>;

export function weightedStyleSequence(weights: StyleWeights): StyleFamily[] {
  const sequence = STYLE_FAMILIES.flatMap((style) =>
    Array.from({ length: Math.max(0, Math.round(weights[style] ?? 0)) }, () => style)
  );
  return sequence.length > 0 ? sequence : [...STYLE_FAMILIES];
}

export function styleForSample(index: number, weights: StyleWeights): StyleFamily {
  const sequence = weightedStyleSequence(weights);
  return sequence[index % sequence.length];
}

/** 同一样本的独立双标必须执行同一个目标，不能按槽位切换风格。 */
export function stylesForSampleSlots(index: number, slots: number, weights: StyleWeights): StyleFamily[] {
  return Array.from({ length: Math.max(0, slots) }, () => styleForSample(index, weights));
}

export interface AnnotationCandidate {
  id: string;
  campaignId: string;
  sampleId: string;
  familyKey: string;
  draftJson: string;
}

export function hasMeaningfulDraft(draftJson: string): boolean {
  if (!draftJson.trim() || draftJson.trim() === '{}') return false;
  try {
    const parsed = JSON.parse(draftJson) as Record<string, unknown>;
    return Object.keys(parsed).length > 0;
  } catch {
    return true;
  }
}

export function chooseAnnotationCandidate<T extends AnnotationCandidate>(
  candidates: T[],
  handledPairs: ReadonlySet<string>,
  excludedFamilies: ReadonlySet<string>,
): T | null {
  const unseen = candidates.filter((item) => !handledPairs.has(`${item.campaignId}:${item.sampleId}`));
  return unseen.find((item) => !excludedFamilies.has(item.familyKey)) ?? unseen[0] ?? null;
}

export function claimUnavailableReason(input: {
  activeCampaigns: number;
  assignedCampaigns?: number;
  remainingGlobal: number;
  blockedByDoubleBlind: number;
}): 'NO_ACTIVE_CAMPAIGN' | 'NO_CAMPAIGN_ASSIGNMENT' | 'DOUBLE_BLIND_EXHAUSTED' | 'NO_PENDING_TASKS' {
  if (input.activeCampaigns === 0) return 'NO_ACTIVE_CAMPAIGN';
  if (input.assignedCampaigns === 0) return 'NO_CAMPAIGN_ASSIGNMENT';
  if (input.remainingGlobal > 0 && input.blockedByDoubleBlind > 0) return 'DOUBLE_BLIND_EXHAUSTED';
  return 'NO_PENDING_TASKS';
}
