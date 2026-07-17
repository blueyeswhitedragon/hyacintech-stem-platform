#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import { readFile, rm } from 'fs/promises';
import path from 'path';
import { db } from '../app/lib/db';
import type { SessionUser } from '../app/lib/session';
import { checkTutorCandidate } from '../app/lib/dataLab/bootstrap/contracts';
import {
  claimTutorReviewTask,
  compileTopicCardsWithModels,
  compileTutorTurnCases,
  createTopicCard,
  createTopicCardRevision,
  createTutorTurnRelease,
  decideTopicCard,
  generateAiAssistedTutorDraft,
  generateTopicCardDrafts,
  generateTutorCandidates,
  listTutorCaseQualityTasks,
  previewTutorConfirmFinal,
  renewTutorReviewLease,
  resolveTutorCaseQualityTask,
  retryTutorCandidateCritics,
  submitConfirmReview,
  submitEditReview,
  updateTopicCard,
} from '../app/lib/dataLab/bootstrap/service';
import { importTopicSources, sourcePackagesForCompilation } from '../app/lib/dataLab/bootstrap/topicSources';
import { createTrainingRun, importEvaluation } from '../app/lib/dataLab/service';
import { registerModelVersion } from '../app/lib/modelRegistry';
import { createOrPromoteDeployment, updateDeploymentObservation } from '../app/lib/deployment';

let passed = 0; let failed = 0;
function check(condition: unknown, label: string) { if (condition) { passed++; console.log(`PASS ${label}`); } else { failed++; console.error(`FAIL ${label}`); } }

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const users = await Promise.all([
    db.user.create({ data: { username: `bootstrap-admin-${suffix}`, passwordHash: 'x', role: 'admin', displayName: '启动管理员' } }),
    db.user.create({ data: { username: `bootstrap-annotator-${suffix}`, passwordHash: 'x', role: 'annotator', displayName: '首次审核员' } }),
    db.user.create({ data: { username: `bootstrap-reviewer-${suffix}`, passwordHash: 'x', role: 'reviewer', displayName: '最终审核员' } }),
  ]);
  const [adminRow, annotatorRow, reviewerRow] = users;
  const session = (row: typeof adminRow): SessionUser => ({ id: row.id, username: row.username, displayName: row.displayName, role: row.role as SessionUser['role'] });
  const admin = session(adminRow); const annotator = session(annotatorRow); const reviewer = session(reviewerRow);

  const card = await createTopicCard({
    displayTitle: '怎样让纸桥承受更多书本',
    studentOpening: '我搭纸桥时发现有的形状很容易塌，想知道为什么。',
    internalArchetype: 'engineering_fuzzy',
    subject: 'engineering', gradeBand: '初中', coreMechanism: '结构形状会改变受力与承重表现',
    acceptableDirections: ['比较不同折叠截面的承重', '比较桥面层数与承重'],
    forbiddenDirections: ['要求学生使用危险切割工具'], curriculumAnchors: ['结构稳定性', '控制变量'],
    source: { title: '桥梁结构教学设计', license: 'authorized' },
  }, admin);
  await decideTopicCard(card.id, 'APPROVE', '', admin);
  check((await db.topicCard.findUniqueOrThrow({ where: { id: card.id } })).status === 'APPROVED', 'TopicCard 创建并人工批准');

  const sourceImport = await importTopicSources([
    { title: '智能遮光系统 课件', summary: '学生设计一个根据环境光自动触发的低压遮光装置，并比较触发设置与响应准确率。', sourcePlatform: 'integration', sourceResourceId: `shade-course-${suffix}`, authorizationStatus: 'CONFIRMED' },
    { title: '智能遮光系统 学习任务单', summary: '任务单要求学生记录不同触发阈值下的正确响应、误触发和漏触发情况。', sourcePlatform: 'integration', sourceResourceId: `shade-task-${suffix}`, authorizationStatus: 'CONFIRMED' },
  ], admin);
  const sourceRows = await db.topicSourceCandidate.findMany({ where: { sourcePlatform: 'integration', sourceResourceId: { contains: suffix } }, orderBy: { createdAt: 'asc' } });
  check(sourceImport.created === 2 && sourceRows.length === 2 && sourceRows[0].familyKey === sourceRows[1].familyKey, '素材池幂等导入并按资源变体归入同一项目家族');
  const sourcePackages = await sourcePackagesForCompilation(sourceRows.map((item) => item.id));
  check(sourcePackages.length === 1 && Array.isArray(sourcePackages[0].sourceCandidateIds) && sourcePackages[0].sourceCandidateIds.length === 2, '同项目课件和任务单聚合为一个编译资源包');

  const shadeInput = {
    displayTitle: '教室西晒时怎样让遮光装置判断得更准',
    studentOpening: '下午太阳照进来时，窗帘拉早了会太暗，拉晚了又很热，我想做一个能自己判断的装置。',
    internalArchetype: 'engineering_v2', subject: 'engineering' as const, gradeBand: '初中', coreMechanism: '环境光读数与触发阈值共同决定遮光响应',
    acceptableDirections: [], forbiddenDirections: ['只使用低压装置'], curriculumAnchors: ['光传感器', '工程迭代'], source: { title: '智能遮光系统课程资源', license: 'authorized' },
    schemaVersion: 2 as const, activityMode: 'ENGINEERING_DESIGN' as const, contextModule: 'INTELLIGENT_INFORMATION' as const,
    disciplineAnchors: ['physics', 'information_technology', 'engineering'] as const, authenticNeed: '教室西晒时需要及时遮光且避免误触发', stakeholder: '教室师生', engineeringGoal: '制作稳定触发的低压遮光模型',
    constraints: ['低压供电', '桌面尺度'], performanceCriteria: ['正确响应率较高', '误触发可记录'], sourceCandidateId: sourceRows[0].id,
    inquiryBridges: [
      { label: '触发阈值', retainedFeature: '自动判断并触发遮光', researchQuestion: '光照触发阈值是否影响遮光装置正确响应率？', factor: '光照触发阈值', phenomenon: '正确响应率', testScaffold: { levels: ['低阈值', '中阈值', '高阈值'], measurement: '进行10次明暗测试并计算正确响应比例', unit: '%', metricKind: 'PERCENTAGE' as const, safeValueRange: [40, 100] as [number, number], controlledConditions: ['同一传感器位置', '同一光源距离'] }, returnToDesign: '依据正确响应率与误触发记录选择下一版阈值' },
      { label: '传感器位置', retainedFeature: '自动判断并触发遮光', researchQuestion: '传感器位置是否影响遮光装置正确响应率？', factor: '传感器位置', phenomenon: '正确响应率', testScaffold: { levels: ['窗边', '模型中部', '背光侧'], measurement: '进行10次明暗测试并计算正确响应比例', unit: '%', metricKind: 'PERCENTAGE' as const, safeValueRange: [40, 100] as [number, number], controlledConditions: ['同一触发阈值', '同一光源距离'] }, returnToDesign: '依据稳定性选择下一版传感器安装位置' },
    ],
  };
  const shadeCard = await createTopicCard({ ...shadeInput, disciplineAnchors: [...shadeInput.disciplineAnchors] }, admin);
  await decideTopicCard(shadeCard.id, 'APPROVE', '', admin);
  const shadeCases = await compileTutorTurnCases({ profile: 'CUSTOM', counts: { 4: 1, 6: 1 }, split: 'PILOT', topicCardIds: [shadeCard.id], user: admin });
  check(shadeCases.cases.every((item) => !item.studentMessage.includes('条件一')) && shadeCases.cases.some((item) => item.studentMessage.includes('下一版')), 'V2 工程卡生成真实水平数据并在 P6 返回设计');
  const shadeRevision = await createTopicCardRevision(shadeCard.id, admin);
  check(shadeRevision.schemaVersion === 2 && shadeRevision.revision === 2 && (await db.topicCard.findUniqueOrThrow({ where: { id: shadeCard.id } })).status === 'APPROVED', '创建 V2 修订时旧批准卡与历史案例保持不变');
  await updateTopicCard(shadeRevision.id, { ...shadeInput, displayTitle: '教室西晒时怎样改进自动遮光判断', disciplineAnchors: [...shadeInput.disciplineAnchors] }, admin);
  await decideTopicCard(shadeRevision.id, 'APPROVE', '', admin);
  check((await db.topicCard.findUniqueOrThrow({ where: { id: shadeCard.id } })).status === 'SUPERSEDED' && (await db.tutorTurnCase.count({ where: { topicCardId: shadeCard.id } })) === 2, 'V2 修订批准后旧卡被替代但旧案例不改写');
  let mockCompileCall = 0;
  const rejectedCompilation = await compileTopicCardsWithModels({ sources: [{ title: '信息不足的资源', summary: '占位说明' }], modelA: { provider: 'openai', model: 'mock-a' }, modelB: { provider: 'deepseek', model: 'mock-b' }, user: admin }, {
    compileCard: async () => {
      mockCompileCall += 1;
      return mockCompileCall === 1
        ? { raw: '{"rejected":true,"reason":"资源缺少可确认的核心机制"}', parsed: { rejected: true, reason: '资源缺少可确认的核心机制' }, promptSha256: 'mock', params: { usage: { totalTokens: 1 }, jsonFormat: true, maxTokens: 1, timeoutMs: 1, thinking: null, reasoningEffort: null } }
        : { raw: 'not-json', parsed: null, promptSha256: 'mock', params: { usage: { totalTokens: 1 }, jsonFormat: true, maxTokens: 1, timeoutMs: 1, thinking: null, reasoningEffort: null } };
    },
    critiqueCard: async () => ({ issues: [] }),
  });
  check(rejectedCompilation.failed === 2 && rejectedCompilation.failures.some((item) => item.kind === 'MODEL_REJECTED') && rejectedCompilation.failures.some((item) => item.kind === 'PARSE_FAILED'), 'TopicCard 双模型编译分别记录模型主动拒绝和 JSON 解析失败原因');
  const successfulCompilation = await compileTopicCardsWithModels({ sources: sourcePackages, modelA: { provider: 'openai', model: 'mock-v2-a' }, modelB: { provider: 'deepseek', model: 'mock-v2-b' }, user: admin }, {
    compileCard: async () => ({
      raw: JSON.stringify({ resourceAssessment: { type: 'STUDENT_ENGINEERING_RESOURCE', reason: '学生工程项目' }, displayTitle: shadeInput.displayTitle, studentOpening: shadeInput.studentOpening, subject: shadeInput.subject, gradeBand: shadeInput.gradeBand, coreMechanism: shadeInput.coreMechanism, activityMode: shadeInput.activityMode, contextModule: shadeInput.contextModule, disciplineAnchors: shadeInput.disciplineAnchors, authenticNeed: shadeInput.authenticNeed, stakeholder: shadeInput.stakeholder, engineeringGoal: shadeInput.engineeringGoal, constraints: shadeInput.constraints, performanceCriteria: shadeInput.performanceCriteria, inquiryBridges: shadeInput.inquiryBridges, forbiddenDirections: shadeInput.forbiddenDirections, curriculumAnchors: shadeInput.curriculumAnchors }),
      parsed: { resourceAssessment: { type: 'STUDENT_ENGINEERING_RESOURCE', reason: '学生工程项目' }, displayTitle: shadeInput.displayTitle, studentOpening: shadeInput.studentOpening, subject: shadeInput.subject, gradeBand: shadeInput.gradeBand, coreMechanism: shadeInput.coreMechanism, activityMode: shadeInput.activityMode, contextModule: shadeInput.contextModule, disciplineAnchors: shadeInput.disciplineAnchors, authenticNeed: shadeInput.authenticNeed, stakeholder: shadeInput.stakeholder, engineeringGoal: shadeInput.engineeringGoal, constraints: shadeInput.constraints, performanceCriteria: shadeInput.performanceCriteria, inquiryBridges: shadeInput.inquiryBridges, forbiddenDirections: shadeInput.forbiddenDirections, curriculumAnchors: shadeInput.curriculumAnchors },
      promptSha256: 'mock-v2', params: { usage: { totalTokens: 1 }, jsonFormat: true, maxTokens: 1, timeoutMs: 1, thinking: null, reasoningEffort: null },
    }),
    critiqueCard: async () => ({ issues: [{ quote: shadeInput.engineeringGoal, category: 'ENGINEERING_CONTEXT_LOST', message: '需要管理员确认工程目标是否仍完整', confidence: 'high' }] }),
  });
  check(successfulCompilation.completed === 2 && successfulCompilation.cards.every((item) => item.schemaVersion === 2 && item.sourceCandidateId === sourceRows[0].id), '双模型成功编译保存完整 V2 字段和素材来源');

  const ideationPayload = { displayTitle: '哪种摆放方式能让书包最省力背起', studentOpening: '每天背书包上楼都觉得肩膀酸，我想知道东西怎么放会省力一点。', subject: 'physics', gradeBand: '初中', coreMechanism: '重心位置改变背负时的受力分布', activityMode: 'SCIENTIFIC_INQUIRY', contextModule: 'LIFE_HEALTH', disciplineAnchors: ['physics'], authenticNeed: '学生每天背书包出现肩颈疲劳，希望通过调整装载减轻负担', stakeholder: '走读学生', engineeringGoal: '', constraints: [], performanceCriteria: [], forbiddenDirections: ['不得让学生背负超重书包做长时间测试'], curriculumAnchors: ['力与平衡', '控制变量'], inquiryBridges: [
    { label: '重物位置', retainedFeature: '重心位置影响受力', researchQuestion: '重物贴背放与外侧放是否影响拉力计读数？', factor: '重物在包内的位置', phenomenon: '模拟背带的拉力读数', testScaffold: { levels: ['贴背放', '中间放', '外侧放'], measurement: '用弹簧测力计悬挂书包并读数', unit: 'N', metricKind: 'OTHER', controlledConditions: ['同一书包', '相同总质量'] } },
    { label: '重物高度', retainedFeature: '重心位置影响受力', researchQuestion: '重物放在包内上部或下部是否影响拉力计读数？', factor: '重物在包内的高度', phenomenon: '模拟背带的拉力读数', testScaffold: { levels: ['上部', '下部'], measurement: '用弹簧测力计悬挂书包并读数', unit: 'N', metricKind: 'OTHER', controlledConditions: ['同一书包', '相同总质量'] } },
  ] };
  let ideationCall = 0;
  const ideation = await generateTopicCardDrafts({ theme: '书包与省力', count: 2, user: admin }, {
    complete: async () => {
      ideationCall += 1;
      const raw = ideationCall === 1 ? JSON.stringify(ideationPayload) : 'not-json';
      return { content: raw, finishReason: 'stop', reasoningChars: 0, usage: { totalTokens: 1 }, request: { jsonFormat: true, maxTokens: 3600, timeoutMs: 1, thinking: null, reasoningEffort: null } };
    },
    critiqueCard: async () => ({ issues: [] }),
  });
  check(ideation.completed === 1 && ideation.failed === 1 && ideation.failures.some((item) => item.kind === 'PARSE_FAILED'), '一键生成话题卡：成功产出 DRAFT 并记录解析失败');
  const ideationCard = ideation.cards[0];
  check(ideationCard.status === 'DRAFT' && ideationCard.schemaVersion === 2 && ideationCard.internalArchetype === 'ai_ideation_v1' && JSON.parse(ideationCard.sourceJson).kind === 'AI_IDEATION', '一键生成卡片为 V2 草稿且来源标记 AI_IDEATION');
  const ideationRun = await db.bootstrapGenerationRun.findUniqueOrThrow({ where: { id: ideation.runId } });
  check(ideationRun.kind === 'TOPIC_CARD_IDEATION' && ideationRun.completedItems === 1 && ideationRun.failedItems === 1, '一键生成记录独立的 BootstrapGenerationRun');

  let criticBlocked = false;
  try { await decideTopicCard(successfulCompilation.cards[0].id, 'APPROVE', '', admin); } catch (error) { criticBlocked = error instanceof Error && error.message.includes('高置信度'); }
  check(criticBlocked, '高置信度 TopicCard Critic 问题在未人工说明时阻断批准');
  await updateTopicCard(successfulCompilation.cards[0].id, { ...shadeInput, disciplineAnchors: [...shadeInput.disciplineAnchors], compilerEvidence: JSON.parse(successfulCompilation.cards[0].compilerEvidenceJson), criticOverrideReason: '管理员核对资源后确认工程目标已在真实需求、工程目标和返回设计字段中完整保留。' }, admin);
  await decideTopicCard(successfulCompilation.cards[0].id, 'APPROVE', '', admin);
  check((await db.topicCard.findUniqueOrThrow({ where: { id: successfulCompilation.cards[0].id } })).status === 'APPROVED', '管理员填写审计说明后可覆盖 TopicCard Critic 并批准');
  let fullBlocked = false;
  try { await compileTutorTurnCases({ profile: 'FULL_180', split: 'TRAIN', topicCardIds: [card.id], user: admin }); } catch (error) { fullBlocked = error instanceof Error && error.message.includes('36 案例试验'); }
  check(fullBlocked, '未通过并签署 36 案例试验时禁止扩到 180');
  let calibrationBlocked = false;
  try { await compileTutorTurnCases({ profile: 'CALIBRATION_12', split: 'PILOT', topicCardIds: [card.id], user: admin }); } catch (error) { calibrationBlocked = error instanceof Error && error.message.includes('Smoke 6'); }
  check(calibrationBlocked, '未通过 Smoke 6 时禁止创建 Calibration 12');
  let trialBlocked = false;
  try { await compileTutorTurnCases({ profile: 'TRIAL_36', split: 'PILOT', topicCardIds: [card.id], user: admin }); } catch (error) { trialBlocked = error instanceof Error && error.message.includes('Calibration 12'); }
  check(trialBlocked, '未通过 Calibration 12 时禁止创建 Trial 36');

  const compiled = await compileTutorTurnCases({ profile: 'CUSTOM', counts: { 1: 1 }, split: 'TRAIN', topicCardIds: [card.id], user: admin });
  const caseItem = compiled.cases[0];
  check(caseItem.contractVersion === 'tutor-language-v1' && !caseItem.systemPrompt.includes('engineering_fuzzy'), 'Case 保存当前合同且 Prompt 不泄漏 internal archetype');

  const run = await db.bootstrapGenerationRun.create({ data: { kind: 'CANDIDATE_GENERATION', status: 'COMPLETED', totalItems: 4, completedItems: 4, createdById: admin.id, startedAt: new Date(), completedAt: new Date(), modelConfigJson: JSON.stringify({ A: { family: 'openai' }, B: { family: 'deepseek' } }) } });
  const focus = (JSON.parse(caseItem.visibleFactsJson) as { allowedFocusIds: string[] }).allowedFocusIds;
  const rawA = JSON.stringify({ dialogue: '非常好！你提到纸桥容易塌。你最想先比较哪一种结构变化？', interactionType: 'open_question', focus: focus[0], hints: [] });
  const rawB = JSON.stringify({ dialogue: '你注意到不同形状的纸桥容易塌。先说说你最想改变哪一个结构特点？', interactionType: 'clarification', focus: focus[0], hints: [] });
  const checkA = checkTutorCandidate({ rawOutput: rawA, allowedFocusIds: focus, phase: 1, triggerType: caseItem.triggerType, studentMessage: caseItem.studentMessage });
  const checkB = checkTutorCandidate({ rawOutput: rawB, allowedFocusIds: focus, phase: 1, triggerType: caseItem.triggerType, studentMessage: caseItem.studentMessage });
  const [candidateA, candidateB] = await Promise.all([
    db.tutorCandidate.create({ data: { caseId: caseItem.id, generationRunId: run.id, slot: 'A', attempt: 1, provider: 'openai', modelFamily: 'openai', externalModelId: 'gpt-test', modelVersionTag: 'gpt-test', rawOutput: rawA, normalizedOutput: JSON.stringify(checkA.normalized), deterministicCheckJson: JSON.stringify(checkA.check), critiqueJson: JSON.stringify({ issues: [] }), promptSha256: caseItem.promptSha256 } }),
    db.tutorCandidate.create({ data: { caseId: caseItem.id, generationRunId: run.id, slot: 'B', attempt: 1, provider: 'deepseek', modelFamily: 'deepseek', externalModelId: 'deepseek-test', modelVersionTag: 'deepseek-test', rawOutput: rawB, normalizedOutput: JSON.stringify(checkB.normalized), deterministicCheckJson: JSON.stringify(checkB.check), critiqueJson: JSON.stringify({ issues: [{ quote: '先说说', category: 'pedagogy', message: '确认只有一个核心任务' }] }), promptSha256: caseItem.promptSha256 } }),
  ]);
  await db.tutorReviewTask.create({ data: { caseId: caseItem.id, type: 'EDIT', status: 'PENDING' } });
  await db.tutorTurnCase.update({ where: { id: caseItem.id }, data: { status: 'IN_REVIEW' } });
  check(candidateA.modelFamily !== candidateB.modelFamily, 'A/B 模型家族独立且候选原文分别保存');

  const editPayload = await claimTutorReviewTask('EDIT', annotator);
  check(Boolean(editPayload) && editPayload?.candidates.length === 2, '首次审核员领取并并排查看 A/B');
  await submitEditReview({ taskId: editPayload!.task.id, decision: 'SELECT_B', selectedCandidateId: candidateB.id, finalOutput: candidateB.normalizedOutput, reason: 'B 更具体回应纸桥形状，且没有泛化表扬。', preferenceRejectedCandidateId: candidateA.id, preferenceReason: 'B 直接回应学生观察并聚焦一个问题；A 有模板化表扬。', user: annotator });
  let confirmPayload = await claimTutorReviewTask('CONFIRM', reviewer);
  check(Boolean(confirmPayload) && !('modelFamily' in (confirmPayload!.candidates[0] as object)), '最终确认隐藏候选模型身份');
  await db.tutorReviewTask.update({ where: { id: confirmPayload!.task.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
  const reclaimedConfirm = await claimTutorReviewTask('CONFIRM', reviewer);
  check(reclaimedConfirm?.task.id === confirmPayload!.task.id, '过期的 IN_PROGRESS 最终确认任务可以重新领取');
  confirmPayload = reclaimedConfirm;
  check(confirmPayload!.warnings.every((warning) => warning.candidateId && warning.candidateSlot && warning.source), 'warning 明确标注候选槽位与检查来源');
  const structuredClosures = Object.fromEntries(confirmPayload!.warnings.map((warning) => [warning.id, { detectorVerdict: 'FALSE_POSITIVE', note: '集成测试人工核实。' }]));
  let reasonBlocked = false;
  try { await submitConfirmReview({ taskId: confirmPayload!.task.id, decision: 'CONFIRM', reason: '', warningClosures: structuredClosures, user: reviewer }); } catch (error) { reasonBlocked = error instanceof Error && error.message.includes('必须填写决定理由'); }
  check(reasonBlocked, '最终确认无论决定为何都必须填写独立理由');
  let warningBlocked = false;
  try { await submitConfirmReview({ taskId: confirmPayload!.task.id, decision: 'CONFIRM', reason: '仍在逐项核验。', warningClosures: {}, user: reviewer }); } catch (error) { warningBlocked = error instanceof Error && error.message.includes('自动检测信号'); }
  check(warningBlocked, 'warning 未完成人工判断时阻断正式审核');
  const firstWarningId = confirmPayload!.warnings.find((warning) => warning.candidateId === candidateB.id)?.id;
  if (firstWarningId) {
    const previewOriginal = await previewTutorConfirmFinal({ taskId: confirmPayload!.task.id, finalOutput: candidateB.normalizedOutput, user: reviewer });
    const previewEdited = await previewTutorConfirmFinal({ taskId: confirmPayload!.task.id, finalOutput: JSON.stringify({ dialogue: '请先说清你最想改变哪一个纸桥结构特点？', interactionType: 'clarification', focus: focus[0], hints: [] }), user: reviewer });
    check(previewOriginal.relations[firstWarningId] === 'PRESENT_IN_FINAL' && previewEdited.relations[firstWarningId] === 'REMOVED_BY_EDIT', 'Reviewer 编辑结构化草稿时 warning 与最终稿关系实时重算');
  }
  let finalBlocking = false;
  if (firstWarningId) {
    const blockingClosures = { ...structuredClosures, [firstWarningId]: { detectorVerdict: 'CORRECT', finalSeverity: 'BLOCKING', note: '模拟最终稿仍有严重问题。' } };
    try { await submitConfirmReview({ taskId: confirmPayload!.task.id, decision: 'CONFIRM', reason: '不应确认。', warningClosures: blockingClosures, user: reviewer }); } catch (error) { finalBlocking = error instanceof Error && error.message.includes('被判定为严重'); }
  }
  check(finalBlocking, '成立且严重的问题仍在最终稿时阻断确认');
  const renewed = await renewTutorReviewLease(confirmPayload!.task.id, reviewer);
  check(Boolean(renewed.leaseExpiresAt) && new Date(renewed.leaseExpiresAt!).getTime() > Date.now() + 29 * 60 * 1000, '当前任务持有人可将审核租约续期 30 分钟');
  const returned = await submitConfirmReview({ taskId: confirmPayload!.task.id, decision: 'RETURN_TUTOR', reason: '导师回复需要收紧为一个明确任务，请沿用上一稿继续修改。', warningClosures: {}, finalOutput: JSON.stringify({ dialogue: '先说明你最想比较的一个纸桥结构特点。', interactionType: 'clarification', focus: focus[0], hints: [] }), user: reviewer });
  check(returned.status === 'RETURNED_TO_ANNOTATOR', 'Reviewer 可将导师回复退回原标注员');
  const returnedEdit = await claimTutorReviewTask('EDIT', annotator);
  check(returnedEdit?.task.id === editPayload!.task.id && returnedEdit.firstReview?.returnReason.includes('收紧为一个明确任务') && Boolean(returnedEdit.firstReview?.draft.finalOutput), '标注员重领退回任务时恢复上一稿和 Reviewer 退回理由');
  await submitEditReview({ taskId: returnedEdit!.task.id, decision: 'EDIT', selectedCandidateId: candidateB.id, finalOutput: JSON.stringify({ dialogue: '先说清你最想改变哪一个纸桥结构特点。', interactionType: 'clarification', focus: focus[0], hints: [] }), reason: '按 Reviewer 意见收紧为一个明确任务。', preferenceRejectedCandidateId: candidateA.id, preferenceReason: 'B 直接回应学生观察并聚焦一个问题；A 有模板化表扬。', user: annotator });
  confirmPayload = await claimTutorReviewTask('CONFIRM', reviewer);
  check(Boolean(confirmPayload) && confirmPayload?.firstReview?.reason.includes('收紧为一个明确任务'), '标注员修订后重新进入定稿队列');
  const reviewerFinal = JSON.stringify({ dialogue: '请先说清你最想改变哪一个纸桥结构特点？', interactionType: 'clarification', focus: focus[0], hints: [] });
  const confirmed = await submitConfirmReview({ taskId: confirmPayload!.task.id, decision: 'CONFIRM', reason: '逐项核验并完成结构化修改。', warningClosures: structuredClosures, finalOutput: reviewerFinal, user: reviewer });
  check(confirmed.status === 'FINALIZED' && confirmed.decision === 'CONFIRM_WITH_EDIT' && confirmed.finalized?.trainingEligibility === 'SFT_ALLOWED', 'Annotator 初审加正式 Human Reviewer 修改后形成可训练 FinalizedTutorTurn');
  if (!confirmed.finalized) throw new Error('最终确认未生成 FinalizedTutorTurn');
  const finalized = confirmed.finalized;
  check(finalized.warningClosureJson.includes('ONLY_UNSELECTED_CANDIDATE') && finalized.warningClosureJson.includes('集成测试人工核实') && finalized.draftProvenance === 'HUMAN' && finalized.humanReviewerId === reviewer.id, '自动关系、人工说明和草稿 provenance 写入最终审计记录');

  const version = `tutor-integration-${suffix}`;
  const releaseResult = await createTutorTurnRelease({ version, finalizedTutorTurnIds: [finalized.id], user: admin });
  const release = await db.datasetRelease.findUniqueOrThrow({ where: { id: releaseResult.releaseId }, include: { items: true } });
  check(release.status === 'FROZEN' && release.items[0].sampleId === null && release.items[0].finalizedTutorTurnId === finalized.id, 'ReleaseItem 只绑定 finalized turn，不复用旧 sample');
  const trainingText = await readFile(release.trainingPath!, 'utf8');
  const trainingRecords = JSON.parse(trainingText) as Array<{ conversations: Array<{ from: string; value: string }> }>;
  const assistantTarget = JSON.parse(trainingRecords[0].conversations.at(-1)!.value) as Record<string, unknown>;
  check(Object.hasOwn(assistantTarget, 'interactionType') && !Object.hasOwn(assistantTarget, 'report_sections') && !Object.hasOwn(assistantTarget, 'data_table_schema'), 'SFT 导出只监督 TutorLanguageResponse，不包含 server artifacts');
  const preferenceText = await readFile(release.preferencePath!, 'utf8');
  check(preferenceText.includes('humanComparisonReason') && preferenceText.includes('B 直接回应学生观察'), 'Preference 仅由明确 chosen/rejected 和人工比较理由产生');

  const orchestrationCompiled = await compileTutorTurnCases({ profile: 'CUSTOM', counts: { 2: 1 }, split: 'PILOT', topicCardIds: [card.id], user: admin });
  const orchestrationCase = orchestrationCompiled.cases[0];
  const orchestrationFocus = (JSON.parse(orchestrationCase.visibleFactsJson) as { allowedFocusIds: string[] }).allowedFocusIds[0];
  let tutorCalls = 0;
  const partial = await generateTutorCandidates({
    caseId: orchestrationCase.id,
    modelA: { provider: 'openai', model: 'Qwen3.5-35B-A3B' },
    modelB: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    user: admin,
  }, {
    generateOne: async (_case, config) => {
      tutorCalls += 1;
      return {
        raw: JSON.stringify({ dialogue: config.provider === 'openai' ? '先说清你准备怎样记录一次观察？' : '你打算用什么一致的方法记录观察结果？', interactionType: 'clarification', focus: orchestrationFocus, hints: [] }),
        params: { usage: { totalTokens: 1 } },
      };
    },
    critiqueCandidate: async (input) => {
      if (input.config.provider === 'deepseek') throw new Error('simulated critic failure');
      return { status: 'COMPLETED' as const, issues: [], advisories: [], raw: '{"issues":[]}', critic: { provider: input.config.provider, model: input.config.model, family: 'qwen' }, params: { usage: { totalTokens: 1 } } };
    },
  });
  check(partial.status === 'PARTIAL_FAILED' && partial.canRetryCritics && tutorCalls === 2, 'Critic 失败时 A/B 已持久化且案例进入可重试状态');
  check((await db.tutorCandidate.count({ where: { generationRunId: partial.runId } })) === 2 && (await db.tutorTurnCase.findUniqueOrThrow({ where: { id: orchestrationCase.id } })).status === 'NEEDS_CRITIC', '部分失败保留两个候选且不创建审核队列');
  const retried = await retryTutorCandidateCritics({ caseId: orchestrationCase.id, user: admin }, {
    critiqueCandidate: async (input) => ({ status: 'COMPLETED' as const, issues: [], advisories: [], raw: '{"issues":[]}', critic: { provider: input.config.provider, model: input.config.model, family: input.config.provider }, params: { usage: { totalTokens: 1 } } }),
  });
  check(retried.status === 'COMPLETED' && tutorCalls === 2 && (await db.tutorTurnCase.findUniqueOrThrow({ where: { id: orchestrationCase.id } })).status === 'IN_REVIEW', '仅重试失败 Critic，不重复调用 Tutor，并恢复首次审核任务');

  const caseEditPayload = await claimTutorReviewTask('EDIT', annotator);
  const caseEditCandidate = caseEditPayload!.candidates[0];
  await submitEditReview({ taskId: caseEditPayload!.task.id, decision: caseEditCandidate.slot === 'A' ? 'SELECT_A' : 'SELECT_B', selectedCandidateId: caseEditCandidate.id, finalOutput: caseEditCandidate.normalizedOutput, reason: '先形成可供 Reviewer 判断的 Tutor 草稿。', user: annotator });
  const caseConfirmPayload = await claimTutorReviewTask('CONFIRM', reviewer);
  const caseReturn = await submitConfirmReview({
    taskId: caseConfirmPayload!.task.id,
    decision: 'RETURN_CASE',
    reason: '学生问题表达不自然，需要管理员审批改写。',
    warningClosures: {},
    caseIssue: { categories: ['UNNATURAL_STUDENT_MESSAGE'], suggestedStudentMessage: '我还没有想清楚怎样记录每一次观察结果。', note: '原表达过于像测试模板。' },
    user: reviewer,
  });
  check(caseReturn.status === 'CASE_NEEDS_REVISION' && (await listTutorCaseQualityTasks()).some((item) => item.caseId === orchestrationCase.id), 'Reviewer 可把学生案例问题独立提交管理员队列');
  const caseTask = (await listTutorCaseQualityTasks()).find((item) => item.caseId === orchestrationCase.id)!;
  const revisedCaseResult = await resolveTutorCaseQualityTask({ taskId: caseTask.id, decision: 'APPROVE_REVISION', studentMessage: '我还没有想清楚怎样记录每一次观察结果。', reason: '批准自然化改写并重建 Prompt。', user: admin });
  const revisedCase = await db.tutorTurnCase.findUniqueOrThrow({ where: { id: revisedCaseResult.caseId } });
  check(revisedCase.revision === 2 && revisedCase.revisionOfId === orchestrationCase.id && revisedCase.status === 'READY' && (await db.tutorCandidate.count({ where: { caseId: revisedCase.id } })) === 0 && (await db.tutorTurnCase.findUniqueOrThrow({ where: { id: orchestrationCase.id } })).status === 'SUPERSEDED', '管理员批准学生问题修改后创建新 revision 且不复用旧 A/B');

  const aiCompiled = await compileTutorTurnCases({ profile: 'CUSTOM', counts: { 1: 1 }, split: 'TRAIN', topicCardIds: [card.id], reviewPolicy: 'AI_DIRECT_TO_REVIEWER', user: admin });
  const aiCase = aiCompiled.cases[0];
  const aiFocus = (JSON.parse(aiCase.visibleFactsJson) as { allowedFocusIds: string[] }).allowedFocusIds[0];
  await generateTutorCandidates({ caseId: aiCase.id, modelA: { provider: 'openai', model: 'ai-a' }, modelB: { provider: 'deepseek', model: 'ai-b' }, user: admin }, {
    generateOne: async (_case, config) => ({ raw: JSON.stringify({ dialogue: config.provider === 'openai' ? '先描述你最想比较的一个纸桥结构变化。' : '你准备先研究纸桥结构的哪一个具体变化？', interactionType: 'clarification', focus: aiFocus, hints: [] }), params: { usage: { totalTokens: 1 } } }),
    critiqueCandidate: async (input) => ({ status: 'COMPLETED' as const, issues: [], advisories: [], raw: '{"issues":[]}', critic: { provider: input.config.provider, model: input.config.model, family: input.config.provider }, params: { usage: { totalTokens: 1 } } }),
  });
  const aiDraft = await generateAiAssistedTutorDraft({ caseId: aiCase.id, provider: 'deepseek', model: 'mock-curator', user: admin }, {
    complete: async () => ({
      content: JSON.stringify({ selectedSlot: 'A', finalOutput: { dialogue: '先描述你最想比较的一个纸桥结构变化。', interactionType: 'clarification', focus: aiFocus, hints: [] }, reason: 'A 更开放且没有替学生决定具体结构。', preferenceRejectedSlot: 'B', preferenceReason: 'A 保留学生选择结构变化的空间；B 更直接限定研究对象。' }),
      finishReason: 'stop', reasoningChars: 0, usage: { totalTokens: 1 }, request: { jsonFormat: true, maxTokens: 1800, timeoutMs: 1, thinking: null, reasoningEffort: null },
    }),
  });
  check(aiDraft.status === 'AWAITING_CONFIRMATION' && aiDraft.selectedSlot === 'A', '平台 AI Curator 可生成结构化建议稿并按授权直送 Reviewer');
  const aiConfirm = await claimTutorReviewTask('CONFIRM', reviewer);
  const aiClosures = Object.fromEntries(aiConfirm!.warnings.map((warning) => [warning.id, { detectorVerdict: 'FALSE_POSITIVE', note: '集成测试核实。' }]));
  const aiFinalized = await submitConfirmReview({ taskId: aiConfirm!.task.id, decision: 'CONFIRM', reason: '正式 Human Reviewer 核验通过。', warningClosures: aiClosures, user: reviewer });
  check(aiFinalized.finalized?.draftProvenance === 'AI_DIRECT_ADMIN_AUTHORIZED' && aiFinalized.finalized.trainingEligibility === 'SFT_ALLOWED', '管理员逐批授权后 AI 初审可直送，但仍需 Human Reviewer 才可训练');
  const pilotFinal = await db.finalizedTutorTurn.create({ data: {
    caseId: orchestrationCase.id,
    finalOutputJson: JSON.stringify({ dialogue: '请先说清你准备怎样记录一次观察。', interactionType: 'clarification', focus: orchestrationFocus, hints: [] }),
    editMetricsJson: JSON.stringify({ type: 'NO_CHANGE', ratio: 0, distance: 0 }),
    firstReviewerId: annotator.id, secondReviewerId: reviewer.id,
    trainingEligibility: 'SFT_ALLOWED', eligibilityReasonJson: '[]', contentSha256: `pilot-${suffix}`,
  } });
  let pilotReleaseBlocked = false;
  try { await createTutorTurnRelease({ version: `pilot-block-${suffix}`, finalizedTutorTurnIds: [pilotFinal.id], user: admin }); } catch { pilotReleaseBlocked = true; }
  check(pilotReleaseBlocked, 'PILOT 即使误标 SFT_ALLOWED 也不能创建 Tutor Release');
  const legacyRevision = await createTopicCardRevision(card.id, admin);
  check(legacyRevision.schemaVersion === 2 && legacyRevision.status === 'DRAFT' && (await db.tutorTurnCase.count({ where: { topicCardId: card.id } })) > 0, '已使用的 V1 TopicCard 可创建独立 V2 草稿且不复用旧案例');

  await db.modelDeployment.updateMany({ where: { environment: 'PRODUCTION', status: 'ACTIVE' }, data: { status: 'COMPLETED', endedAt: new Date() } });
  const baseline = await db.modelVersion.create({ data: { tag: `baseline-${suffix}`, provider: 'openai', externalModelId: 'baseline', promptPolicyVersion: 'tutor-language-prompt-v1', contractVersion: 'tutor-language-v1', status: 'DEPLOYED', createdById: admin.id } });
  await db.modelDeployment.create({ data: { modelVersionId: baseline.id, environment: 'PRODUCTION', rolloutPercent: 100, status: 'ACTIVE', startedAt: new Date() } });
  const trainingRun = await createTrainingRun({ name: `training-${suffix}`, releaseId: release.id, baseModel: baseline.externalModelId, status: 'SUCCEEDED', parentModelVersionId: baseline.id, user: admin });
  const candidateModel = await registerModelVersion({ tag: `candidate-${suffix}`, provider: 'deepseek', externalModelId: 'candidate', parentModelVersionId: baseline.id, trainingRunId: trainingRun.id, status: 'TRAINED', createdById: admin.id });
  const phaseSummary = Object.fromEntries([1, 2, 3, 4, 5, 6].map((phase) => [String(phase), { A: 1, B: 2, tie: 0, inconsistent: 0, criticalErrors: 0, parseSuccessA: 9, parseTotalA: 10, parseSuccessB: 10, parseTotalB: 10 }]));
  await importEvaluation({ name: `evaluation-${suffix}`, user: admin, files: [
    { fileName: 'baseline-transcript.json', raw: JSON.stringify({ schemaVersion: 4, tag: baseline.tag, scope: 'all', scenarios: [{ scenarioId: 'P1-1', phase: 1 }] }) },
    { fileName: 'candidate-transcript.json', raw: JSON.stringify({ schemaVersion: 4, tag: candidateModel.tag, scope: 'all', scenarios: [{ scenarioId: 'P1-1', phase: 1 }] }) },
    { fileName: 'verdict.json', raw: JSON.stringify({ schemaVersion: 4, tags: { A: baseline.tag, B: candidateModel.tag }, scope: 'all', summary: { phase: phaseSummary, criticalErrors: 0 } }) },
  ] });
  check((await db.modelVersion.findUniqueOrThrow({ where: { id: candidateModel.id } })).status === 'ELIGIBLE', '离线评测按阶段门禁通过后模型变为 ELIGIBLE');
  const deployment10 = await createOrPromoteDeployment({ modelVersionId: candidateModel.id, rolloutPercent: 10, adminId: admin.id });
  check(deployment10.rolloutPercent === 10, '候选模型从 10% 灰度开始');
  await db.modelDeployment.update({ where: { id: deployment10.id }, data: { startedAt: new Date(Date.now() - 96 * 3_600_000) } });
  await updateDeploymentObservation({ deploymentId: deployment10.id, adminId: admin.id, observation: { sessions: 60, criticalErrors: 0, structureFailureRate: 0.01, baselineStructureFailureRate: 0.01, teacherRejectRate: 0.1, baselineTeacherRejectRate: 0.1, earlyTerminationRate: 0.1, baselineEarlyTerminationRate: 0.1 } });
  const deployment30 = await createOrPromoteDeployment({ modelVersionId: candidateModel.id, rolloutPercent: 30, adminId: admin.id });
  await db.modelDeployment.update({ where: { id: deployment30.id }, data: { startedAt: new Date(Date.now() - 96 * 3_600_000) } });
  await updateDeploymentObservation({ deploymentId: deployment30.id, adminId: admin.id, observation: { sessions: 160, criticalErrors: 0, structureFailureRate: 0.01, baselineStructureFailureRate: 0.01, teacherRejectRate: 0.1, baselineTeacherRejectRate: 0.1, earlyTerminationRate: 0.1, baselineEarlyTerminationRate: 0.1 } });
  const deployment100 = await createOrPromoteDeployment({ modelVersionId: candidateModel.id, rolloutPercent: 100, adminId: admin.id });
  check(deployment100.rolloutPercent === 100, '满足 48h/50 与 72h/150 线上门禁后完成 10→30→100 灰度');

  await rm(path.join(process.cwd(), 'data', 'releases', version), { recursive: true, force: true });
  console.log(`\nTutor bootstrap integration tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
