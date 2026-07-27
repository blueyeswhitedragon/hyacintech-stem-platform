#!/usr/bin/env tsx
import { buildTrialReviewRows, trialReviewShareGpt, type TrialReviewInput } from '../app/lib/dataLab/bootstrap/trialExport';

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

const finalOutput = JSON.stringify({
  dialogue: '含逗号, 引号 " 和换行\n第二行',
  interactionType: 'open_question',
  focus: 'research_question',
  hints: ['提示一', '提示二'],
});

function caseInput(phase: number, triggerType: string, caseId: string, overrides: Partial<TrialReviewInput> = {}): TrialReviewInput {
  return {
    caseId,
    phase,
    triggerType,
    caseStatus: 'IN_REVIEW',
    topicTitle: `P${phase} 话题`,
    historyJson: JSON.stringify([{ role: 'user', content: `P${phase} 的历史学生消息` }]),
    studentMessage: `P${phase} 当前学生消息`,
    finalizedTurn: null,
    ...overrides,
  };
}

const input: TrialReviewInput[] = [
  caseInput(4, 'USER_MESSAGE', 'case-p4-bad-json', {
    finalizedTurn: {
      finalOutputJson: '{',
      reviewerEditMetricsJson: '{}',
      trainingEligibility: 'BLOCKED',
      eligibilityReasonJson: '[]',
      contentSha256: 'bad-json-hash',
    },
  }),
  caseInput(1, 'STAGE_TRANSITION', 'case-p1-transition'),
  caseInput(2, 'USER_MESSAGE', 'case-p2-unfinalized', { studentMessage: '完整学生消息\n第二行仍需保留' }),
  caseInput(1, 'STAGE_ENTER', 'case-p1-enter', {
    finalizedTurn: {
      finalOutputJson: finalOutput,
      reviewerEditMetricsJson: JSON.stringify({ type: 'NO_CHANGE' }),
      trainingEligibility: 'SFT_ALLOWED',
      eligibilityReasonJson: JSON.stringify(['NONE']),
      contentSha256: 'finalized-hash',
    },
    directConfirmed: true,
  }),
  caseInput(3, 'USER_MESSAGE', 'case-p3'),
  caseInput(5, 'REPORT_BOOTSTRAP', 'case-p5'),
  caseInput(6, 'USER_MESSAGE', 'case-p6'),
];

const rows = buildTrialReviewRows(input);
const json = trialReviewShareGpt(rows, {
  runId: '8cad55b9-0000-0000-0000-000000000000',
  distributionCurrent: true,
  metrics: { total: 36, directConfirmRate: 0 },
  failures: ['TRIAL_REQUIRES_36_CASES'],
});
const records = JSON.parse(json) as Array<{
  phase: number;
  conversations: Array<{ from: string; value: string }>;
  meta: {
    schemaVersion: number;
    sourceKind: string;
    trialReview: {
      caseId: string;
      batch: { runId: string; failures: Array<{ code: string; label: string }> };
      triggerType: { display: string };
      tutorOutput: { dialogue: string; hints: string[] };
      directConfirmed: boolean | null;
      finalized: boolean;
      studentMessage: string;
    };
  };
}>;

check(rows.map((row) => row.caseId).join(',') === 'case-p1-enter,case-p1-transition,case-p2-unfinalized,case-p3,case-p4-bad-json,case-p5,case-p6', '按阶段、触发类型和案例 id 稳定排序');

const unfinalized = records.find((record) => record.meta.trialReview.caseId === 'case-p2-unfinalized');
check(
  Boolean(unfinalized)
    && unfinalized?.meta.trialReview.studentMessage === '完整学生消息\n第二行仍需保留'
    && unfinalized?.meta.trialReview.directConfirmed === null
    && unfinalized?.meta.trialReview.finalized === false
    && !unfinalized?.conversations.some((turn) => turn.from === 'gpt'),
  '未定稿 IN_REVIEW 案例仍导出，学生消息完整且没有伪造导师回复',
);

const finalized = records.find((record) => record.meta.trialReview.caseId === 'case-p1-enter');
check(
  Boolean(finalized)
    && finalized?.meta.trialReview.tutorOutput.dialogue === '含逗号, 引号 " 和换行\n第二行'
    && finalized?.conversations.at(-1)?.value === finalOutput,
  '导师回复中的逗号、引号和换行可经 ShareGPT JSON 往返保留',
);

check(json.startsWith('[\n') && records.every((record) => record.meta.schemaVersion === 4 && record.meta.sourceKind === 'trial_36_review'), '导出是正式 180 同形的 ShareGPT JSON 数组，不使用 CSV BOM');
check(finalized?.meta.trialReview.triggerType.display === 'STAGE_ENTER（阶段首次进入）', '触发类型同时导出代码值与中文名称');
check(!json.includes('undefined') && rows.every((row) => Array.isArray(row.hints) && Array.isArray(row.eligibilityReasons)), '空提示和阻断原因不会导出 undefined');

const badJson = records.find((record) => record.meta.trialReview.caseId === 'case-p4-bad-json');
check(Boolean(badJson) && badJson?.meta.trialReview.tutorOutput.dialogue === '' && !badJson?.conversations.some((turn) => turn.from === 'gpt'), '坏的 finalOutputJson 被容错为空回复且不影响整批导出');
check(new Set(rows.map((row) => row.phase)).size === 6 && [1, 2, 3, 4, 5, 6].every((phase) => rows.some((row) => row.phase === phase)), '六个阶段均可在复盘导出中查询');
check(
  finalized?.meta.trialReview.batch.runId === '8cad55b9-0000-0000-0000-000000000000'
    && finalized?.meta.trialReview.batch.failures[0]?.code === 'TRIAL_REQUIRES_36_CASES',
  '每条记录携带批次、配比和门禁失败项上下文',
);

console.log(`\nTrial review export tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
