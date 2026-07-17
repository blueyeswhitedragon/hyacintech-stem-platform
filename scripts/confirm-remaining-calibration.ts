#!/usr/bin/env tsx
import './load-script-env';
import { db } from '../app/lib/db';
import type { SessionUser } from '../app/lib/session';
import { claimTutorReviewTask, submitConfirmReview } from '../app/lib/dataLab/bootstrap/service';

const RUN_ID = '013a6d35-b1f6-4a3c-aa07-0e251054bbcf';

async function main() {
  const reviewerRow = await db.user.findFirst({ where: { username: 'reviewer1', role: 'reviewer', isActive: true } });
  if (!reviewerRow) throw new Error('reviewer1 不可用');
  const user: SessionUser = { id: reviewerRow.id, username: reviewerRow.username, displayName: reviewerRow.displayName, role: 'reviewer' };
  const payload = await claimTutorReviewTask('CONFIRM', user);
  if (!payload) throw new Error('没有可领取的最终确认任务');
  const caseRow = await db.tutorTurnCase.findUniqueOrThrow({ where: { id: payload.case.id } });
  const challenge = (JSON.parse(caseRow.privateReviewSpecJson) as { challenge?: string }).challenge;
  if (caseRow.generationRunId !== RUN_ID || challenge !== '高概念代理') throw new Error(`领取到意外案例：${caseRow.generationRunId}/${challenge}`);

  const warningClosures = Object.fromEntries(payload.warnings.map((warning) => [warning.id, warning.source === 'CRITIC'
    ? {
        validity: 'PARTIALLY_VALID',
        finalRelation: 'ONLY_UNSELECTED_CANDIDATE',
        severity: 'MINOR',
        note: 'Critic 指出候选 B 主动给了叶片数量指标，这对学生选择有一定影响；但只有一个示例，并非完整指标菜单，且该片段未进入最终草稿。',
      }
    : {
        validity: 'VALID',
        finalRelation: 'ONLY_UNSELECTED_CANDIDATE',
        severity: 'MINOR',
        note: '候选 B 确有两个问句并追加了具体指标确认，但只存在于未采用候选；最终草稿只有一个开放聚焦问题。',
      }]));

  const result = await submitConfirmReview({
    taskId: payload.task.id,
    decision: 'CONFIRM',
    reason: 'AI_ASSISTED_SECOND_REVIEW：由 Codex 在用户明确授权下代办，不冒充独立人工判断；扩容前仍需团队结合本记录复盘。最终草稿没有提供观察指标菜单，只要求学生自己说明想观察的变化，符合 research_question 的单任务边界。',
    warningClosures,
    user,
  });
  console.log(JSON.stringify({ caseId: caseRow.id, challenge, warnings: payload.warnings.length, status: result.status }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
