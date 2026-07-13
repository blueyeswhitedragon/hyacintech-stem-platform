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
