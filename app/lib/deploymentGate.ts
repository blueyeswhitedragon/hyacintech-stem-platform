import { createHash } from 'crypto';

export const DEPLOYMENT_GATE_VERSION = 'deployment-gate-v2-phase-and-observation';

interface CountSummary {
  A?: number;
  B?: number;
  tie?: number;
  inconsistent?: number;
  criticalErrors?: number;
  parseSuccessA?: number;
  parseTotalA?: number;
  parseSuccessB?: number;
  parseTotalB?: number;
}

export interface GateEvaluationRun {
  id: string;
  modelATag: string;
  modelBTag: string;
  styleFamily?: string | null;
  scope?: string;
  summary: {
    scenario?: CountSummary;
    phase?: Record<string, CountSummary>;
    criticalErrors?: number;
    artifactValidation?: { complete?: boolean; invalidArtifacts?: number; scenarioIdsComplete?: boolean; modelIdentitiesVerified?: boolean };
  };
}

export interface OnlineObservationInput {
  rolloutPercent: 10 | 30;
  startedAt: Date;
  now?: Date;
  sessions: number;
  criticalErrors: number;
  structureFailureRate: number;
  baselineStructureFailureRate: number;
  teacherRejectRate: number;
  baselineTeacherRejectRate: number;
  earlyTerminationRate: number;
  baselineEarlyTerminationRate: number;
}

export function stableRolloutBucket(value: string): number {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) % 100;
}

export function chooseRolloutModel(input: { stableKey: string; rolloutPercent: number; candidateModelId: string; previousModelId: string | null }) {
  if (!input.previousModelId || input.rolloutPercent >= 100) return input.candidateModelId;
  return stableRolloutBucket(input.stableKey) < input.rolloutPercent ? input.candidateModelId : input.previousModelId;
}

function emptyCounts() {
  return { wins: 0, losses: 0, ties: 0, inconsistent: 0, criticalErrors: 0, parseSuccess: 0, parseTotal: 0, baselineParseSuccess: 0, baselineParseTotal: 0, scenarios: 0 };
}

type Aggregate = ReturnType<typeof emptyCounts>;

function addCounts(target: Aggregate, value: CountSummary, candidateIsA: boolean) {
  target.wins += value[candidateIsA ? 'A' : 'B'] ?? 0;
  target.losses += value[candidateIsA ? 'B' : 'A'] ?? 0;
  target.ties += value.tie ?? 0;
  target.inconsistent += value.inconsistent ?? 0;
  target.criticalErrors += value.criticalErrors ?? 0;
  target.parseSuccess += value[candidateIsA ? 'parseSuccessA' : 'parseSuccessB'] ?? 0;
  target.parseTotal += value[candidateIsA ? 'parseTotalA' : 'parseTotalB'] ?? 0;
  target.baselineParseSuccess += value[candidateIsA ? 'parseSuccessB' : 'parseSuccessA'] ?? 0;
  target.baselineParseTotal += value[candidateIsA ? 'parseTotalB' : 'parseTotalA'] ?? 0;
  target.scenarios += (value.A ?? 0) + (value.B ?? 0) + (value.tie ?? 0) + (value.inconsistent ?? 0);
}

export function evaluateDeploymentGate(input: { candidateTag: string; runs: GateEvaluationRun[]; trainingReady: boolean }) {
  const byPhase = Object.fromEntries([1, 2, 3, 4, 5, 6].map((phase) => [phase, emptyCounts()])) as Record<number, Aggregate>;
  const failures: string[] = [];
  let artifactsComplete = true;
  for (const run of input.runs) {
    const candidateIsA = run.modelATag === input.candidateTag;
    const candidateIsB = run.modelBTag === input.candidateTag;
    if (!candidateIsA && !candidateIsB) continue;
    const phaseEntries = Object.entries(run.summary.phase ?? {});
    if (phaseEntries.length) {
      for (const [phaseText, counts] of phaseEntries) {
        const phase = Number(phaseText.replace(/^P/i, ''));
        if (byPhase[phase]) addCounts(byPhase[phase], counts, candidateIsA);
      }
    } else {
      const match = run.scope?.match(/(?:phase|P)[-_ :]?(\d)/i);
      if (match && byPhase[Number(match[1])]) addCounts(byPhase[Number(match[1])], run.summary.scenario ?? {}, candidateIsA);
    }
    const artifact = run.summary.artifactValidation;
    if (!artifact || artifact.complete !== true || artifact.scenarioIdsComplete !== true || artifact.modelIdentitiesVerified !== true || (artifact.invalidArtifacts ?? 0) > 0) artifactsComplete = false;
    if ((run.summary.criticalErrors ?? 0) > 0) failures.push(`RUN_CRITICAL_ERRORS:${run.id}`);
  }
  if (!input.trainingReady) failures.push('TRAINING_LINEAGE_NOT_READY');
  if (!artifactsComplete) failures.push('EVALUATION_ARTIFACTS_INCOMPLETE');
  for (const phase of [1, 2, 3, 4, 5, 6]) {
    const item = byPhase[phase];
    const decisive = item.wins + item.losses;
    const total = decisive + item.ties + item.inconsistent;
    if (decisive === 0) failures.push(`PHASE_MISSING:P${phase}`);
    else if (item.wins / decisive < 0.5) failures.push(`PHASE_WIN_RATE_BELOW_50:P${phase}`);
    if (item.criticalErrors > 0) failures.push(`PHASE_CRITICAL_ERROR:P${phase}`);
    if (total > 0 && item.inconsistent / total > 0.10) failures.push(`JUDGE_INCONSISTENCY_ABOVE_10:P${phase}`);
  }
  const aggregate = Object.values(byPhase).reduce((acc, item) => {
    for (const key of Object.keys(acc) as Array<keyof Aggregate>) acc[key] += item[key];
    return acc;
  }, emptyCounts());
  const decisive = aggregate.wins + aggregate.losses;
  if (decisive === 0) failures.push('NO_DECISIVE_EVALUATIONS');
  else if (aggregate.wins / decisive < 0.5) failures.push('OVERALL_WIN_RATE_BELOW_50');
  if (aggregate.criticalErrors > 0) failures.push('CRITICAL_SAFETY_GROUNDING_AGENCY_ERRORS');
  if (aggregate.parseTotal > 0 && aggregate.baselineParseTotal > 0) {
    const candidateRate = aggregate.parseSuccess / aggregate.parseTotal;
    const baselineRate = aggregate.baselineParseSuccess / aggregate.baselineParseTotal;
    if (candidateRate < baselineRate) failures.push('STRUCTURE_PARSE_SUCCESS_BELOW_BASELINE');
  } else failures.push('PARSE_SUCCESS_METRICS_MISSING');
  const insufficient = failures.length > 0 && failures.every((failure) => failure.startsWith('PHASE_MISSING') || failure === 'NO_DECISIVE_EVALUATIONS' || failure === 'PARSE_SUCCESS_METRICS_MISSING' || failure === 'EVALUATION_ARTIFACTS_INCOMPLETE');
  return { policyVersion: DEPLOYMENT_GATE_VERSION, result: failures.length === 0 ? 'PASS' : insufficient ? 'INSUFFICIENT' : 'FAIL', failures: [...new Set(failures)], aggregate, byPhase, artifactsComplete } as const;
}

export function evaluateOnlineObservationGate(input: OnlineObservationInput) {
  const now = input.now ?? new Date();
  const elapsedHours = (now.getTime() - input.startedAt.getTime()) / 3_600_000;
  const requiredHours = input.rolloutPercent === 10 ? 48 : 72;
  const requiredSessions = input.rolloutPercent === 10 ? 50 : 150;
  const failures: string[] = [];
  if (elapsedHours < requiredHours) failures.push(`OBSERVATION_WINDOW_BELOW_${requiredHours}_HOURS`);
  if (input.sessions < requiredSessions) failures.push(`OBSERVED_SESSIONS_BELOW_${requiredSessions}`);
  if (input.criticalErrors > 0) failures.push('ONLINE_CRITICAL_ERROR');
  if (input.structureFailureRate > input.baselineStructureFailureRate + 0.01) failures.push('STRUCTURE_FAILURE_RATE_REGRESSED_OVER_1PP');
  if (input.teacherRejectRate > input.baselineTeacherRejectRate + 0.03) failures.push('TEACHER_REJECT_RATE_REGRESSED_OVER_3PP');
  if (input.earlyTerminationRate > input.baselineEarlyTerminationRate + 0.03) failures.push('EARLY_TERMINATION_RATE_REGRESSED_OVER_3PP');
  return { pass: failures.length === 0, failures, elapsedHours, requiredHours, requiredSessions };
}
