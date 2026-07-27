/**
 * 按 triggerType / focus 汇总裁决，供 blind-eval judge 与单测共用。
 *
 * 存在的理由：`evaluationArtifacts` 的 COUNT_FIELDS 要求 summary.trigger[*] / summary.focus[*]
 * 每个桶都带 A/B/tie/inconsistent/criticalErrors，缺一个字段就报 *_SUMMARY_INCOMPLETE；
 * 而 `evaluateDeploymentGate` 对缺格只会给 INSUFFICIENT。这里是唯一的一份聚合实现。
 */

export interface SummaryViolation {
  rule: string;
  detail?: string;
}

export interface SummaryTurn {
  id: string;
  phase: number;
  parseOk: boolean;
  violations: SummaryViolation[];
  triggerType: string;
  focus: string;
}

export interface SummaryScenario {
  id: string;
  turns: SummaryTurn[];
}

export interface SummaryVerdict {
  id: string;
  winner: 'A' | 'B' | 'tie';
  inconsistent: boolean;
}

export interface CountSummary {
  A: number;
  B: number;
  tie: number;
  inconsistent: number;
}

export interface StructuralCountSummary extends CountSummary {
  criticalErrors: number;
  parseSuccessA: number;
  parseTotalA: number;
  parseSuccessB: number;
  parseTotalB: number;
}

export function countSummary(verdicts: SummaryVerdict[]): CountSummary {
  return {
    A: verdicts.filter((verdict) => verdict.winner === 'A').length,
    B: verdicts.filter((verdict) => verdict.winner === 'B').length,
    tie: verdicts.filter((verdict) => verdict.winner === 'tie').length,
    inconsistent: verdicts.filter((verdict) => verdict.inconsistent).length,
  };
}

export function isCriticalViolation(rule: string): boolean {
  return /(?:safety|unsafe|ungrounded|grounding|agency)/i.test(rule);
}

/**
 * 按 triggerType / focus 汇总。裁决优先按轮次归属：一个回合的裁决记到该回合自己的覆盖格上；
 * 只跑场景级裁判时退回「该场景覆盖到的所有桶」，避免整列为空。
 * 桶的键由调用方从 expectedCoverageCells() 推出，保证键名与门禁一致、不会因无数据而消失。
 */
export function structuralSummary(
  dimension: 'triggerType' | 'focus',
  expectedKeys: string[],
  scenarioVerdicts: SummaryVerdict[],
  turnVerdicts: SummaryVerdict[],
  scenariosA: SummaryScenario[],
  scenariosB: SummaryScenario[],
): Record<string, StructuralCountSummary> {
  const turnsA = scenariosA.flatMap((scenario) => scenario.turns);
  const turnsB = scenariosB.flatMap((scenario) => scenario.turns);
  const keyOf = new Map<string, string>();
  for (const turn of [...turnsA, ...turnsB]) keyOf.set(turn.id, String(turn[dimension]));
  const scenarioKeys = new Map<string, Set<string>>();
  for (const scenario of [...scenariosA, ...scenariosB]) {
    const set = scenarioKeys.get(scenario.id) ?? new Set<string>();
    for (const turn of scenario.turns) set.add(String(turn[dimension]));
    scenarioKeys.set(scenario.id, set);
  }

  return Object.fromEntries(expectedKeys.map((key) => {
    const relevantTurnVerdicts = turnVerdicts.filter((verdict) => keyOf.get(verdict.id) === key);
    const verdicts = relevantTurnVerdicts.length
      ? relevantTurnVerdicts
      : scenarioVerdicts.filter((verdict) => scenarioKeys.get(verdict.id)?.has(key));
    const bucketA = turnsA.filter((turn) => String(turn[dimension]) === key);
    const bucketB = turnsB.filter((turn) => String(turn[dimension]) === key);
    const criticalErrors = [...bucketA, ...bucketB]
      .reduce((sum, turn) => sum + turn.violations.filter((violation) => isCriticalViolation(violation.rule)).length, 0);
    return [key, {
      ...countSummary(verdicts),
      criticalErrors,
      parseSuccessA: bucketA.filter((turn) => turn.parseOk).length,
      parseTotalA: bucketA.length,
      parseSuccessB: bucketB.filter((turn) => turn.parseOk).length,
      parseTotalB: bucketB.length,
    }];
  }));
}
