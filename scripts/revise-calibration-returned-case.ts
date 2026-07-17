#!/usr/bin/env tsx
import './load-script-env';
import { db } from '../app/lib/db';
import type { SessionUser } from '../app/lib/session';
import { claimTutorReviewTask, submitEditReview } from '../app/lib/dataLab/bootstrap/service';

const RUN_ID = '013a6d35-b1f6-4a3c-aa07-0e251054bbcf';

async function main() {
  const adminRow = await db.user.findFirst({ where: { username: 'data-admin', role: 'admin', isActive: true } });
  if (!adminRow) throw new Error('data-admin 不可用');
  const user: SessionUser = { id: adminRow.id, username: adminRow.username, displayName: adminRow.displayName, role: 'admin' };
  const payload = await claimTutorReviewTask('EDIT', user);
  if (!payload) throw new Error('没有可领取的退回首次审核任务');
  const caseRow = await db.tutorTurnCase.findUniqueOrThrow({ where: { id: payload.case.id } });
  const challenge = (JSON.parse(caseRow.privateReviewSpecJson) as { challenge?: string }).challenge;
  if (caseRow.generationRunId !== RUN_ID || challenge !== '控制变量混乱') throw new Error(`领取到意外案例：${caseRow.generationRunId}/${challenge}`);
  const candidateA = payload.candidates.find((item) => item.slot === 'A');
  const candidateB = payload.candidates.find((item) => item.slot === 'B');
  if (!candidateA || !candidateB) throw new Error('缺少 A/B 候选');
  const finalOutput = {
    dialogue: '如果同时改变材料数量和记录时间，即使叶片出现差异，也很难判断是哪一个因素造成的。除了你要研究的条件，其他条件应该怎样处理？',
    interactionType: 'clarification',
    focus: 'controls',
    hints: [],
  };
  const result = await submitEditReview({
    taskId: payload.task.id,
    decision: 'EDIT',
    selectedCandidateId: candidateA.id,
    finalOutput: JSON.stringify(finalOutput),
    reason: 'AI_ASSISTED_DRAFT：由 Codex 根据独立 reviewer 的退回意见修订，必须再次由独立 reviewer 实质确认。\n删除直接给出“光源距离”和“其他条件都保持一致”的参考答案，保留同时改变多个条件会破坏因果判断的解释，并用一个开放问题把控制条件的判断交还学生。',
    preferenceRejectedCandidateId: candidateB.id,
    preferenceReason: '修订稿不直接告诉学生应固定哪些条件，只解释公平比较的原因并要求学生自己归纳；B 直接给出了光源距离和保持一致的答案。',
    user,
  });
  console.log(JSON.stringify({ caseId: caseRow.id, challenge, status: result.status, finalOutput }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
