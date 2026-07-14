import type { AnalysisProgress } from '@/app/models/types';

export interface GroundedAnalysisEvidence {
  accepted: boolean;
  matchedValues: string[];
  citations: string[];
}

function normalized(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function visibleRowValues(rows: Record<string, unknown>[]): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    for (const value of Object.values(row)) {
      const token = normalized(value);
      if (!token || token.length > 80) continue;
      if (typeof value === 'number' || /^-?\d+(?:\.\d+)?(?:%|℃|°C)?$/i.test(token) || token.length >= 2) {
        values.add(token);
      }
    }
  }
  return [...values];
}

/**
 * Do not trust the model's studentEvidenceAccepted flag on its own. A valid
 * analysis round must quote at least two distinct values that exist in the
 * submitted table and were actually written by the student in this turn.
 */
export function groundAnalysisEvidence(
  progress: AnalysisProgress,
  studentMessage: string,
  rows: Record<string, unknown>[],
): GroundedAnalysisEvidence {
  const citations = (progress.evidenceCitations ?? []).map((item) => item.trim()).filter(Boolean);
  if (!progress.studentEvidenceAccepted || !progress.observation?.trim() || citations.length === 0) {
    return { accepted: false, matchedValues: [], citations };
  }

  const message = normalized(studentMessage);
  const matchedValues = visibleRowValues(rows).filter((value) => message.includes(value));
  if (matchedValues.length < 2) {
    return { accepted: false, matchedValues, citations };
  }

  const citationText = normalized(citations.join('；'));
  const citationGrounded = matchedValues.some((value) => citationText.includes(value));
  return {
    accepted: citationGrounded,
    matchedValues,
    citations,
  };
}
