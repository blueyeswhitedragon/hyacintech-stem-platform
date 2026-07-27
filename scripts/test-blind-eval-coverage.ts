#!/usr/bin/env tsx
/**
 * blind-eval 结构覆盖闭环：采集端能否驱动全部覆盖格、判定端汇总能否过产物校验与部署门禁。
 * 全部使用手写 TurnRecord / verdict，不调用任何模型。
 */
import { EVAL_CASE_COUNTS, expectedCoverageCells } from '../app/lib/dataLab/bootstrap/caseCompiler';
import { validateEvaluationArtifacts } from '../app/lib/dataLab/evaluationArtifacts';
import { evaluateDeploymentGate } from '../app/lib/deploymentGate';
import { modelTrainingReady } from '../app/lib/deployment';
import { planCoverageTurns, missingCoverageCells, coverageCellKey } from './lib/coverage-driver';
import {
  structuralSummary,
  type SummaryScenario,
  type SummaryVerdict,
  type StructuralCountSummary,
} from './lib/structural-summary';

let passed = 0;
let failed = 0;

function check(condition: unknown, label: string) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

const CELLS = expectedCoverageCells(EVAL_CASE_COUNTS);
const EXPECTED_TRIGGERS = [...new Set(CELLS.map((cell) => cell.triggerType))];
const EXPECTED_FOCUSES = [...new Set(CELLS.map((cell) => cell.focus))];
const COUNT_FIELDS = ['A', 'B', 'tie', 'inconsistent', 'criticalErrors'] as const;

// 1. 采集端：覆盖驱动为每一格产出一个可执行回合
const plans = planCoverageTurns();
check(plans.length === CELLS.length, `覆盖驱动产出 ${CELLS.length} 个回合计划（实得 ${plans.length}）`);
check(missingCoverageCells(plans).length === 0, '覆盖驱动不缺任何期望格');
check(
  plans.every((plan) => (plan.triggerType === 'USER_MESSAGE' ? plan.studentMessage.length > 0 : plan.studentMessage === '')),
  '系统触发格学生消息为空、学生触发格必有消息',
);
check(new Set(plans.map((plan) => plan.key)).size === plans.length, '每格的 key 唯一');

// 2. 判定端：把覆盖回合当成一次 A/B 采集，逐格聚合
function scenariosFrom(side: 'A' | 'B'): SummaryScenario[] {
  const byPhase = new Map<number, SummaryScenario>();
  for (const plan of plans) {
    const id = `coverage-p${plan.phase}`;
    const scenario = byPhase.get(plan.phase) ?? { id, turns: [] };
    scenario.turns.push({
      id: `${id}:${side}:${plan.key}`,
      phase: plan.phase,
      parseOk: true,
      violations: [],
      triggerType: plan.triggerType,
      focus: plan.focus,
    });
    byPhase.set(plan.phase, scenario);
  }
  return [...byPhase.values()];
}

const scenariosA = scenariosFrom('A');
const scenariosB = scenariosFrom('B');
// 候选是 B：逐轮裁决全部判 B 胜，形成一份能过非退化判定的 verdict。
const turnVerdicts: SummaryVerdict[] = scenariosB.flatMap((scenario) => scenario.turns)
  .map((turn) => ({ id: turn.id, winner: 'B' as const, inconsistent: false }));
const scenarioVerdicts: SummaryVerdict[] = scenariosB.map((scenario) => ({ id: scenario.id, winner: 'B' as const, inconsistent: false }));

const trigger = structuralSummary('triggerType', EXPECTED_TRIGGERS, scenarioVerdicts, turnVerdicts, scenariosA, scenariosB);
const focus = structuralSummary('focus', EXPECTED_FOCUSES, scenarioVerdicts, turnVerdicts, scenariosA, scenariosB);

check(
  [...EXPECTED_TRIGGERS].sort().join(',') === Object.keys(trigger).sort().join(','),
  `summary.trigger 键集合等于门禁期望的 ${EXPECTED_TRIGGERS.length} 个触发类型`,
);
check(
  [...EXPECTED_FOCUSES].sort().join(',') === Object.keys(focus).sort().join(','),
  `summary.focus 键集合等于门禁期望的 ${EXPECTED_FOCUSES.length} 个 focus`,
);

function bucketsComplete(buckets: Record<string, StructuralCountSummary>) {
  return Object.values(buckets).every((bucket) => COUNT_FIELDS.every((field) => typeof bucket[field] === 'number'));
}
check(bucketsComplete(trigger) && bucketsComplete(focus), '每个桶都含 A/B/tie/inconsistent/criticalErrors 五个数字字段');
check(
  Object.values(trigger).every((bucket) => bucket.A + bucket.B + bucket.tie + bucket.inconsistent > 0)
  && Object.values(focus).every((bucket) => bucket.A + bucket.B + bucket.tie + bucket.inconsistent > 0),
  '没有任何空桶（空桶会让门禁判 INSUFFICIENT）',
);

// 3. 产物校验：不再出现 TRIGGER_SUMMARY_INCOMPLETE / FOCUS_SUMMARY_INCOMPLETE
const phase = Object.fromEntries([1, 2, 3, 4, 5, 6].map((value) => [
  `P${value}`,
  { A: 0, B: 2, tie: 0, inconsistent: 0, criticalErrors: 0, parseSuccessA: 10, parseTotalA: 10, parseSuccessB: 10, parseTotalB: 10 },
]));
const summary = { phase, trigger, focus, criticalErrors: 0 };
const scenarioIdList = scenariosB.map((scenario) => ({ id: scenario.id, turns: scenario.turns.map(() => ({ scenarioId: scenario.id })) }));
const validation = validateEvaluationArtifacts({
  verdict: { tag: 'verdict', tags: { A: 'base:v1', B: 'candidate:v1' }, summary, scenarioVerdicts: scenarioIdList },
  transcripts: [
    { tag: 'base:v1', scenarios: scenarioIdList },
    { tag: 'candidate:v1', scenarios: scenarioIdList },
  ],
  expectedTags: { A: 'base:v1', B: 'candidate:v1' },
});
const codes = validation.diagnostics.map((item) => item.code);
check(!codes.includes('TRIGGER_SUMMARY_INCOMPLETE'), '产物校验不再报 TRIGGER_SUMMARY_INCOMPLETE');
check(!codes.includes('FOCUS_SUMMARY_INCOMPLETE'), '产物校验不再报 FOCUS_SUMMARY_INCOMPLETE');
check(!codes.includes('PHASE_SUMMARY_INCOMPLETE') && !codes.includes('PARSE_METRICS_MISSING'), '逐阶段与解析指标齐全');

// 4. 部署门禁：同一份 summary 直接 PASS
const run = {
  id: 'coverage-run',
  modelATag: 'base:v1',
  modelBTag: 'candidate:v1',
  scope: 'all',
  summary: { ...summary, artifactValidation: { complete: true, invalidArtifacts: 0, scenarioIdsComplete: true, modelIdentitiesVerified: true } },
};
check(
  evaluateDeploymentGate({ candidateTag: 'candidate:v1', runs: [run], trainingReady: true }).result === 'PASS',
  '覆盖齐全且候选不退化时部署门禁 PASS',
);

// 5. 抽掉 STAGE_TRANSITION 一格 → INSUFFICIENT 且指名缺失触发类型
const gapTrigger = { ...trigger };
delete gapTrigger.STAGE_TRANSITION;
const gap = evaluateDeploymentGate({
  candidateTag: 'candidate:v1',
  runs: [{ ...run, summary: { ...run.summary, trigger: gapTrigger } }],
  trainingReady: true,
});
check(gap.result === 'INSUFFICIENT', '缺 STAGE_TRANSITION 格时门禁判 INSUFFICIENT');
check(gap.failures.includes('TRIGGER_MISSING:STAGE_TRANSITION'), '门禁指名缺失的触发类型');

// 6. missingCoverageCells 能报出真实缺口
const withoutTransition = plans.filter((plan) => plan.triggerType !== 'STAGE_TRANSITION');
const missing = missingCoverageCells(withoutTransition);
check(
  missing.length === CELLS.filter((cell) => cell.triggerType === 'STAGE_TRANSITION').length
  && missing.every((cell) => cell.triggerType === 'STAGE_TRANSITION'),
  'missingCoverageCells 精确报出被抽掉的 STAGE_TRANSITION 格',
);
check(coverageCellKey(CELLS[0]) === `${CELLS[0].phase}|${CELLS[0].triggerType}|${CELLS[0].focus}`, '覆盖格 key 形状稳定');

// 7. 外部微调产物：没有本平台 TrainingRun 也能满足训练血缘，前提是权重身份已核验
check(
  modelTrainingReady({ artifactKind: 'EXTERNAL', verificationStatus: 'VERIFIED_IDENTITY' }),
  'EXTERNAL + 身份已核验 → 训练血缘就绪',
);
check(
  !modelTrainingReady({ artifactKind: 'EXTERNAL', verificationStatus: 'EXTERNAL_ALIAS_UNVERIFIED' }),
  'EXTERNAL + 身份待核验 → 训练血缘不就绪',
);
check(
  modelTrainingReady({ artifactKind: 'BASE', verificationStatus: 'VERIFIED_IDENTITY' }),
  'BASE 规则不变',
);
check(
  !modelTrainingReady({ artifactKind: 'FINE_TUNED', verificationStatus: 'VERIFIED_IDENTITY' })
  && modelTrainingReady({ artifactKind: 'FINE_TUNED', verificationStatus: 'VERIFIED_IDENTITY', trainingRunStatus: 'SUCCEEDED', trainingReport: { blocked: 0, sftAllowed: 12 } }),
  '本平台训练产物仍要求成功的 TrainingRun 与无阻断资格报告',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
