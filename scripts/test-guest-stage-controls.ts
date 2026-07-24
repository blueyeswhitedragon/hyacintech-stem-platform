#!/usr/bin/env tsx
import { POST as confirmStage2Plan } from '../app/api/guest/confirm-stage2-plan/route';
import { POST as submitSafetyQuiz } from '../app/api/guest/safety-quiz/route';
import { _resetRateLimit } from '../app/lib/guestRateLimit';
import { deterministicSafetyQuiz } from '../app/lib/serverTutorState';
import { stage2DraftHash } from '../app/lib/stageState';
import type { Stage2ExperimentPlan, StageData } from '../app/models/stageData';

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

function request(path: string, body: unknown, ip: string) {
  return new Request(`http://guest.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

async function main() {
  _resetRateLimit();
  const plan: Stage2ExperimentPlan = {
    researchQuestion: '光照时长如何影响绿豆苗株高？',
    hypothesis: '光照时长改变后，绿豆苗株高会出现差异。',
    independentVariable: { name: '每天光照时长', levels: ['4小时', '8小时'] },
    dependentVariable: { name: '绿豆苗株高', measurement: '第5天用直尺测量株高', unit: 'cm' },
    controlledVariables: ['绿豆品种', '水量'],
    materials: ['绿豆种子', '花盆', '直尺'],
    procedure: ['设置两种光照时长', '每天保持相同水量', '第5天测量株高'],
    repeatCount: 3,
    safetyNotes: ['发现霉变时停止操作并告知教师'],
  };
  const draftHash = stage2DraftHash(plan);
  const draftState: StageData = {
    stage2: {
      submitted: false,
      approved: null,
      planDraft: plan,
      draftHash,
      schema: { columns: [], minRows: 3, maxRows: 200 },
    },
  };

  const stale = await confirmStage2Plan(request(
    '/api/guest/confirm-stage2-plan',
    { stageData: draftState, draftHash: 'stale-hash' },
    '198.51.100.1',
  ));
  check(stale.status === 409, 'Guest 方案确认拒绝不匹配的草案哈希');

  const confirmedResponse = await confirmStage2Plan(request(
    '/api/guest/confirm-stage2-plan',
    { stageData: draftState, draftHash },
    '198.51.100.2',
  ));
  const confirmed = await confirmedResponse.json() as { stageData: StageData; currentStage: number; safetyQuiz: { question: string; options: string[] } };
  check(
    confirmedResponse.status === 200
      && confirmed.stageData.stage2?.confirmedPlanHash === draftHash
      && confirmed.stageData.stage2?.experimentPlan?.repeatCount === 3,
    'Guest 仅冻结哈希匹配的当前方案',
  );
  check(
    (confirmed.stageData.stage2?.schema.columns.length ?? 0) > 0
      && Array.isArray(confirmed.stageData.stage2?.aiRiskAnnotations),
    'Guest 方案确认由服务器派生数据表与风险',
  );
  check(
    confirmed.currentStage === 3
      && confirmed.safetyQuiz.options.length >= 2
      && confirmed.stageData.stage3?.safetyQuiz?.passed === false
      && !JSON.stringify(confirmed).includes('"correct"'),
    'Guest 一次确认原子进入阶段3并初始化不泄露答案的安全题',
  );

  const quizResponse = await submitSafetyQuiz(request(
    '/api/guest/safety-quiz',
    { stageData: confirmed.stageData },
    '198.51.100.3',
  ));
  const quizPayload = await quizResponse.json() as {
    stageData: StageData;
    safetyQuiz: { question: string; options: string[]; correct?: number };
  };
  check(
    quizResponse.status === 200
      && quizPayload.safetyQuiz.options.length >= 2
      && !Object.hasOwn(quizPayload.safetyQuiz, 'correct')
      && !Object.hasOwn(quizPayload.stageData.stage3?.safetyQuiz ?? {}, 'correct'),
    'Guest 安全题响应不泄露答案键',
  );

  const expected = deterministicSafetyQuiz(confirmed.stageData).correct;
  const wrongAnswer = (expected + 1) % quizPayload.safetyQuiz.options.length;
  const wrong = await submitSafetyQuiz(request(
    '/api/guest/safety-quiz',
    { stageData: confirmed.stageData, answer: wrongAnswer },
    '198.51.100.4',
  ));
  check(wrong.status === 400, 'Guest 安全题错答由服务器拒绝');

  const passedResponse = await submitSafetyQuiz(request(
    '/api/guest/safety-quiz',
    { stageData: confirmed.stageData, answer: expected },
    '198.51.100.5',
  ));
  const passedPayload = await passedResponse.json() as { stageData: StageData };
  check(
    passedResponse.status === 200
      && passedPayload.stageData.stage3?.safetyQuiz?.passed === true
      && passedPayload.stageData.stage3.safetyQuiz.selected === expected
      && !JSON.stringify(passedPayload).includes('"correct"'),
    'Guest 安全题正确答案通过且持久状态仍不含答案键',
  );

  _resetRateLimit();
  console.log(`\nGuest stage control tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
