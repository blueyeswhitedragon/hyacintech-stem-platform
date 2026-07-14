#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import { db } from '../app/lib/db';
import { detectDatasetLeakage } from '../app/lib/datasetLeakage';
import {
  convertProductionCandidates,
  nominateProductionCandidate,
  reviewProductionCandidate,
  setStudentDataConsent,
} from '../app/lib/productionCandidates';
import { redactProductionRecord } from '../app/lib/redaction';
import { createCampaign, startCampaign } from '../app/lib/dataLab/service';
import type { ShareGPTRecord } from '../app/lib/dataLab/types';
import type { SessionUser } from '../app/lib/session';

let passed = 0;
let failed = 0;
function check(condition: unknown, label: string) {
  if (condition) { passed++; console.log(`PASS ${label}`); }
  else { failed++; console.error(`FAIL ${label}`); }
}

async function main() {
  const suffix = randomUUID();
  const source: ShareGPTRecord = {
    id: `redact-${suffix}`,
    scenario: '测试', phase: 2,
    conversations: [
      { from: 'human', value: '我是小明，邮箱 test@example.com，电话 13812345678，附件 https://example.com/a.jpg' },
      { from: 'gpt', value: JSON.stringify({ dialogue: '小明请继续', next_action_type: 'text_input', phase_complete: false }) },
    ],
  };
  const redacted = redactProductionRecord(source, ['小明'], 'student-data-policy-v1');
  check(!JSON.stringify(redacted.record).includes('小明'), '已知姓名从整条结构记录中移除');
  check(!JSON.stringify(redacted.record).includes('test@example.com'), '邮箱被本地规则脱敏');
  check(!JSON.stringify(redacted.record).includes('13812345678'), '手机号被本地规则脱敏');
  check(redacted.report.attachmentsRemoved === 1, '链接或附件只保留移除标记');
  check(detectDatasetLeakage(redacted.record, [{ id: 'same', record: redacted.record }]).blocked, '精确重复被泄漏检查阻断');

  const [teacher, student, admin] = await Promise.all([
    db.user.create({ data: { username: `teacher-${suffix}`, passwordHash: 'x', role: 'teacher', displayName: `教师-${suffix}` } }),
    db.user.create({ data: { username: `student-${suffix}`, passwordHash: 'x', role: 'student', displayName: `学生-${suffix}` } }),
    db.user.create({ data: { username: `admin-${suffix}`, passwordHash: 'x', role: 'admin', displayName: `管理员-${suffix}` } }),
  ]);
  const klass = await db.class.create({ data: { name: `隐私班级-${suffix}`, inviteCode: suffix.replace(/-/g, '').slice(0, 6).toUpperCase(), teacherId: teacher.id } });
  const assignment = await db.assignment.create({ data: { classId: klass.id, title: '授权测试', dataContributionMode: 'CONSENT_REQUIRED', dataPolicyVersion: 'student-data-policy-v1' } });
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const response = { dialogue: `你好${student.displayName}，请访问 https://example.com/file.png`, next_action_type: 'text_input', phase_complete: false };
  const conversation = await db.conversation.create({ data: { userId: student.id, traceCoverage: 'COMPLETE', messages: JSON.stringify([{ id: randomUUID(), role: 'assistant', content: `欢迎${student.displayName}开始探究` }, { id: randomUUID(), role: 'user', content: '我先观察了第一组。' }, { id: randomUUID(), role: 'assistant', content: '请说说你记录到了什么。' }, { id: userMessageId, role: 'user', content: `我是${student.displayName}，电话13812345678` }, { id: assistantMessageId, role: 'assistant', content: response.dialogue }]) } });
  const studentAssignment = await db.studentAssignment.create({ data: { assignmentId: assignment.id, studentId: student.id, conversationId: conversation.id, status: 'IN_PROGRESS', currentStage: 1, dataConsentStatus: 'GRANTED', dataConsentPolicyVersion: 'student-data-policy-v1' } });
  const model = await db.modelVersion.create({ data: { tag: `candidate-test-${suffix}`, provider: 'test', externalModelId: 'test-model' } });
  const trace = await db.generationTrace.create({ data: { conversationId: conversation.id, assistantMessageId, userMessageId, stage: 1, modelVersionId: model.id, modelTagSnapshot: model.tag, providerSnapshot: 'test', externalModelSnapshot: 'test-model', promptVersion: 'p1', promptSha256: 'a'.repeat(64), trainingSystemPromptSnapshot: `阶段1完整上下文：${student.displayName}`, styleFamily: 'classroom_coach', stylePolicyVersion: 'style-v1', requestMessageSha256: 'b'.repeat(64), responseJson: JSON.stringify(response), responseSha256: 'c'.repeat(64), contractVersion: 'c1' } });
  const systemAssistantMessageId = randomUUID();
  const systemTrace = await db.generationTrace.create({
    data: {
      conversationId: conversation.id,
      assistantMessageId: systemAssistantMessageId,
      userMessageId: randomUUID(),
      triggerType: 'STAGE_TRANSITION',
      stage: 4,
      modelVersionId: model.id,
      modelTagSnapshot: model.tag,
      providerSnapshot: 'test',
      externalModelSnapshot: 'test-model',
      promptVersion: 'p4',
      promptSha256: 'd'.repeat(64),
      systemPromptSnapshot: '阶段4主动过渡提示词',
      styleFamily: 'classroom_coach',
      stylePolicyVersion: 'style-v1',
      requestMessageSha256: 'e'.repeat(64),
      responseJson: JSON.stringify(response),
      responseSha256: 'f'.repeat(64),
      contractVersion: 'stage-contract-v2',
    },
  });
  let systemTraceRejected = false;
  try {
    await nominateProductionCandidate({ studentAssignmentId: studentAssignment.id, assistantMessageId: systemAssistantMessageId, teacherId: teacher.id, triggerType: 'TEACHER_NOMINATION' });
  } catch (error) {
    systemTraceRejected = error instanceof Error && error.message.includes('系统主动生成');
  }
  check(systemTraceRejected, '系统触发的阶段消息不能进入生产候选池');

  const legacyTraceAssistantMessageId = randomUUID();
  const legacyTrace = await db.generationTrace.create({
    data: {
      conversationId: conversation.id,
      assistantMessageId: legacyTraceAssistantMessageId,
      userMessageId: randomUUID(),
      stage: 1,
      modelVersionId: model.id,
      modelTagSnapshot: model.tag,
      providerSnapshot: 'test',
      externalModelSnapshot: 'test-model',
      promptVersion: 'p1',
      promptSha256: '1'.repeat(64),
      styleFamily: 'classroom_coach',
      stylePolicyVersion: 'style-v1',
      requestMessageSha256: '2'.repeat(64),
      responseJson: JSON.stringify(response),
      responseSha256: '3'.repeat(64),
      contractVersion: 'c1',
    },
  });
  let legacyContextRejected = false;
  try {
    await nominateProductionCandidate({ studentAssignmentId: studentAssignment.id, assistantMessageId: legacyTraceAssistantMessageId, teacherId: teacher.id, triggerType: 'TEACHER_NOMINATION' });
  } catch (error) {
    legacyContextRejected = error instanceof Error && error.message.includes('完整训练上下文');
  }
  check(legacyContextRejected, '缺少经授权完整上下文的历史轨迹不能进入正向训练候选池');

  const teacherSession: SessionUser = { id: teacher.id, username: teacher.username, displayName: teacher.displayName, role: 'teacher' };
  const adminSession: SessionUser = { id: admin.id, username: admin.username, displayName: admin.displayName, role: 'admin' };

  const candidate = await nominateProductionCandidate({ studentAssignmentId: studentAssignment.id, assistantMessageId, teacherId: teacher.id, triggerType: 'TEACHER_NOMINATION', triggerNote: '导师泄露身份' });
  check(candidate.status === 'NOMINATED', '教师提名进入隔离候选池');
  check(!candidate.redactedRecordJson.includes(student.displayName), '候选快照不含学生显示名');
  check(!candidate.redactedRecordJson.includes(klass.name), '候选快照不含班级名');
  check(candidate.redactedRecordJson.includes('阶段1完整上下文'), '候选快照保留模型当轮实际可见上下文');
  check(candidate.redactedRecordJson.includes('我先观察了第一组'), '候选快照保留脱敏后的模型可见对话历史');
  await reviewProductionCandidate({ id: candidate.id, action: 'APPROVE', adminId: admin.id });
  const batchName = `production-batch-${suffix}`;
  const converted = await convertProductionCandidates({ ids: [candidate.id], batchName, adminId: admin.id });
  const convertedCandidate = await db.productionCandidate.findUniqueOrThrow({ where: { id: candidate.id }, include: { convertedSample: true } });
  check(converted.batch.sourceType === 'production_trace', '通过候选转换为独立 production_trace 批次');
  check(convertedCandidate.status === 'CONVERTED' && convertedCandidate.convertedSample?.sourceKind === 'production_trace', '转换后候选与脱敏样本双向追溯');

  await setStudentDataConsent({ studentAssignmentId: studentAssignment.id, studentId: student.id, decision: 'WITHDRAW' });
  check((await db.productionCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status === 'WITHDRAWN', '撤回授权使已转换候选停止使用');
  const campaign = await createCampaign({ name: `withdrawn-campaign-${suffix}`, selection: { batchIds: [converted.batch.id] }, user: adminSession });
  let excluded = false;
  try { await startCampaign(campaign.id, adminSession); } catch (error) { excluded = error instanceof Error && error.message.includes('没有匹配样本'); }
  check(excluded, '撤回候选不会被新标注活动领取');

  await db.dataLabAuditLog.deleteMany({ where: { actorId: { in: [teacher.id, student.id, admin.id] } } });
  await db.annotationCampaign.delete({ where: { id: campaign.id } });
  await db.productionCandidate.delete({ where: { id: candidate.id } });
  await db.datasetBatch.delete({ where: { id: converted.batch.id } });
  await db.generationTrace.deleteMany({ where: { id: { in: [trace.id, systemTrace.id, legacyTrace.id] } } });
  await db.studentAssignment.delete({ where: { id: studentAssignment.id } });
  await db.conversation.delete({ where: { id: conversation.id } });
  await db.assignment.delete({ where: { id: assignment.id } });
  await db.class.delete({ where: { id: klass.id } });
  await db.modelVersion.delete({ where: { id: model.id } });
  await db.user.deleteMany({ where: { id: { in: [teacher.id, student.id, admin.id] } } });

  check(teacherSession.role === 'teacher', '测试身份构造有效');
  console.log(`\nProduction candidate tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
