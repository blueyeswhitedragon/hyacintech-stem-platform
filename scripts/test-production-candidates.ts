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
import type { ShareGPTRecord } from '../app/lib/dataLab/types';
import type { SessionUser } from '../app/lib/session';
import {
  buildTutorLanguagePrompt,
  TUTOR_LANGUAGE_PROMPT_V1,
} from '../app/lib/tutorLanguage';
import { TUTOR_TRAINING_COHORT } from '../app/lib/dataLab/trainingCohort';
import { sha256 } from '../app/lib/dataLab/validation';
import { resolveTutorCaseAllowedFocusIds } from '../app/lib/dataLab/bootstrap/contracts';
import { generateTutorCandidates } from '../app/lib/dataLab/bootstrap/service';

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
  const sourceVisibleFacts = { 学生提出的研究问题: `不同光照是否影响${student.displayName}的豆苗生长` };
  const sourceSystemPrompt = buildTutorLanguagePrompt({
    phase: 1,
    triggerType: 'USER_MESSAGE',
    visibleFacts: sourceVisibleFacts,
    allowedFocusIds: ['research_question'],
  }, TUTOR_LANGUAGE_PROMPT_V1);
  const conversation = await db.conversation.create({ data: { userId: student.id, traceCoverage: 'COMPLETE', messages: JSON.stringify([{ id: randomUUID(), role: 'assistant', content: `欢迎${student.displayName}开始探究` }, { id: randomUUID(), role: 'user', content: '我先观察了第一组。' }, { id: randomUUID(), role: 'assistant', content: '请说说你记录到了什么。' }, { id: userMessageId, role: 'user', content: `我是${student.displayName}，电话13812345678` }, { id: assistantMessageId, role: 'assistant', content: response.dialogue }]) } });
  const studentAssignment = await db.studentAssignment.create({ data: { assignmentId: assignment.id, studentId: student.id, conversationId: conversation.id, status: 'IN_PROGRESS', currentStage: 1, dataConsentStatus: 'GRANTED', dataConsentPolicyVersion: 'student-data-policy-v1' } });
  const model = await db.modelVersion.create({ data: { tag: `candidate-test-${suffix}`, provider: 'test', externalModelId: 'test-model' } });
  const trace = await db.generationTrace.create({ data: { conversationId: conversation.id, assistantMessageId, userMessageId, stage: 1, modelVersionId: model.id, modelTagSnapshot: model.tag, providerSnapshot: 'test', externalModelSnapshot: 'test-model', promptVersion: TUTOR_LANGUAGE_PROMPT_V1, promptSha256: sha256(sourceSystemPrompt), trainingSystemPromptSnapshot: sourceSystemPrompt, styleFamily: 'classroom_coach', stylePolicyVersion: 'style-v1', requestMessageSha256: 'b'.repeat(64), responseJson: JSON.stringify(response), responseSha256: 'c'.repeat(64), contractVersion: 'tutor-language-v1', contractCheckJson: JSON.stringify({ stageContractVersion: 'stage-contract-v2', extractorVersion: 'student-fact-extractor-v1', promptPolicyVersion: TUTOR_LANGUAGE_PROMPT_V1, chosenFocus: 'research_question', allowedFocusIds: ['research_question'] }) } });
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

  await Promise.all([
    db.conversation.update({
      where: { id: conversation.id },
      data: {
        stageData: JSON.stringify({
          timeline: {
            lateEvents: [],
            releases: [{
              stage: 2,
              fromStage: 2,
              toStage: 3,
              teacherId: teacher.id,
              reason: '集成测试中的教师放行理由足够长',
              occurredAt: new Date().toISOString(),
            }],
          },
        }),
      },
    }),
    db.generationTrace.update({ where: { id: trace.id }, data: { stage: 2 } }),
  ]);
  let releasedTraceRejected = false;
  let unexpectedReleasedCandidateId: string | undefined;
  try {
    const unexpected = await nominateProductionCandidate({
      studentAssignmentId: studentAssignment.id,
      assistantMessageId,
      teacherId: teacher.id,
      triggerType: 'TEACHER_NOMINATION',
    });
    unexpectedReleasedCandidateId = unexpected.id;
  } catch (error) {
    releasedTraceRejected = error instanceof Error && error.message.includes('教师放行');
  }
  if (unexpectedReleasedCandidateId) {
    await db.productionCandidate.delete({ where: { id: unexpectedReleasedCandidateId } });
  }
  await Promise.all([
    db.conversation.update({ where: { id: conversation.id }, data: { stageData: '{}' } }),
    db.generationTrace.update({ where: { id: trace.id }, data: { stage: 1 } }),
  ]);
  check(releasedTraceRejected, '存在教师放行记录的阶段轨迹不能进入正向候选池');

  const teacherSession: SessionUser = { id: teacher.id, username: teacher.username, displayName: teacher.displayName, role: 'teacher' };

  const candidate = await nominateProductionCandidate({ studentAssignmentId: studentAssignment.id, assistantMessageId, teacherId: teacher.id, triggerType: 'TEACHER_NOMINATION', triggerNote: '导师泄露身份' });
  check(candidate.status === 'NOMINATED', '教师提名进入隔离候选池');
  check(!candidate.redactedRecordJson.includes(student.displayName), '候选快照不含学生显示名');
  check(!candidate.redactedRecordJson.includes(klass.name), '候选快照不含班级名');
  check(candidate.redactedRecordJson.includes('可见事实'), '候选快照保留模型当轮实际可见上下文');
  check(candidate.redactedRecordJson.includes('我先观察了第一组'), '候选快照保留脱敏后的模型可见对话历史');
  const candidateRecord = JSON.parse(candidate.redactedRecordJson) as ShareGPTRecord;
  check(candidateRecord.meta?.stageContractVersion === 'stage-contract-v2' && candidateRecord.meta?.promptVersion === TUTOR_LANGUAGE_PROMPT_V1 && candidateRecord.meta?.extractorVersion === 'student-fact-extractor-v1', '生产候选保留轨迹实际 Prompt、Extractor 和阶段合同版本');
  await reviewProductionCandidate({ id: candidate.id, action: 'APPROVE', adminId: admin.id });
  const converted = await convertProductionCandidates({ ids: [candidate.id], adminId: admin.id });
  const convertedCandidate = await db.productionCandidate.findUniqueOrThrow({ where: { id: candidate.id }, include: { convertedTutorTurnCase: true } });
  check(converted.cases.length === 1 && converted.cases[0].dataSource === 'PRODUCTION_TRACE', '通过候选转换为独立 TutorTurnCase');
  check(convertedCandidate.status === 'CONVERTED' && convertedCandidate.convertedTutorTurnCase?.dataSource === 'PRODUCTION_TRACE', '转换后候选与 TutorTurnCase 双向追溯');
  check(convertedCandidate.convertedTutorTurnCase?.promptVersion === TUTOR_TRAINING_COHORT.promptVersion
    && convertedCandidate.convertedTutorTurnCase?.extractorVersion === TUTOR_TRAINING_COHORT.extractorVersion
    && convertedCandidate.convertedTutorTurnCase?.status === 'READY', '生产轨迹按当前训练目标合同生成可审核案例');
  check(convertedCandidate.convertedTutorTurnCase?.sourcePromptVersion === TUTOR_LANGUAGE_PROMPT_V1
    && convertedCandidate.convertedTutorTurnCase?.sourceExtractorVersion === 'student-fact-extractor-v1'
    && convertedCandidate.convertedTutorTurnCase?.sourceStageContractVersion === 'stage-contract-v2', '来源版本独立留存且不伪装为训练目标版本');
  check(convertedCandidate.convertedTutorTurnCase?.sourceSystemPrompt?.includes(student.displayName) === false
    && convertedCandidate.convertedTutorTurnCase?.systemPrompt.includes(TUTOR_TRAINING_COHORT.promptVersion) === true, '来源 Prompt 脱敏留存并重建目标 Prompt');

  const convertedCase = convertedCandidate.convertedTutorTurnCase!;
  const convertedFocus = resolveTutorCaseAllowedFocusIds(convertedCase)[0];
  const generatedProduction = await generateTutorCandidates({
    caseId: convertedCase.id,
    modelA: { provider: 'openai', model: 'test-anthropic', family: 'anthropic' },
    modelB: { provider: 'deepseek', model: 'test-deepseek', family: 'deepseek' },
    user: { id: admin.id, username: admin.username, displayName: admin.displayName, role: 'admin' },
  }, {
    generateOne: async (_case, config) => ({
      raw: JSON.stringify({ dialogue: config.provider === 'openai' ? '请把你想研究的问题说得更具体一些。' : '你最想弄清这个现象中的哪一点？', interactionType: 'clarification', focus: convertedFocus, hints: [] }),
      params: { usage: { totalTokens: 1 } },
    }),
    critiqueCandidate: async (input) => ({ status: 'COMPLETED' as const, issues: [], advisories: [], raw: '{"issues":[]}', critic: { provider: input.config.provider, model: input.config.model, family: input.config.family ?? input.config.provider }, params: { usage: { totalTokens: 1 } } }),
  });
  check(generatedProduction.status === 'COMPLETED' && (await db.tutorCandidate.count({ where: { generationRunId: generatedProduction.runId, status: 'GENERATED' } })) === 2, '生产转换案例可直接使用 private focus 完成双候选生成');
  check((await db.tutorReviewTask.count({ where: { caseId: convertedCase.id, type: 'EDIT', status: 'PENDING' } })) === 1, '生产转换案例仅在完整 A/B 和交叉检查后进入初审');

  const reportSourcePrompt = buildTutorLanguagePrompt({
    phase: 5,
    triggerType: 'REPORT_BOOTSTRAP',
    visibleFacts: { 报告框架由服务器生成: true },
    allowedFocusIds: ['report_handoff'],
  }, TUTOR_LANGUAGE_PROMPT_V1);
  await db.generationTrace.update({
    where: { id: systemTrace.id },
    data: {
      triggerType: 'REPORT_BOOTSTRAP',
      stage: 5,
      promptVersion: TUTOR_LANGUAGE_PROMPT_V1,
      promptSha256: sha256(reportSourcePrompt),
      trainingSystemPromptSnapshot: reportSourcePrompt,
      responseJson: JSON.stringify({ dialogue: '报告框架已生成，请查看待完成部分。', interactionType: 'information', focus: 'report_handoff', hints: [] }),
      contractVersion: 'tutor-language-v1',
      contractCheckJson: JSON.stringify({ stageContractVersion: 'stage-contract-v2', extractorVersion: 'student-fact-extractor-v1', chosenFocus: 'report_handoff', allowedFocusIds: ['report_handoff'] }),
    },
  });
  const reportCandidate = await db.productionCandidate.create({
    data: {
      generationTraceId: systemTrace.id,
      status: 'APPROVED',
      triggerType: 'TEACHER_NOMINATION',
      consentStatusSnapshot: 'GRANTED',
      dataPolicyVersion: 'student-data-policy-v1',
      redactedRecordJson: JSON.stringify({
        id: `report-bootstrap-${suffix}`,
        source: 'production_trace',
        scenario: '报告框架系统触发',
        phase: 5,
        conversations: [{ from: 'gpt', value: '{"dialogue":"报告框架已生成"}' }],
        meta: { systemPrompt: reportSourcePrompt, generationContext: { modelVisibleHistory: [] } },
      } satisfies ShareGPTRecord),
      contentSha256: '4'.repeat(64),
      familyKey: `report-bootstrap-${suffix}`,
      nominatedById: teacher.id,
      processedById: admin.id,
    },
  });
  const convertedReport = await convertProductionCandidates({ ids: [reportCandidate.id], adminId: admin.id });
  check(
    convertedReport.cases[0]?.triggerType === 'REPORT_BOOTSTRAP'
      && convertedReport.cases[0]?.studentMessage === '',
    'REPORT_BOOTSTRAP 生产轨迹可转换为空学生消息的系统触发案例',
  );

  await setStudentDataConsent({ studentAssignmentId: studentAssignment.id, studentId: student.id, decision: 'WITHDRAW' });
  check((await db.productionCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status === 'WITHDRAWN', '撤回授权使已转换候选停止使用');
  check((await db.tutorTurnCase.findUniqueOrThrow({ where: { id: converted.cases[0].id } })).status === 'BLOCKED', '撤回授权同步阻断已转换 TutorTurnCase');

  await db.dataLabAuditLog.deleteMany({ where: { actorId: { in: [teacher.id, student.id, admin.id] } } });
  await db.productionCandidate.deleteMany({ where: { id: { in: [candidate.id, reportCandidate.id] } } });
  await db.tutorTurnCase.deleteMany({ where: { id: { in: [converted.cases[0].id, convertedReport.cases[0].id] } } });
  await db.bootstrapGenerationRun.delete({ where: { id: generatedProduction.runId } });
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
