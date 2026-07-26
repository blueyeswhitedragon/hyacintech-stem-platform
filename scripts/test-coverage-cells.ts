#!/usr/bin/env tsx
import type { TopicCard } from '@prisma/client';
import {
  compileCases,
  EVAL_CASE_COUNTS,
  expectedCoverageCells,
  TRIAL_CASE_COUNTS,
  type CoverageCell,
} from '../app/lib/dataLab/bootstrap/caseCompiler';
import { isSystemTriggeredTurn } from '../app/lib/stageContract';
import {
  DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION,
  interactionToAction,
  TUTOR_INTERACTION_TYPES,
} from '../app/lib/tutorLanguage';

let passed = 0;
let failed = 0;

function check(condition: unknown, label: string) {
  if (condition) {
    passed += 1;
    console.log(`✓ ${label}`);
  } else {
    failed += 1;
    console.error(`✗ ${label}`);
  }
}

function cellKey(cell: CoverageCell) {
  return JSON.stringify([cell.phase, cell.triggerType, cell.focus]);
}

const card: TopicCard = {
  id: 'coverage-topic',
  displayTitle: '比较纸桥结构与承重',
  studentOpening: '我想知道纸桥怎样搭得更稳。',
  internalArchetype: 'coverage-test',
  subject: 'engineering',
  gradeBand: '初中',
  coreMechanism: '结构影响承重',
  acceptableDirectionsJson: JSON.stringify(['不同折叠结构怎样影响承重？', '桥面层数怎样影响承重？']),
  forbiddenDirectionsJson: '[]',
  curriculumAnchorsJson: JSON.stringify(['结构与功能']),
  sourceJson: '{}',
  compilerEvidenceJson: '{}',
  schemaVersion: 1,
  revision: 1,
  revisionOfId: null,
  activityMode: '',
  contextModule: '',
  disciplineAnchorsJson: '[]',
  authenticNeed: '',
  stakeholder: '',
  engineeringGoal: '',
  constraintsJson: '[]',
  performanceCriteriaJson: '[]',
  inquiryBridgesJson: '[]',
  sourceCandidateId: null,
  status: 'APPROVED',
  rejectionReason: '',
  createdById: null,
  approvedById: null,
  approvedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const trialCells = expectedCoverageCells(TRIAL_CASE_COUNTS);
check(
  JSON.stringify([...new Set(trialCells.map((cell) => cell.phase))]) === JSON.stringify([1, 2, 3, 4, 5, 6]),
  'TRIAL_36 覆盖全部六阶段',
);
for (const triggerType of ['STAGE_ENTER', 'STAGE_TRANSITION', 'REPORT_BOOTSTRAP']) {
  check(trialCells.some((cell) => cell.triggerType === triggerType), `TRIAL_36 包含 ${triggerType}`);
}

const expectedFocuses = [
  'research_question',
  'direction_confirmation',
  'variable_design',
  'data_recording',
  'experiment_process',
  'expected_result',
  'plan_confirmation',
  'safety_checkpoint',
  'cite_evidence',
  'interpret_evidence',
  'report_handoff',
  'report_gap',
  'reflection_coaching',
];
const evalFocuses = new Set(expectedCoverageCells(EVAL_CASE_COUNTS).map((cell) => cell.focus));
check(expectedFocuses.every((focus) => evalFocuses.has(focus)), 'EVAL_80 覆盖 allowedFocus 的全部 13 个值');

for (const counts of [TRIAL_CASE_COUNTS, EVAL_CASE_COUNTS]) {
  const declared = expectedCoverageCells(counts).map(cellKey).sort();
  const compiled = compileCases([card], counts, 'EVAL', DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION);
  const actual = [...new Set(compiled.flatMap((item) => {
    const focusIds = (item.visibleFacts as { allowedFocusIds?: string[] }).allowedFocusIds ?? [];
    return focusIds.map((focus) => cellKey({ phase: item.phase, triggerType: item.triggerType, focus }));
  }))].sort();
  check(JSON.stringify(declared) === JSON.stringify(actual), `声明覆盖格与 ${Object.values(counts).reduce((sum, count) => sum + count, 0)} 条编译产物逐格相等`);
}

for (const triggerType of ['STAGE_ENTER', 'STAGE_TRANSITION', 'REPORT_BOOTSTRAP', 'SYSTEM_TRIGGER']) {
  check(isSystemTriggeredTurn(triggerType), `${triggerType} 判定为系统触发`);
}
for (const triggerType of ['USER_MESSAGE', 'TEACHER_APPROVAL', '', 'STAGE_ENTERED']) {
  check(!isSystemTriggeredTurn(triggerType), `${triggerType || '空串'} 不会误判为系统触发`);
}

check(interactionToAction('checkpoint', { serverSilent: true }) === 'text_input', '服务器静默时模型 checkpoint 回落为文本输入');
check(interactionToAction('checkpoint', { serverSilent: false }) === 'confirmation', '服务器声明检查点时 checkpoint 仍映射为确认按钮');
for (const interactionType of TUTOR_INTERACTION_TYPES.filter((type) => type !== 'checkpoint')) {
  check(
    interactionToAction(interactionType, { serverSilent: true }) === interactionToAction(interactionType, { serverSilent: false }),
    `${interactionType} 不受 serverSilent 影响`,
  );
}

console.log(`\nCoverage cell tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
