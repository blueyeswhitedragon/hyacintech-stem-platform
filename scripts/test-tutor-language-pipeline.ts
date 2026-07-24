#!/usr/bin/env tsx
import type { TopicCard } from '@prisma/client';
import { buildTutorLanguagePrompt, DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION, parseTutorLanguageResponse, toCompatibleChatResponse, TUTOR_LANGUAGE_PROMPT_V1, TUTOR_LANGUAGE_PROMPT_V2, TUTOR_LANGUAGE_PROMPT_V2_1, TUTOR_LANGUAGE_PROMPT_V2_2, TUTOR_LANGUAGE_PROMPT_V2_3, tutorSftTarget } from '../app/lib/tutorLanguage';
import { applyDeterministicExtractionFallbacks, buildServerExperimentPlan, ensureExplicitConfirmationFact, mergeExtractedFacts, validateExtractedFacts, type ExtractedFact } from '../app/lib/stateExtractor';
import { attachServerOwnedArtifacts, tutorFocusPlan, updateServerAnalysis, visibleDataRows } from '../app/lib/serverTutorState';
import { assertIndependentModelFamilies, buildCaseTutorPrompt, casePromptLeaksPrivate, checkTutorCandidate, tutorTargetContainsServerArtifact, validateTutorCritiqueIssues } from '../app/lib/dataLab/bootstrap/contracts';
import { assertReleaseItemSource, computeEditMetrics, shingleJaccard, tutorTopicCardDiversityFailures } from '../app/lib/dataLab/bootstrap/service';
import { isTutorWarningClosed, sanitizeTutorWarningClosures, tutorWarningBlocksFinal } from '../app/lib/dataLab/bootstrap/warningClosure';
import { evaluateDeploymentGate, evaluateOnlineObservationGate } from '../app/lib/deploymentGate';
import { resolveChatContractBranch } from '../app/lib/tutorTurn';
import { CALIBRATION_12_SCENARIOS, compileCases, compileOneCase, compileScenarioCases, EVAL_CASE_COUNTS, SMOKE_6_SCENARIOS } from '../app/lib/dataLab/bootstrap/caseCompiler';

let passed = 0; let failed = 0;
function check(condition: unknown, label: string) { if (condition) { passed++; console.log(`PASS ${label}`); } else { failed++; console.error(`FAIL ${label}`); } }
function throws(fn: () => unknown, label: string) { try { fn(); check(false, label); } catch { check(true, label); } }

const privateSpec = { internalArchetype: '高概念降级型-火星基地植物', acceptableDirections: ['只给 Critic 的方向一', '只给 Critic 的方向二'], forbiddenMoves: ['复制固定答案'] };
const prompt = buildCaseTutorPrompt({ phase: 1, triggerType: 'USER_MESSAGE', visibleFacts: { 学生开场: '我对封闭环境里的植物感兴趣' }, allowedFocusIds: ['research_question'] });
check(casePromptLeaksPrivate(prompt, privateSpec).length === 0, 'Tutor Prompt 不含 private spec、acceptable directions 和 internal archetype');
check(!buildTutorLanguagePrompt({ phase: 1, triggerType: 'USER_MESSAGE', visibleFacts: { internalArchetype: 'secret', privateReviewSpec: 'secret2', 可见: 'ok' }, allowedFocusIds: ['research_question'] }).includes('secret'), '可见事实清洗移除内部键');
const promptInput = { phase: 2, triggerType: 'USER_MESSAGE', visibleFacts: { 已确认: '通风方式' }, allowedFocusIds: ['controls'], focusDescriptions: { controls: '只澄清保持一致的条件' } };
const explicitV1 = buildTutorLanguagePrompt(promptInput, TUTOR_LANGUAGE_PROMPT_V1);
const defaultPrompt = buildTutorLanguagePrompt(promptInput);
const promptV2 = buildTutorLanguagePrompt(promptInput, TUTOR_LANGUAGE_PROMPT_V2);
const promptV21 = buildTutorLanguagePrompt(promptInput, TUTOR_LANGUAGE_PROMPT_V2_1);
const promptV22 = buildTutorLanguagePrompt(promptInput, TUTOR_LANGUAGE_PROMPT_V2_2);
const promptV23 = buildTutorLanguagePrompt(promptInput, TUTOR_LANGUAGE_PROMPT_V2_3);
check(explicitV1 === defaultPrompt, '生产默认 Prompt 保持 v1 且显式 v1 输出一致');
check(promptV2 !== explicitV1 && promptV2.includes('唯一事实来源') && promptV2.includes('最多一个问句'), 'Data Lab Prompt v2 版本隔离并包含单任务与事实来源约束');
check(promptV21 !== promptV2 && promptV21.includes('答案菜单'), 'Data Lab Prompt v2.1 追加答案菜单约束且不改写 v2');
check(promptV22.includes('阶段边界是硬合同'), 'Data Lab 历史 v2.2 Prompt 保持可重放');
check(DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION === TUTOR_LANGUAGE_PROMPT_V2_3 && promptV23.includes('已经满足的字段不得重新追问'), 'Data Lab 默认使用独立 v2.3 候选并阻止重复追问');
const gluedTutorJson = parseTutorLanguageResponse('{"dialogue":"先说说你最想观察什么？","interactionType":"open_questionfocus":"research_question","hints":[]}', ['research_question']);
check(gluedTutorJson?.interactionType === 'open_question' && gluedTutorJson.focus === 'research_question', 'Tutor parser 可确定性修复 interactionType 与 focus 字段粘连');

const compilerCard: TopicCard = {
  id: 'topic-1', displayTitle: '怎样让纸桥承受更多书本', studentOpening: '我搭纸桥时发现有的形状很容易塌。',
  internalArchetype: 'engineering_fuzzy', subject: 'engineering', gradeBand: '初中', coreMechanism: '结构形状会改变承重表现',
  acceptableDirectionsJson: JSON.stringify(['比较不同折叠截面的承重', '比较桥面层数与承重']),
  forbiddenDirectionsJson: JSON.stringify(['危险切割']), curriculumAnchorsJson: JSON.stringify(['结构稳定性']),
  sourceJson: '{}', compilerEvidenceJson: '{}', schemaVersion: 1, revision: 1, revisionOfId: null, activityMode: '', contextModule: '', disciplineAnchorsJson: '[]',
  authenticNeed: '', stakeholder: '', engineeringGoal: '', constraintsJson: '[]', performanceCriteriaJson: '[]', inquiryBridgesJson: '[]', sourceCandidateId: null,
  status: 'APPROVED', rejectionReason: '', createdById: null, approvedById: null, approvedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
};
const challengeCases = compileCases([compilerCard], { 1: 6, 2: 6, 4: 6 }, 'PILOT');
for (const phase of [1, 2, 4]) {
  const phaseCases = challengeCases.filter((item) => item.phase === phase);
  check(new Set(phaseCases.map((item) => item.studentMessage)).size === 6, `P${phase} 六种 challenge 均有不同的学生可见表达`);
  check(phaseCases.every((item) => item.hardCheck.errors.length === 0), `P${phase} 主题化案例不泄漏私有审核规范`);
}

const smokeCards: TopicCard[] = [
  compilerCard,
  { ...compilerCard, id: 'topic-high', subject: 'high_concept_interdisciplinary', displayTitle: '封闭空间里的植物', acceptableDirectionsJson: JSON.stringify(['比较通风与叶片状态', '比较光照与生长状态']) },
  { ...compilerCard, id: 'topic-bio', subject: 'biology_ecology', displayTitle: '窗边叶片变化' },
  { ...compilerCard, id: 'topic-chem', subject: 'chemistry', displayTitle: '厨房材料溶解' },
  { ...compilerCard, id: 'topic-physics', subject: 'physics', displayTitle: '纸飞机飞行' },
];
const smokeCases = compileScenarioCases(smokeCards, SMOKE_6_SCENARIOS, 'PILOT');
check(smokeCases.length === 6 && smokeCases.every((item) => item.promptVersion === DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION), 'Smoke 6 固定生成六条 Prompt v2 案例');
check(new Set(smokeCases.map((item) => item.studentMessage)).size === 6 && smokeCases.every((item) => item.hardCheck.errors.length === 0), 'Smoke 6 学生消息无 exact duplicate 且无私有泄漏');
check(smokeCases.find((item) => item.challenge === '高概念代理')?.topicCardId === 'topic-high', 'Smoke 高概念代理只使用匹配领域 TopicCard');
const calibrationCases = compileScenarioCases(smokeCards, CALIBRATION_12_SCENARIOS, 'PILOT');
check(calibrationCases.length === 12 && [1, 2, 4].every((phase) => calibrationCases.filter((item) => item.phase === phase).length === 4), 'Calibration 12 固定覆盖 P1/P2/P4 各四条');
check(new Set(calibrationCases.map((item) => item.studentMessage)).size === 12 && calibrationCases.every((item) => item.hardCheck.errors.length === 0), 'Calibration 12 无 exact duplicate 且不泄漏私有规范');
const variableGapCase = compileOneCase({ card: compilerCard, phase: 2, challenge: '变量不完整', variant: 0, split: 'PILOT', promptVersion: DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION });
check((variableGapCase.visibleFacts as { allowedFocusIds?: string[] }).allowedFocusIds?.[0] === 'independent_variable' && variableGapCase.systemPrompt.includes('不补齐测量、控制变量或后续方案'), 'P2 变量不完整映射到 independent_variable 而不是 measurement');
const p2Coverage = compileCases([compilerCard], { 2: 12 }, 'PILOT');
check(new Set(p2Coverage.flatMap((item) => (item.visibleFacts as { allowedFocusIds: string[] }).allowedFocusIds)).size === 8, 'P2 编译覆盖七项科学核心和方案确认，操作字段由服务器组装');
const bridge = {
  label: '纸桥结构', retainedFeature: '结构影响承重', researchQuestion: '不同折叠结构怎样影响纸桥承重？', factor: '折叠结构', phenomenon: '承重数量',
  testScaffold: { levels: ['平板', '三角折叠'], measurement: '逐本增加相同课本并记录最大本数', unit: '本', metricKind: 'COUNT', controlledConditions: ['纸张大小', '桥墩距离'] },
};
const v2CompilerCard: TopicCard = {
  ...compilerCard,
  id: 'topic-v2', schemaVersion: 2, activityMode: 'SCIENTIFIC_INQUIRY', contextModule: 'DAILY_LIFE',
  authenticNeed: '让纸桥更稳', disciplineAnchorsJson: JSON.stringify(['ENGINEERING_TECHNOLOGY']),
  inquiryBridgesJson: JSON.stringify([bridge, { ...bridge, label: '桥面层数', researchQuestion: '桥面层数怎样影响纸桥承重？', factor: '桥面层数', testScaffold: { ...bridge.testScaffold, levels: ['一层', '两层'] } }]),
};
const p2BridgeCase = compileOneCase({ card: v2CompilerCard, phase: 2, challenge: '变量不完整', variant: 0, split: 'PILOT', promptVersion: DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION });
const p2BridgeState = JSON.stringify(p2BridgeCase.stageState);
check(!p2BridgeState.includes('真实需求') && !p2BridgeState.includes('核心机制') && !p2BridgeState.includes('拟改变因素') && !p2BridgeState.includes('关注现象'), 'P2 可见状态不直接泄漏 TopicCard 桥接答案');
const p2ConfirmationCase = compileOneCase({ card: v2CompilerCard, phase: 2, challenge: '方案确认', variant: 0, split: 'PILOT', promptVersion: DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION });
check(p2ConfirmationCase.history.length === 2 && (p2ConfirmationCase.visibleFacts as { allowedFocusIds: string[] }).allowedFocusIds[0] === 'plan_confirmation', 'P2 确认案例用历史支撑服务器预览并强制 plan_confirmation');

const facts: ExtractedFact[] = [
  { field: 'stage1.researchQuestion', value: '不同光照时长会不会影响幼苗高度？', sourceQuote: '不同光照时长会不会影响幼苗高度' },
  { field: 'stage1.factorDirection', value: '光照时长', sourceQuote: '光照时长' },
  { field: 'stage1.phenomenonDirection', value: '幼苗高度', sourceQuote: '幼苗高度' },
  { field: 'stage1.confirmed', value: true, sourceQuote: '我确认按这个问题做' },
  { field: 'stage2.repeatCount', value: 3, sourceQuote: '我确认按这个问题做' },
  { field: 'stage1.classroomProxy', value: '导师编造的内容', sourceQuote: '导师说可以用LED' },
];
const studentMessages = ['我想研究不同光照时长会不会影响幼苗高度，我确认按这个问题做。'];
const validated = validateExtractedFacts(1, facts, studentMessages);
check(validated.accepted.length === 2, 'P1 Extractor 只接受研究问题与显式确认，不接受阶段2方向字段');
check(validated.rejected.some((item) => item.reason === 'FIELD_NOT_ALLOWED_FOR_STAGE'), 'Extractor 拒绝跨阶段字段');
check(validated.rejected.some((item) => item.reason === 'SOURCE_QUOTE_NOT_FOUND_IN_STUDENT_MESSAGES'), 'Extractor 不把 Tutor 历史当事实来源');
const emptyLists = validateExtractedFacts(2, [
  { field: 'stage2.controlledVariables', value: [], sourceQuote: '没有其他控制条件' },
  { field: 'stage2.safetyNotes', value: [], sourceQuote: '安全事项还没想好' },
], ['没有其他控制条件，安全事项还没想好。']);
check(emptyLists.accepted.length === 1 && emptyLists.accepted[0].field === 'stage2.controlledVariables', 'Extractor 只接受学生明确回答“无”的空列表');
check(emptyLists.rejected[0]?.reason === 'EMPTY_LIST_NOT_EXPLICIT', 'Extractor 拒绝把未回答误提取为空控制或空安全');
const deterministicConfirmation = ensureExplicitConfirmationFact(1, validated.accepted.filter((item) => item.field !== 'stage1.confirmed'), '我确认按这个问题做。');
check(deterministicConfirmation.applied && deterministicConfirmation.accepted.some((item) => item.field === 'stage1.confirmed' && item.sourceQuote === '我确认按这个问题做'), 'Extractor 漏提取时由学生本轮明确确认短语确定性补齐');
const deterministicPlanConfirmation = ensureExplicitConfirmationFact(2, [], '我同意按这个方案做。');
check(!deterministicPlanConfirmation.applied && deterministicPlanConfirmation.accepted.length === 0, 'P2 不再从聊天口头确认冻结方案');
const ambiguousConfirmation = ensureExplicitConfirmationFact(1, [], '这个问题可以研究吗？我还没确定。');
check(!ambiguousConfirmation.applied, '疑问句和未确定表达不会触发确认兜底');
const merged = mergeExtractedFacts(1, {}, validated.accepted);
check(merged.stageData.stage1?.snapshot.startsWith('《探究问题确认书》') && !('advanceTo' in merged), 'P1 事实提取只生成确认书，不抢先推进阶段');
const changedQuestion = mergeExtractedFacts(1, merged.stageData, [{ field: 'stage1.researchQuestion', value: '温度是否影响幼苗高度？', sourceQuote: '温度是否影响幼苗高度' }], { currentStudentMessage: '我改成温度是否影响幼苗高度？' });
check(changedQuestion.stageData.stage1?.confirmed === false && !changedQuestion.stageData.stage1.confirmedQuestionHash, 'P1 研究问题变化会使旧确认失效');
const confirmedFocus = tutorFocusPlan(1, merged.stageData);
check(confirmedFocus.allowedFocusIds.length === 1 && confirmedFocus.allowedFocusIds[0] === 'direction_confirmation', 'P1 已确认后只允许确认书交接，不继续追问阶段1或阶段2信息');

const language = parseTutorLanguageResponse('{"dialogue":"请核对确认书中的研究问题是否准确。","interactionType":"checkpoint","focus":"direction_confirmation","hints":[]}', ['direction_confirmation'], 1);
check(Boolean(language), 'tutor-language-v1 严格解析成功');
check(!parseTutorLanguageResponse('{"dialogue":"请核对研究问题。","interactionType":"information","focus":"direction_confirmation","hints":[]}', ['direction_confirmation'], 1), 'P1 确认 focus 强制使用 checkpoint');
check(!parseTutorLanguageResponse('{"dialogue":"接下来准备用什么材料和测量方式？","interactionType":"clarification","focus":"research_question","hints":[]}', ['research_question'], 1), 'P1 解析层拒绝越界追问实验设计');
check(!parseTutorLanguageResponse('{"dialogue":"你最终要比较哪些光照时长？","interactionType":"clarification","focus":"measurement","hints":[]}', ['measurement'], 2, { completedFocusIds: ['levels'], planReady: false }), 'P2 解析层拒绝 focus 不匹配并重开已完成水平');
check(!parseTutorLanguageResponse('{"dialogue":"这四组就是你最终要比较的全部条件了吗？","interactionType":"clarification","focus":"measurement","hints":[]}', ['measurement'], 2, { completedFocusIds: ['levels'], planReady: false }), 'P2 解析层拒绝继续确认已经充分的实验组');
check(!parseTutorLanguageResponse('{"dialogue":"方案还差测量方式，不过现在可以开始实验了。","interactionType":"clarification","focus":"measurement","hints":[]}', ['measurement'], 2, { planReady: false }), 'P2 方案未就绪时拒绝提前宣布开始实验');
const compatible = toCompatibleChatResponse(language!, { nextActionType: 'confirmation', phaseComplete: true, artifacts: { stage1_confirmed: true, snapshot: merged.stageData.stage1?.snapshot } });
check(compatible.stage1_confirmed === true && compatible.tutor_language?.focus === 'direction_confirmation', '服务端映射为兼容 ChatResponse 并附加产物');

const completePlanState = {
  ...merged.stageData,
  extractedFacts: {
    ...merged.stageData.extractedFacts,
    'stage2.hypothesis': { value: '光照越长幼苗越高', sourceQuote: '光照越长幼苗越高' },
    'stage2.independentVariable.name': { value: '光照时长', sourceQuote: '光照时长' },
    'stage2.independentVariable.levels': { value: ['4小时', '8小时'], sourceQuote: '4小时和8小时' },
    'stage2.dependentVariable.name': { value: '幼苗高度', sourceQuote: '幼苗高度' },
    'stage2.dependentVariable.measurement': { value: '用直尺测量', sourceQuote: '用直尺测量' },
    'stage2.controlledVariables': { value: [], sourceQuote: '没有其他控制条件' },
    'stage2.materials': { value: ['幼苗', '直尺'], sourceQuote: '幼苗和直尺' },
    'stage2.procedure': { value: ['分组照光', '测量高度'], sourceQuote: '分组照光并测量高度' },
    'stage2.repeatCount': { value: 3, sourceQuote: '重复3次' },
    'stage2.safetyNotes': { value: [], sourceQuote: '没有特别安全事项' },
  },
};
check(Boolean(buildServerExperimentPlan(completePlanState)), 'P2 显式确认空控制/安全后仍可形成完整方案');
const numericFallback = applyDeterministicExtractionFallbacks(2, [], '0、8、12、24小时四组');
check(JSON.stringify(numericFallback.accepted[0]?.value) === JSON.stringify(['0小时', '8小时', '12小时', '24小时']), 'P2 短数字回答确定性识别为带共享单位的实验水平');
const repeatFallback = applyDeterministicExtractionFallbacks(2, [], '每组10颗取平均值，其他都一样');
check(repeatFallback.accepted.some((item) => item.field === 'stage2.repeatCount' && item.value === 10) && repeatFallback.accepted.some((item) => item.field === 'stage2.controlledVariables'), 'P2 重复次数和通用控制条件有确定性 fallback');
check(!tutorTargetContainsServerArtifact(JSON.stringify(tutorSftTarget(compatible))), 'Server artifact 不进入 Tutor SFT target');
check(tutorTargetContainsServerArtifact(JSON.stringify(compatible)), '完整兼容响应可识别为含 server artifacts');

check(resolveChatContractBranch('stage-contract-v2', 'stage-contract-v2') === 'LEGACY_STAGE_CONTRACT', '旧会话仍按旧合同恢复和继续');
check(resolveChatContractBranch('tutor-language-v1', 'tutor-language-v1') === 'TUTOR_LANGUAGE_V1', '新会话只使用 tutor-language-v1');
throws(() => resolveChatContractBranch('stage-contract-v2', 'tutor-language-v1'), '旧会话不能被静默切换到新合同');
throws(() => assertIndependentModelFamilies({ provider: 'openai', model: 'gpt-4o' }, { provider: 'openai', model: 'gpt-4.1' }), 'A/B 相同模型家族时阻断');
check(assertIndependentModelFamilies({ provider: 'openai', model: 'gpt-4o' }, { provider: 'deepseek', model: 'deepseek-v4-pro' }).familyA !== 'deepseek', '不同模型家族允许生成');
check(assertIndependentModelFamilies({ provider: 'openai', model: 'Qwen3.5-35B-A3B' }, { provider: 'deepseek', model: 'deepseek-v4-pro' }).familyA === 'qwen', 'OpenAI 兼容端点上的 Qwen 仍记录为 qwen 模型家族');
const critiqueValidation = validateTutorCritiqueIssues([
  { quote: '水温', category: 'grounding', message: '无来源事实', sourceQuote: '只比较通风方式', confidence: 'high' },
  { quote: '不存在片段', category: 'pedagogy', message: '无法定位', sourceQuote: '', confidence: 'high' },
  { quote: '先固定材料数量', category: 'pedagogy', message: '可更简洁', sourceQuote: '', confidence: 'medium' },
], '请先固定材料数量，避免自行加入水温。', '学生说：只比较通风方式');
check(critiqueValidation.blocking.length === 1 && critiqueValidation.advisories.length === 2, 'Critic 仅将可定位且有可见证据的 high 问题转为 blocking warning');
const goodRaw = '{"dialogue":"你提到结果还不够具体。先说说你准备怎样记录一次观察？","interactionType":"clarification","focus":"measurement","hints":[]}';
const checked = checkTutorCandidate({ rawOutput: goodRaw, allowedFocusIds: ['measurement'], phase: 2, triggerType: 'USER_MESSAGE', studentMessage: '我还没想好怎么记录' });
const before = checked.normalized?.dialogue;
const critique = { issues: [{ quote: '怎样记录', message: '可更具体' }] };
check(checked.normalized?.dialogue === before && critique.issues.length === 1, 'critique 独立保存且不修改候选原文、不会自动提升资格');
const hidden = checkTutorCandidate({ rawOutput: '{"dialogue":"你最想保留哪个环境特点？","interactionType":"open_question","focus":"research_question","hints":["可以想想光照、大气、土壤"]}', allowedFocusIds: ['research_question'], phase: 1, triggerType: 'USER_MESSAGE', studentMessage: '我想研究基地植物' });
check(hidden.check.issues.some((item) => item.code === 'HIDDEN_HINT_MENU'), '发现 hints 中“光照、大气、土壤”隐藏菜单');
const compoundHint = checkTutorCandidate({ rawOutput: '{"dialogue":"同时改变多个条件会让原因难以判断。你怎么看？","interactionType":"open_question","focus":"controls","hints":["试着设想一下：如果一次只改动一个条件，其他条件保持不变，结果会更容易解释吗？"]}', allowedFocusIds: ['controls'], phase: 2, triggerType: 'USER_MESSAGE', studentMessage: '我想同时改三个条件' });
check(!compoundHint.check.issues.some((item) => item.code === 'HIDDEN_HINT_MENU'), '普通逗号复句不会被误判为隐藏答案菜单');
const controlRestatement = checkTutorCandidate({ rawOutput: '{"dialogue":"如果同时移动光源、增加材料数量、又改变记录时间，我们怎么知道是哪一项起了作用？","interactionType":"open_question","focus":"controls","hints":[]}', allowedFocusIds: ['controls'], phase: 2, triggerType: 'USER_MESSAGE', studentMessage: '我想一边改主要条件，一边也换材料数量和记录时间' });
check(!controlRestatement.check.issues.some((item) => item.code === 'DIALOGUE_ANSWER_MENU'), '复述学生同时改变的多个条件不会被误判为答案菜单');
const listedBeforeChoice = checkTutorCandidate({ rawOutput: '{"dialogue":"形状可以指很多东西：翼尖尖圆、翼展宽窄、折叠角度大小。你想改变的具体是哪一点？","interactionType":"clarification","focus":"independent_variable","hints":[]}', allowedFocusIds: ['independent_variable'], phase: 2, triggerType: 'USER_MESSAGE', studentMessage: '还没说清主动改变哪一个条件' });
check(listedBeforeChoice.check.issues.some((item) => item.code === 'DIALOGUE_ANSWER_MENU'), '识别先列出三个候选再追问学生选择的答案菜单');
const directAlternatives = checkTutorCandidate({ rawOutput: '{"dialogue":"你说的稳定具体是承受重量不塌，还是桥面不晃动，还是别的表现？","interactionType":"clarification","focus":"research_question","hints":[]}', allowedFocusIds: ['research_question'], phase: 1, triggerType: 'USER_MESSAGE', studentMessage: '什么结构最稳' });
check(directAlternatives.check.issues.some((item) => item.code === 'DIALOGUE_ANSWER_MENU'), '识别“具体是 A、还是 B”式直接答案菜单');
const measurementMenu = checkTutorCandidate({ rawOutput: '{"dialogue":"你说的效果具体指什么？比如记录完全溶解所需时间，还是观察相同时间内剩余固体的多少？","interactionType":"clarification","focus":"measurement","hints":[]}', allowedFocusIds: ['measurement'], phase: 2, triggerType: 'USER_MESSAGE', studentMessage: '我只打算记录效果好不好' });
check(measurementMenu.check.issues.some((item) => item.code === 'DIALOGUE_ANSWER_MENU') && !measurementMenu.check.issues.some((item) => item.code === 'MULTIPLE_QUESTION_MARKS'), '多个测量选项优先标记为答案菜单而不是机械的问号计数');
const rhetoricalScaffold = checkTutorCandidate({ rawOutput: '{"dialogue":"别人重复实验时，怎样才能得到同样的判断呢？你打算用什么具体方式记录结果？","interactionType":"clarification","focus":"measurement","hints":[]}', allowedFocusIds: ['measurement'], phase: 2, triggerType: 'USER_MESSAGE', studentMessage: '我只记录效果好不好' });
check(rhetoricalScaffold.check.issues.some((item) => item.code === 'MULTIPLE_QUESTION_MARKS') && !rhetoricalScaffold.check.issues.some((item) => item.code === 'TOO_MANY_QUESTIONS'), '多个问号只记录客观结构信号，不直接断言存在多个核心问题');
const system = checkTutorCandidate({ rawOutput: '{"dialogue":"你刚才完成了数据收集，现在说说发现。","interactionType":"information","focus":"cite_evidence","hints":[]}', allowedFocusIds: ['cite_evidence'], phase: 4, triggerType: 'SYSTEM_TRIGGER', studentMessage: '' });
check(system.check.issues.some((item) => item.code === 'SYSTEM_TRIGGER_AS_STUDENT'), '系统触发不会误标为学生发言');
const p4 = checkTutorCandidate({ rawOutput: '{"dialogue":"请比较 result_a 和 level_1_result。","interactionType":"clarification","focus":"cite_evidence","hints":[]}', allowedFocusIds: ['cite_evidence'], phase: 4, triggerType: 'USER_MESSAGE', studentMessage: '我看不懂' });
check(p4.check.issues.some((item) => item.code === 'INTERNAL_SCHEMA_KEY'), 'P4 阻断内部字段 key');

const noEdit = computeEditMetrics(goodRaw, goodRaw);
check(noEdit.type === 'NO_CHANGE', '无编辑但双人确认的候选可保留 NO_CHANGE 指标');
const structuredClosures = sanitizeTutorWarningClosures({
  compound: { validity: 'VALID', finalRelation: 'ONLY_UNSELECTED_CANDIDATE', severity: 'MINOR', note: '存在但较轻，且不在最终稿。' },
  blocking: { validity: 'VALID', finalRelation: 'PRESENT_IN_FINAL', severity: 'BLOCKING' },
  legacyResolution: { resolution: 'FIXED', note: '旧版单选仍可读取。' },
  detectorCorrected: { detectorVerdict: 'MISCLASSIFIED', correctedCategory: 'OVER_ADVANCEMENT', finalRelation: 'ONLY_UNSELECTED_CANDIDATE', candidateSeverity: 'MINOR', note: '机器识别成问号问题，人工纠正为过度推进。' },
  detectorBlocking: { detectorVerdict: 'CORRECT', finalRelation: 'PRESENT_IN_FINAL', finalSeverity: 'BLOCKING' },
  invalid: { validity: 'VALID', finalRelation: 'PRESENT_IN_FINAL' },
});
check(isTutorWarningClosed(structuredClosures.compound) && !tutorWarningBlocksFinal(structuredClosures.compound), 'warning 可同时记录成立、较轻且只在未采用候选');
check(tutorWarningBlocksFinal(structuredClosures.blocking), '仍在最终稿中的成立且严重 warning 会阻断确认');
check(isTutorWarningClosed(structuredClosures.detectorCorrected) && !tutorWarningBlocksFinal(structuredClosures.detectorCorrected), '新版 warning 可把机器错分纠正为人工问题类别，未采用候选不要求最终严重度');
check(tutorWarningBlocksFinal(structuredClosures.detectorBlocking), '新版 warning 只有仍在最终稿且严重时阻断');
check(isTutorWarningClosed(structuredClosures.legacyResolution) && !structuredClosures.invalid, '旧版单选 closure 保持兼容且不完整新结构会被过滤');
check(isTutorWarningClosed(sanitizeTutorWarningClosures({ legacy: true }).legacy), '历史 boolean warning closure 保持兼容');
throws(() => assertReleaseItemSource('sample', 'finalized'), '发布项同时绑定旧 sample 与 finalized turn 时阻断');
throws(() => assertReleaseItemSource(null, null), '发布项未绑定任何来源时阻断');
check(shingleJaccard('请比较第1行和第2行的数据', '请比较第1行与第2行的数据') > 0.5, '三字符 shingle Jaccard 可识别近重复');
const coverageSubjects = ['biology_ecology', 'chemistry', 'physics', 'engineering', 'high_concept_interdisciplinary'];
const coverageModules = ['LIFE_HEALTH', 'ENERGY_ENVIRONMENT', 'INTELLIGENT_INFORMATION', 'AEROSPACE', 'DEEP_EARTH_OCEAN'];
const diverseCards = Array.from({ length: 15 }, (_, index) => ({ id: `coverage-${index}`, subject: coverageSubjects[index % 5], schemaVersion: 2, contextModule: coverageModules[Math.floor(index / 3)], activityMode: index % 3 === 0 || index === 1 ? 'ENGINEERING_DESIGN' : 'SCIENTIFIC_INQUIRY', sourceCandidate: { familyKey: `family-${index}`, familyOverrideKey: '' } }));
check(tutorTopicCardDiversityFailures(diverseCards).length === 0 && tutorTopicCardDiversityFailures(diverseCards.slice(0, 14)).length > 0, 'Full 180 要求15张 V2、每学科与情境模块各3张并覆盖工程探究');

const analysisState = { stage2: { submitted: false, approved: true, schema: { columns: [{ key: 'a', title: '条件一结果', type: 'number' as const, required: true }, { key: 'b', title: '条件二结果', type: 'number' as const, required: true }], minRows: 3, maxRows: 200 } }, stage3: { rows: [{ a: 2, b: 7 }, { a: 3, b: 6 }] } };
check(Object.keys(visibleDataRows(analysisState)[0]).includes('条件一结果'), 'P4 只向 Tutor 暴露学生可见中文列名');
check(updateServerAnalysis(analysisState, '第一行2比7低，第二行3也比6低').accepted, 'P4 由服务器依据学生消息和真实数据接受证据');
const report = attachServerOwnedArtifacts({ stage: 5, stageData: { ...analysisState, stage1: merged.stageData.stage1, stage2: { ...analysisState.stage2, experimentPlan: { independentVariable: { name: '条件', levels: ['一', '二'] }, dependentVariable: { name: '结果', measurement: '计数' }, controlledVariables: [], materials: [], procedure: [], repeatCount: 3, safetyNotes: [] } }, stage4: { analysisCount: 1, evidenceRounds: [{ observation: '2比7低', citations: ['2', '7'], matchedValues: ['2', '7'] }] } }, triggerType: 'REPORT_BOOTSTRAP' });
check(Boolean(report.envelope.artifacts?.report_sections), 'P5 server report 由服务器组装');
check(!JSON.stringify(language).includes('report_sections'), 'P5 server report 不进入模型监督目标');

check(Object.values(EVAL_CASE_COUNTS).reduce((sum, count) => sum + count, 0) === 80 && Object.values(EVAL_CASE_COUNTS).every((count) => count >= 10), '独立 EVAL profile 共80场景且每阶段至少10个');
const phase = Object.fromEntries([1, 2, 3, 4, 5, 6].map((p) => [String(p), { A: 4, B: 6, tie: 0, inconsistent: 0, criticalErrors: 0, parseSuccessA: 9, parseTotalA: 10, parseSuccessB: 10, parseTotalB: 10 }]));
const gate = evaluateDeploymentGate({ candidateTag: 'candidate', trainingReady: true, runs: [{ id: 'run', modelATag: 'baseline', modelBTag: 'candidate', scope: 'all', summary: { phase, artifactValidation: { complete: true, invalidArtifacts: 0, scenarioIdsComplete: true, modelIdentitiesVerified: true } } }] });
check(gate.result === 'PASS', '新部署门禁按阶段、关键错误、结构解析和产物完整性通过');
const onlineBlocked = evaluateOnlineObservationGate({ rolloutPercent: 10, startedAt: new Date('2026-01-01T00:00:00Z'), now: new Date('2026-01-02T00:00:00Z'), sessions: 10, criticalErrors: 0, structureFailureRate: 0.01, baselineStructureFailureRate: 0.01, teacherRejectRate: 0.1, baselineTeacherRejectRate: 0.1, earlyTerminationRate: 0.1, baselineEarlyTerminationRate: 0.1 });
check(!onlineBlocked.pass && onlineBlocked.failures.length >= 2, '灰度未达到时间和会话量时阻断晋级并给出原因');
const onlineCritical = evaluateOnlineObservationGate({ rolloutPercent: 30, startedAt: new Date('2026-01-01T00:00:00Z'), now: new Date('2026-01-05T00:00:00Z'), sessions: 200, criticalErrors: 1, structureFailureRate: 0.01, baselineStructureFailureRate: 0.01, teacherRejectRate: 0.1, baselineTeacherRejectRate: 0.1, earlyTerminationRate: 0.1, baselineEarlyTerminationRate: 0.1 });
check(onlineCritical.failures.includes('ONLINE_CRITICAL_ERROR'), '任一线上 critical 错误立即阻断晋级');

console.log(`\nTutor language pipeline tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
