#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import { db } from '../app/lib/db';
import type { SessionUser } from '../app/lib/session';
import {
  ExistingTutorCaseRunError,
  compileTutorTurnCases,
  createTopicCard,
  decideTopicCard,
  listTutorCases,
  minTopicCardRequirement,
  supersedeTutorCaseRun,
  tutorWorkflowCounts,
} from '../app/lib/dataLab/bootstrap/service';

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

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const adminRow = await db.user.create({
    data: { username: `case-generation-${suffix}`, passwordHash: 'x', role: 'admin', displayName: '案例批次测试管理员' },
  });
  const admin: SessionUser = { id: adminRow.id, username: adminRow.username, displayName: adminRow.displayName, role: 'admin' };

  const subjects = ['high_concept_interdisciplinary', 'engineering', 'biology_ecology', 'chemistry', 'physics'] as const;
  for (const [index, subject] of subjects.entries()) {
    const card = await createTopicCard({
      displayTitle: `校园环境观察 ${index + 1}`,
      studentOpening: `我发现校园里第 ${index + 1} 组现象的表现不同，想知道环境条件是否有影响。`,
      internalArchetype: `smoke-test-${index}`,
      subject,
      gradeBand: '初中',
      coreMechanism: '环境条件会影响植物的生长表现',
      acceptableDirections: ['比较不同光照下的生长表现', '比较不同水分条件下的生长表现'],
      forbiddenDirections: ['不使用破坏性实验'],
      curriculumAnchors: ['生物与环境'],
      source: { kind: 'TEST' },
    }, admin);
    await decideTopicCard(card.id, 'APPROVE', '', admin);
  }

  check(minTopicCardRequirement('SMOKE_6').total === 3, 'Smoke 6 使用独立的 3 张话题卡最低要求');
  check(minTopicCardRequirement('TRIAL_36').total === 10, 'Trial 36 使用独立的 10 张话题卡最低要求');

  const first = await compileTutorTurnCases({ profile: 'SMOKE_6', split: 'PILOT', user: admin });
  check(first.cases.length === 6, '首次编译生成 6 条 Smoke 案例');

  let duplicateBlocked = false;
  try {
    await compileTutorTurnCases({ profile: 'SMOKE_6', split: 'PILOT', user: admin });
  } catch (error) {
    duplicateBlocked = error instanceof ExistingTutorCaseRunError && error.existingRun.id === first.runId;
  }
  check(duplicateBlocked, '未确认时阻止重复创建同 profile 批次');

  const listed = await listTutorCases();
  const listedCase = listed.find((item) => item.generationRun?.id === first.runId);
  check(Boolean(listedCase && Object.hasOwn(listedCase, 'hardCheckJson')), '案例列表返回 hardCheckJson');
  check(Boolean(listedCase && !Object.hasOwn(listedCase, 'systemPrompt')), '案例列表不向客户端返回完整 system prompt');

  const superseded = await supersedeTutorCaseRun(first.runId, '集成测试清理旧批次', admin);
  const remaining = await db.tutorTurnCase.count({ where: { generationRunId: first.runId, status: { not: 'SUPERSEDED' } } });
  check(superseded.status === 'SUPERSEDED' && remaining === 0, 'supersede 同步标记 run 与案例状态');

  const replacement = await compileTutorTurnCases({ profile: 'SMOKE_6', split: 'PILOT', user: admin });
  check(replacement.runId !== first.runId, '旧 run 被替代后允许创建新的同 profile 批次');

  await compileTutorTurnCases({ profile: 'SMOKE_6', split: 'PILOT', allowExistingRun: true, user: admin });
  const workflow = await tutorWorkflowCounts();
  check(workflow.casesReady === 6, '全局待生成统计只计算标准 profile 的最新有效 run');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
