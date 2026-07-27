export interface TopicCardGapRequest {
  subject?: string;
  contextModule?: string;
  activityMode?: string;
}

export interface TopicCardGapCoverage {
  total: number;
}

export interface TopicCardGapRequirement {
  total: number;
}

export interface TopicCardGapPlan {
  requests: TopicCardGapRequest[];
  manualActions: string[];
}

const MAX_AUTOFILL_REQUESTS = 5;

export function planTopicCardGaps(
  fullFailures: string[],
  coverage: TopicCardGapCoverage,
  requirement: TopicCardGapRequirement,
): TopicCardGapPlan {
  const requests: TopicCardGapRequest[] = [];
  const manualActions: string[] = [];

  for (const failure of fullFailures) {
    const [code, detail, rawCount] = failure.split(':');
    if (code === 'FULL_REQUIRES_3_TOPIC_CARDS_PER_SUBJECT' && detail) {
      const count = Number.parseInt(rawCount ?? '', 10);
      const deficit = Number.isFinite(count) ? Math.max(3 - count, 0) : 1;
      for (let index = 0; index < deficit; index += 1) requests.push({ subject: detail });
    } else if (code === 'FULL_REQUIRES_3_TOPIC_CARDS_PER_CONTEXT_MODULE' && detail) {
      requests.push({ contextModule: detail });
    } else if (code === 'FULL_REQUIRES_ENGINEERING_OR_HYBRID_PER_CONTEXT_MODULE' && detail) {
      requests.push({ contextModule: detail, activityMode: 'ENGINEERING_DESIGN' });
    } else if (code === 'FULL_REQUIRES_6_ENGINEERING_OR_HYBRID_TOPIC_CARDS') {
      requests.push({ activityMode: 'ENGINEERING_DESIGN' });
    } else if (code === 'FULL_REQUIRES_ALL_V2_TOPIC_CARDS' || code === 'FULL_DUPLICATE_PROJECT_FAMILY') {
      manualActions.push(failure);
    }
  }

  if (requests.length === 0) {
    const totalGap = Math.max(requirement.total - coverage.total, 0);
    for (let index = 0; index < totalGap; index += 1) requests.push({});
  }

  return { requests: requests.slice(0, MAX_AUTOFILL_REQUESTS), manualActions };
}
