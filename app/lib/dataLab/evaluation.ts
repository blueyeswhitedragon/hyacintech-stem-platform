import { STYLE_FAMILIES, isStyleFamily, type StyleFamily } from '@/app/lib/stylePolicy';

interface CountSummary {
  A?: number;
  B?: number;
  tie?: number;
  inconsistent?: number;
}

export interface EvaluationStyleAggregate extends CountSummary {
  runs: number;
}

export function aggregateEvaluationsByStyle(
  runs: Array<{ styleFamily: string | null; summaryJson: string }>,
): Partial<Record<StyleFamily, EvaluationStyleAggregate>> {
  const result: Partial<Record<StyleFamily, EvaluationStyleAggregate>> = {};
  for (const run of runs) {
    if (!isStyleFamily(run.styleFamily)) continue;
    let scenario: CountSummary = {};
    try {
      const parsed = JSON.parse(run.summaryJson) as { scenario?: CountSummary };
      scenario = parsed.scenario ?? {};
    } catch {
      scenario = {};
    }
    const current = result[run.styleFamily] ?? { runs: 0, A: 0, B: 0, tie: 0, inconsistent: 0 };
    result[run.styleFamily] = {
      runs: current.runs + 1,
      A: (current.A ?? 0) + (scenario.A ?? 0),
      B: (current.B ?? 0) + (scenario.B ?? 0),
      tie: (current.tie ?? 0) + (scenario.tie ?? 0),
      inconsistent: (current.inconsistent ?? 0) + (scenario.inconsistent ?? 0),
    };
  }
  return Object.fromEntries(STYLE_FAMILIES.filter((family) => result[family]).map((family) => [family, result[family]]));
}
