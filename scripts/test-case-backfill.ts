#!/usr/bin/env tsx
import type { TopicCard } from '@prisma/client';
import {
  compileBackfillCases,
  compileOneCase,
  planBackfillSlots,
  type BackfillSourceCase,
} from '../app/lib/dataLab/bootstrap/caseCompiler';

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

function makeCard(id: string, subject: string, title: string): TopicCard {
  return {
    id,
    displayTitle: title,
    studentOpening: `我想研究${title}。`,
    internalArchetype: 'backfill-test',
    subject,
    gradeBand: '初中',
    coreMechanism: '结构影响结果',
    acceptableDirectionsJson: JSON.stringify([`${title}怎样影响结果？`, `${title}的第二个方向？`]),
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
  } as TopicCard;
}

const cards = [
  makeCard('card-a', 'engineering', '纸桥折叠结构'),
  makeCard('card-b', 'physics', '斜面角度'),
  makeCard('card-c', 'biology_ecology', '光照与发芽'),
  makeCard('card-hc', 'high_concept_interdisciplinary', '火星基地通风'),
];

function makeCase(overrides: Partial<BackfillSourceCase> & { id: string }): BackfillSourceCase {
  return {
    status: 'FINALIZED',
    phase: 1,
    revisionOfId: null,
    revision: 1,
    topicCardId: 'card-a',
    studentMessage: `占位消息-${overrides.id}`,
    privateReviewSpecJson: JSON.stringify({ challenge: '模糊输入' }),
    ...overrides,
  };
}

// 1. 只规划「已驳回且尚未补位」的案例
const slots = planBackfillSlots([
  makeCase({ id: 'ok-1' }),
  makeCase({ id: 'rej-1', status: 'CASE_REJECTED', phase: 2, privateReviewSpecJson: JSON.stringify({ challenge: '假设缺失' }) }),
  makeCase({ id: 'rej-2', status: 'CASE_REJECTED', phase: 1 }),
  makeCase({ id: 'rej-done', status: 'CASE_REJECTED', phase: 4 }),
  makeCase({ id: 'fix-1', status: 'READY', phase: 4, revisionOfId: 'rej-done', revision: 2 }),
]);
check(slots.length === 2, '只返回两条待补位案例（已补过的不再返回）');
check(slots.map((slot) => slot.rejectedCaseId).join(',') === 'rej-2,rej-1', '按阶段升序稳定排序');
check(slots[1].challenge === '假设缺失', '从 privateReviewSpec 还原考察点');

// 2/3/4. 替换案例保持阶段与考察点，但换卡且内容不同
const rejected = makeCase({ id: 'rej-x', status: 'CASE_REJECTED', phase: 2, topicCardId: 'card-a', privateReviewSpecJson: JSON.stringify({ challenge: '控制变量混乱' }) });
const originals = compileOneCase({ card: cards[0], phase: 2, challenge: '控制变量混乱', variant: 0, split: 'PILOT', promptVersion: 'tutor-language-prompt-v2.3' });
const batch = [makeCase({ ...rejected, studentMessage: originals.studentMessage })];
const replacements = compileBackfillCases(
  cards,
  planBackfillSlots(batch),
  {
    cardKeys: new Set(batch.map((item) => `${item.phase}|控制变量混乱|${item.topicCardId}`)),
    studentMessages: new Set(batch.map((item) => item.studentMessage)),
  },
  'PILOT',
  'tutor-language-prompt-v2.3',
);
check(replacements.length === 1 && replacements[0].rejectedCaseId === 'rej-x', '每个槽位产出一条替换案例并指回被驳回案例');
check(replacements[0].phase === 2 && replacements[0].challenge === '控制变量混乱', '阶段与考察点保持不变');
check(replacements[0].triggerType === originals.triggerType, 'triggerType 不变（结构覆盖格不变）');
check(
  JSON.stringify((replacements[0].visibleFacts as { allowedFocusIds: string[] }).allowedFocusIds)
    === JSON.stringify((originals.visibleFacts as { allowedFocusIds: string[] }).allowedFocusIds),
  'allowedFocusIds 不变',
);
check(replacements[0].topicCardId !== 'card-a', '替换案例换用了另一张话题卡');
check(replacements[0].studentMessage !== originals.studentMessage, '替换案例的学生消息与被驳回案例不同');

// 5. 同一次调用补两条同阶段同考察点 → 互不相同
const twoSlots = planBackfillSlots([
  makeCase({ id: 'rej-p1', status: 'CASE_REJECTED', phase: 2, topicCardId: 'card-a', privateReviewSpecJson: JSON.stringify({ challenge: '控制变量混乱' }) }),
  makeCase({ id: 'rej-p2', status: 'CASE_REJECTED', phase: 2, topicCardId: 'card-b', privateReviewSpecJson: JSON.stringify({ challenge: '控制变量混乱' }) }),
]);
const two = compileBackfillCases(cards, twoSlots, {
  cardKeys: new Set(['2|控制变量混乱|card-a', '2|控制变量混乱|card-b']),
  studentMessages: new Set<string>(),
}, 'PILOT', 'tutor-language-prompt-v2.3');
check(two.length === 2 && two[0].topicCardId !== two[1].topicCardId, '同一次补位的两条案例使用不同话题卡');
check(two[0].studentMessage !== two[1].studentMessage, '同一次补位的两条案例内容不同');
check(!two.some((item) => ['card-a', 'card-b'].includes(item.topicCardId)), '不会重用批次里已占用的话题卡');

// 6. 高概念代理仍来自高概念卡
const highConcept = compileBackfillCases(cards, planBackfillSlots([
  makeCase({ id: 'rej-hc', status: 'CASE_REJECTED', phase: 1, topicCardId: 'card-a', privateReviewSpecJson: JSON.stringify({ challenge: '高概念代理' }) }),
]), { cardKeys: new Set<string>(), studentMessages: new Set<string>() }, 'PILOT', 'tutor-language-prompt-v2.3');
check(highConcept[0].topicCardId === 'card-hc', '高概念代理的替换仍来自高概念跨学科话题卡');

// 7. 学生开场白与话题卡无关（P5 这类固定话术）时，退回「话题卡组合没用过」而不是报错
const fixedWordingSlots = planBackfillSlots([
  makeCase({ id: 'rej-p5', status: 'CASE_REJECTED', phase: 5, topicCardId: 'card-a', privateReviewSpecJson: JSON.stringify({ challenge: '局限讨论缺失' }) }),
]);
const p5Message = compileOneCase({ card: cards[0], phase: 5, challenge: '局限讨论缺失', variant: 0, split: 'PILOT', promptVersion: 'tutor-language-prompt-v2.3' }).studentMessage;
const p5Other = compileOneCase({ card: cards[1], phase: 5, challenge: '局限讨论缺失', variant: 0, split: 'PILOT', promptVersion: 'tutor-language-prompt-v2.3' }).studentMessage;
check(p5Message === p5Other, 'P5「局限讨论缺失」的学生开场白确实与话题卡无关（前置事实）');
const fixedWording = compileBackfillCases(cards, fixedWordingSlots, {
  cardKeys: new Set(['5|局限讨论缺失|card-a']),
  studentMessages: new Set([p5Message]),
}, 'PILOT', 'tutor-language-prompt-v2.3');
check(fixedWording.length === 1 && fixedWording[0].topicCardId !== 'card-a', '固定话术考察点仍换到新的话题卡而不是报错');
check(fixedWording[0].phase === 5 && fixedWording[0].challenge === '局限讨论缺失', '固定话术考察点的阶段与考察点不变');

// 8. 话题卡组合全部用尽 → 中文报错，不产出重复案例
let exhaustedMessage = '';
try {
  compileBackfillCases([cards[3]], planBackfillSlots([
    makeCase({ id: 'rej-only', status: 'CASE_REJECTED', phase: 1, topicCardId: 'card-hc', privateReviewSpecJson: JSON.stringify({ challenge: '高概念代理' }) }),
  ]), {
    cardKeys: new Set(['1|高概念代理|card-hc', '1|高概念代理|card-hc|v1', '1|高概念代理|card-hc|v2', '1|高概念代理|card-hc|v3']),
    studentMessages: new Set<string>(),
  }, 'PILOT', 'tutor-language-prompt-v2.3');
} catch (error) {
  exhaustedMessage = error instanceof Error ? error.message : String(error);
}
check(exhaustedMessage.includes('话题卡') && exhaustedMessage.includes('第 1 阶段'), '话题卡组合用尽时抛出可读中文错误');

// 8. 老案例缺少 challenge 字段时回退到该阶段第一个考察点
const legacySlots = planBackfillSlots([
  makeCase({ id: 'rej-legacy', status: 'CASE_REJECTED', phase: 3, privateReviewSpecJson: '{}' }),
]);
check(legacySlots[0].challenge === '首次进入', 'privateReviewSpec 缺少 challenge 时回退到该阶段第一个考察点');

console.log(`\nCase backfill tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
