import { createHash } from 'crypto';
import type { StyleFamily } from '@/app/lib/stylePolicy';
import { STYLE_FAMILIES } from '@/app/lib/stylePolicy';

export const DEPLOYMENT_GATE_VERSION = 'deployment-gate-v1';

export interface GateEvaluationRun {
  id: string;
  modelATag: string;
  modelBTag: string;
  styleFamily: string | null;
  summary: { scenario?: Record<string, number> };
}

export function stableRolloutBucket(value: string): number {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) % 100;
}

export function chooseRolloutModel(input: {
  stableKey: string;
  rolloutPercent: number;
  candidateModelId: string;
  previousModelId: string | null;
}) {
  if (!input.previousModelId || input.rolloutPercent >= 100) return input.candidateModelId;
  return stableRolloutBucket(input.stableKey) < input.rolloutPercent
    ? input.candidateModelId
    : input.previousModelId;
}

export function evaluateDeploymentGate(input: {
  candidateTag: string;
  runs: GateEvaluationRun[];
  trainingReady: boolean;
}) {
  const byStyle = Object.fromEntries(STYLE_FAMILIES.map((style) => [style, { wins: 0, losses: 0, ties: 0, inconsistent: 0, runs: 0 }])) as Record<StyleFamily, { wins: number; losses: number; ties: number; inconsistent: number; runs: number }>;
  for (const run of input.runs) {
    if (!run.styleFamily || !STYLE_FAMILIES.includes(run.styleFamily as StyleFamily)) continue;
    const candidateIsA = run.modelATag === input.candidateTag;
    const candidateIsB = run.modelBTag === input.candidateTag;
    if (!candidateIsA && !candidateIsB) continue;
    const scenario = run.summary.scenario ?? {};
    const item = byStyle[run.styleFamily as StyleFamily];
    item.wins += scenario[candidateIsA ? 'A' : 'B'] ?? 0;
    item.losses += scenario[candidateIsA ? 'B' : 'A'] ?? 0;
    item.ties += scenario.tie ?? 0;
    item.inconsistent += scenario.inconsistent ?? 0;
    item.runs++;
  }

  const failures: string[] = [];
  if (!input.trainingReady) failures.push('TRAINING_LINEAGE_NOT_READY');
  for (const style of STYLE_FAMILIES) {
    const item = byStyle[style];
    const decisive = item.wins + item.losses;
    const total = decisive + item.ties + item.inconsistent;
    if (item.runs === 0 || decisive === 0) failures.push(`STYLE_MISSING:${style}`);
    else if (item.wins / decisive < 0.5) failures.push(`STYLE_REGRESSION:${style}`);
    if (total > 0 && item.inconsistent / total > 0.2) failures.push(`STYLE_INCONSISTENT:${style}`);
  }
  const aggregate = Object.values(byStyle).reduce((acc, item) => ({ wins: acc.wins + item.wins, losses: acc.losses + item.losses, ties: acc.ties + item.ties, inconsistent: acc.inconsistent + item.inconsistent }), { wins: 0, losses: 0, ties: 0, inconsistent: 0 });
  const decisive = aggregate.wins + aggregate.losses;
  if (decisive === 0) failures.push('NO_DECISIVE_EVALUATIONS');
  else if (aggregate.wins / decisive < 0.5) failures.push('OVERALL_REGRESSION');
  const missingOnly = failures.length > 0 && failures.every((failure) => failure.startsWith('STYLE_MISSING') || failure === 'NO_DECISIVE_EVALUATIONS');
  return {
    policyVersion: DEPLOYMENT_GATE_VERSION,
    result: failures.length === 0 ? 'PASS' : missingOnly ? 'INSUFFICIENT' : 'FAIL',
    failures,
    aggregate,
    byStyle,
  } as const;
}
