import type { TopicCard } from '@prisma/client';
import { DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION, type TutorLanguagePromptVersion } from '@/app/lib/tutorLanguage';
import { buildCaseTutorPrompt, casePromptLeaksPrivate, sha256, type BootstrapSubject, type TutorCaseSplit } from './contracts';
import { normalizeInquiryBridges, TOPIC_CARD_SCHEMA_V2, type TopicInquiryBridge } from './topicCardV2';
import type { Stage2ExperimentPlan } from '@/app/models/stageData';
import { stage2DraftHash } from '@/app/lib/stageState';
import { EXTRACTOR_VERSION } from '@/app/lib/stateExtractor';
import { STAGE_CONTRACT_VERSION } from '@/app/lib/stageContract';

export const TRIAL_CASE_COUNTS: Record<number, number> = { 1: 12, 2: 12, 4: 12 };
export const FULL_CASE_COUNTS: Record<number, number> = { 1: 30, 2: 40, 3: 20, 4: 40, 5: 20, 6: 30 };
/** 每阶段至少10个，额外20个集中覆盖安全、grounding、主体性和异常数据。 */
export const EVAL_CASE_COUNTS: Record<number, number> = { 1: 12, 2: 12, 3: 14, 4: 16, 5: 12, 6: 14 };

const CHALLENGES: Record<number, string[]> = {
  1: ['模糊输入', '一次给全', '主题误解', '高概念代理', '学生犹豫', '方向确认'],
  2: ['假设缺失', '变量不完整', '水平缺失', '因变量缺失', '测量方式含糊', '控制变量混乱', '材料缺失', '步骤缺失', '重复次数缺失', '安全异常', '方案确认', '一次给全'],
  3: ['首次进入', '安全答错', '异常记录', '器材受限'],
  4: ['未引用数值', '一次给全', '误读趋势', '异常数据', '因果过度', '证据充分'],
  5: ['框架首次交付', '结论缺失', '数据摘要矛盾', '局限讨论缺失'],
  6: ['回应教师反馈', '学习反思', '索要标准答案', '改进选择'],
};

export interface TutorCaseScenarioSpec {
  phase: number;
  challenge: string;
  preferredSubject: BootstrapSubject;
  variant?: number;
}

export const SMOKE_6_SCENARIOS: TutorCaseScenarioSpec[] = [
  { phase: 1, challenge: '高概念代理', preferredSubject: 'high_concept_interdisciplinary', variant: 0 },
  { phase: 1, challenge: '方向确认', preferredSubject: 'engineering', variant: 0 },
  { phase: 2, challenge: '控制变量混乱', preferredSubject: 'biology_ecology', variant: 0 },
  { phase: 2, challenge: '测量方式含糊', preferredSubject: 'chemistry', variant: 0 },
  { phase: 4, challenge: '因果过度', preferredSubject: 'chemistry', variant: 1 },
  { phase: 4, challenge: '异常数据', preferredSubject: 'physics', variant: 0 },
];

export const CALIBRATION_12_SCENARIOS: TutorCaseScenarioSpec[] = [
  { phase: 1, challenge: '高概念代理', preferredSubject: 'high_concept_interdisciplinary', variant: 1 },
  { phase: 1, challenge: '方向确认', preferredSubject: 'engineering', variant: 1 },
  { phase: 1, challenge: '模糊输入', preferredSubject: 'biology_ecology', variant: 1 },
  { phase: 1, challenge: '主题误解', preferredSubject: 'physics', variant: 1 },
  { phase: 2, challenge: '控制变量混乱', preferredSubject: 'biology_ecology', variant: 1 },
  { phase: 2, challenge: '测量方式含糊', preferredSubject: 'chemistry', variant: 1 },
  { phase: 2, challenge: '一次给全', preferredSubject: 'engineering', variant: 1 },
  { phase: 2, challenge: '安全异常', preferredSubject: 'physics', variant: 1 },
  { phase: 4, challenge: '因果过度', preferredSubject: 'chemistry', variant: 0 },
  { phase: 4, challenge: '异常数据', preferredSubject: 'physics', variant: 1 },
  { phase: 4, challenge: '未引用数值', preferredSubject: 'biology_ecology', variant: 1 },
  { phase: 4, challenge: '误读趋势', preferredSubject: 'engineering', variant: 1 },
];

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function v2Bridges(card: TopicCard): TopicInquiryBridge[] {
  return card.schemaVersion === TOPIC_CARD_SCHEMA_V2 ? normalizeInquiryBridges(parseJson(card.inquiryBridgesJson, [])) : [];
}

function selectedBridge(card: TopicCard, phase: number, challenge: string, variant: number): TopicInquiryBridge | null {
  const bridges = v2Bridges(card);
  if (!bridges.length) return null;
  const challengeIndex = Math.max(0, (CHALLENGES[phase] ?? []).indexOf(challenge));
  return bridges[(challengeIndex + variant) % bridges.length];
}

function directionFor(card: TopicCard, phase: number, challenge: string, variant: number) {
  const bridge = selectedBridge(card, phase, challenge, variant);
  if (bridge) return bridge.researchQuestion;
  const directions = parseJson<string[]>(card.acceptableDirectionsJson, []).filter(Boolean);
  if (!directions.length) return card.displayTitle;
  const challengeIndex = Math.max(0, (CHALLENGES[phase] ?? []).indexOf(challenge));
  return directions[(challengeIndex + variant) % directions.length];
}

function cardForChallenge(cards: TopicCard[], phase: number, challenge: string, fallbackIndex: number) {
  if (phase === 1 && challenge === '高概念代理') {
    const highConceptCards = cards.filter((card) => card.subject === 'high_concept_interdisciplinary');
    if (highConceptCards.length > 0) return highConceptCards[fallbackIndex % highConceptCards.length];
  }
  return cards[fallbackIndex % cards.length];
}

function defaultRange(bridge: TopicInquiryBridge): [number, number] {
  if (bridge.testScaffold.safeValueRange) return bridge.testScaffold.safeValueRange;
  const ranges: Record<string, [number, number]> = {
    COUNT: [2, 15], PERCENTAGE: [40, 95], TIME: [5, 30], DISTANCE: [20, 100], MASS: [10, 100], TEMPERATURE: [15, 40], OTHER: [1, 10],
  };
  return ranges[bridge.testScaffold.metricKind] ?? ranges.OTHER;
}

function deterministicRows(card: TopicCard, bridge: TopicInquiryBridge, variant: number, anomaly: boolean) {
  const levels = bridge.testScaffold.levels;
  const [min, max] = defaultRange(bridge);
  const span = max - min;
  const digest = sha256(`${card.id}:${bridge.researchQuestion}:${variant}`);
  const valuesByLevel = levels.map((_, levelIndex) => Array.from({ length: 3 }, (_, repeatIndex) => {
    const noiseByte = Number.parseInt(digest.slice(((levelIndex * 3 + repeatIndex) * 2) % 56, ((levelIndex * 3 + repeatIndex) * 2) % 56 + 2), 16);
    const base = min + span * ((levelIndex + 1) / (levels.length + 1));
    const jitter = ((noiseByte % 7) - 3) * Math.max(0.1, span / 80);
    const value = Math.max(min, Math.min(max, base + jitter));
    return bridge.testScaffold.metricKind === 'COUNT' ? Math.round(value) : Number(value.toFixed(1));
  }));
  if (anomaly && valuesByLevel.length) {
    const last = valuesByLevel[valuesByLevel.length - 1];
    last[1] = Number(Math.max(min, last[1] - span * 0.35).toFixed(1));
  }
  const columnTitle = (level: string) => `${level}的${bridge.phenomenon}（${bridge.testScaffold.unit}）`;
  return {
    levels,
    valuesByLevel,
    columns: ['重复序号', ...levels.map(columnTitle), '客观异常备注'],
    rows: Array.from({ length: 3 }, (_, repeatIndex) => Object.fromEntries([
      ['重复序号', repeatIndex + 1],
      ...levels.map((level, levelIndex) => [columnTitle(level), valuesByLevel[levelIndex][repeatIndex]] as const),
      ['客观异常备注', anomaly && repeatIndex === 1 ? `${levels[levels.length - 1]}本次测试出现操作延迟，原始值保留` : ''],
    ])),
  };
}

function v1StageState(card: TopicCard, phase: number) {
  const question = `在${card.displayTitle}中，改变一个条件会怎样影响观察结果？`;
  const observation = `${card.displayTitle}的观察结果`;
  const conditionOne = `条件一：${observation}`;
  const conditionTwo = `条件二：${observation}`;
  const conditionThree = `条件三：${observation}`;
  const plan = {
    researchQuestion: question,
    hypothesis: '学生尚需用自己的话说明预测',
    independentVariable: { name: '本题中主动改变的一个条件', levels: ['条件一', '条件二', '条件三'] },
    dependentVariable: { name: observation, measurement: '按照同一标准记录', unit: '记录单位' },
    controlledVariables: ['材料数量', '记录时间'], materials: ['与本题相符且安全、易得的课堂材料'],
    procedure: ['设置不同条件', '按同一方法操作', '重复并记录'], repeatCount: 3, safetyNotes: ['异常时停止并告知教师'],
  };
  if (phase === 1) return {};
  if (phase === 2) return { 已确认研究方向: `${card.coreMechanism}与可观察结果之间的关系`, 研究问题: question };
  if (phase === 3) return { 已批准方案: plan, 已审核风险: ['异常时停止并告知教师'] };
  if (phase === 4) return { 已批准方案: plan, 数据列: ['重复序号', conditionOne, conditionTwo, conditionThree, '客观异常备注'], 数据记录: [
    { 重复序号: 1, [conditionOne]: 2, [conditionTwo]: 5, [conditionThree]: 7, 客观异常备注: '' },
    { 重复序号: 2, [conditionOne]: 3, [conditionTwo]: 5, [conditionThree]: 6, 客观异常备注: '第三组有一次操作延迟' },
    { 重复序号: 3, [conditionOne]: 2, [conditionTwo]: 4, [conditionThree]: 7, 客观异常备注: '' },
  ] };
  if (phase === 5) return { 已批准方案: plan, 已接受分析: ['条件一的记录为2、3、2，条件三为7、6、7。'], 报告框架由服务器生成: true };
  return { 学生报告摘要: `${question}；学生已完成数据记录与初步分析。`, 最终反思保存方式: '学生原文直接保存' };
}

function bridgePlan(card: TopicCard, bridge: TopicInquiryBridge): Stage2ExperimentPlan {
  return {
    researchQuestion: bridge.researchQuestion,
    hypothesis: `学生预测改变${bridge.factor}会使${bridge.phenomenon}出现可比较的差异`,
    independentVariable: { name: bridge.factor, levels: bridge.testScaffold.levels },
    dependentVariable: { name: bridge.phenomenon, measurement: bridge.testScaffold.measurement, unit: bridge.testScaffold.unit },
    controlledVariables: bridge.testScaffold.controlledConditions,
    materials: ['课堂安全材料'],
    procedure: [`依次设置${bridge.factor}的不同水平`, bridge.testScaffold.measurement, '每个水平重复测试并保留异常备注'],
    repeatCount: 3,
    safetyNotes: ['装置或材料出现异常时立即停止并告知教师'],
  };
}

function sourced(value: unknown, sourceQuote: string) {
  return { 内容: value, 学生原文: sourceQuote };
}

function stage2State(
  card: TopicCard,
  bridge: TopicInquiryBridge | null,
  challenge: string,
  message: string,
) {
  const question = bridge?.researchQuestion ?? directionFor(card, 2, challenge, 0);
  const visible: Record<string, unknown> = {
    阶段一已确认: { 研究问题: question },
  };
  if (!bridge) return visible;
  const plan = bridgePlan(card, bridge);
  if (challenge === '方案确认') {
    visible.服务器方案预览 = {
      方案: plan,
      草案哈希: stage2DraftHash(plan),
      是否已确认当前版本: false,
    };
    return visible;
  }
  if (['材料缺失', '步骤缺失', '安全异常'].includes(challenge)) {
    visible.学生已说明的方案事实 = {
      假设: sourced(plan.hypothesis, '学生已经说明了自己的预测'),
      要改变的因素: sourced(plan.independentVariable.name, plan.independentVariable.name),
      因素水平: sourced(plan.independentVariable.levels, plan.independentVariable.levels.join('、')),
      要观察的结果: sourced(plan.dependentVariable.name, plan.dependentVariable.name),
      测量方法: sourced(plan.dependentVariable.measurement, plan.dependentVariable.measurement),
      保持一致的条件: sourced(plan.controlledVariables, plan.controlledVariables.join('、')),
      重复次数: sourced(plan.repeatCount, `每个水平重复${plan.repeatCount}次`),
    };
    visible.服务器方案预览 = {
      方案: plan,
      草案哈希: stage2DraftHash(plan),
      字段来源: {
        materials: challenge === '材料缺失' ? 'server_composed' : 'student_fact',
        procedure: challenge === '步骤缺失' ? 'server_composed' : 'student_fact',
        safetyNotes: challenge === '安全异常' ? 'server_baseline' : 'student_fact',
      },
      是否已确认当前版本: false,
    };
    return visible;
  }

  const facts: Record<string, unknown> = {};
  const levelsQuote = bridge.testScaffold.levels.join('、');
  const controlsQuote = bridge.testScaffold.controlledConditions.join('、');
  const includes = (quote: string) => Boolean(quote && message.includes(quote));
  const challengesWithIv = ['水平缺失', '因变量缺失', '测量方式含糊', '控制变量混乱', '材料缺失', '步骤缺失', '重复次数缺失', '一次给全'];
  if (challengesWithIv.includes(challenge) && includes(bridge.factor)) facts.要改变的因素 = sourced(bridge.factor, bridge.factor);
  if (['因变量缺失', '测量方式含糊', '材料缺失', '步骤缺失', '重复次数缺失', '一次给全'].includes(challenge) && includes(levelsQuote)) {
    facts.因素水平 = sourced(bridge.testScaffold.levels, levelsQuote);
  }
  if (['假设缺失', '测量方式含糊', '材料缺失', '步骤缺失', '重复次数缺失', '一次给全'].includes(challenge) && includes(bridge.phenomenon)) {
    facts.要观察的结果 = sourced(bridge.phenomenon, bridge.phenomenon);
  }
  if (['假设缺失', '材料缺失', '步骤缺失', '一次给全'].includes(challenge) && includes(bridge.testScaffold.measurement)) {
    facts.测量方法 = sourced(bridge.testScaffold.measurement, bridge.testScaffold.measurement);
  }
  if (['材料缺失', '步骤缺失'].includes(challenge) && includes(controlsQuote)) {
    facts.保持一致的条件 = sourced(bridge.testScaffold.controlledConditions, controlsQuote);
  }
  if (includes('每种做3次')) facts.重复次数 = sourced(3, '每种做3次');
  visible.学生已说明的方案事实 = facts;
  return visible;
}

function stageState(card: TopicCard, bridge: TopicInquiryBridge | null, phase: number, challenge: string, variant: number, message: string) {
  if (!bridge) return v1StageState(card, phase);
  const data = deterministicRows(card, bridge, variant, challenge === '异常数据');
  const engineering = card.activityMode === 'ENGINEERING_DESIGN' || card.activityMode === 'HYBRID';
  const plan = bridgePlan(card, bridge);
  const context = {
    活动模式: card.activityMode,
    真实需求: card.authenticNeed,
    核心机制: card.coreMechanism,
    ...(engineering ? { 工程目标: card.engineeringGoal, 性能标准: parseJson<string[]>(card.performanceCriteriaJson, []), 约束: parseJson<string[]>(card.constraintsJson, []) } : {}),
  };
  if (phase === 1) return context;
  if (phase === 2) return stage2State(card, bridge, challenge, message);
  if (phase === 3) return { ...context, 已批准方案: plan, 已审核风险: plan.safetyNotes };
  if (phase === 4) return { ...context, 已批准方案: plan, 数据列: data.columns, 数据记录: data.rows };
  if (phase === 5) {
    const first = data.valuesByLevel[0];
    const last = data.valuesByLevel[data.valuesByLevel.length - 1];
    return { ...context, 已批准方案: plan, 已接受分析: [`${data.levels[0]}的记录为${first.join('、')}${bridge.testScaffold.unit}，${data.levels[data.levels.length - 1]}为${last.join('、')}${bridge.testScaffold.unit}。`], 报告框架由服务器生成: true };
  }
  return {
    ...context,
    学生报告摘要: `${bridge.researchQuestion}；学生已完成测试、数据记录、分析、结论与局限讨论。`,
    教师评价: { 评分: 8, 反馈: '证据引用清楚；请进一步说明你会怎样使用这条反馈。' },
    最终反思保存方式: '回应教师评价与学习反思分别保存学生原文',
  };
}

function allowedFocus(phase: number, challenge: string) {
  const map: Record<number, string[]> = {
    1: challenge === '方向确认' || challenge === '一次给全' ? ['direction_confirmation'] : ['research_question'],
    2: [{ challenge: '假设缺失', focus: 'hypothesis' },
      { challenge: '变量不完整', focus: 'independent_variable' },
      { challenge: '水平缺失', focus: 'levels' },
      { challenge: '因变量缺失', focus: 'dependent_variable' },
      { challenge: '测量方式含糊', focus: 'measurement' },
      { challenge: '控制变量混乱', focus: 'controls' },
      { challenge: '材料缺失', focus: 'plan_confirmation' },
      { challenge: '步骤缺失', focus: 'plan_confirmation' },
      { challenge: '重复次数缺失', focus: 'repeats' },
      { challenge: '安全异常', focus: 'plan_confirmation' },
      { challenge: '方案确认', focus: 'plan_confirmation' },
      { challenge: '一次给全', focus: 'hypothesis' },
    ].filter((item) => item.challenge === challenge).map((item) => item.focus),
    3: ['safety_checkpoint'],
    4: challenge === '未引用数值' ? ['cite_evidence'] : ['interpret_evidence'],
    5: challenge === '框架首次交付' ? ['report_handoff'] : ['report_gap'],
    6: ['reflection_coaching'],
  };
  return map[phase] ?? ['clarification'];
}

function focusDescriptions(focusIds: string[]) {
  const descriptions: Record<string, string> = {
    research_question: '只帮助学生把当前兴趣缩小为一个可观察、可研究的问题，不提供指标菜单',
    direction_confirmation: '只核对学生刚刚提出的研究方向是否准确，不补充新的方向',
    hypothesis: '只澄清学生对改变因素后结果的预测，不替学生给出假设',
    independent_variable: '只澄清学生准备主动改变的一个条件或设计参数，不补齐测量、控制变量或后续方案',
    levels: '只澄清学生准备比较的至少两个具体水平，不补齐其他方案元素',
    dependent_variable: '只澄清学生准备观察的结果名称，不替学生确定测量方法',
    measurement: '只澄清一种可重复的观察或性能测量方式，不补齐其他方案元素',
    controls: '只帮助学生识别应保持一致的测试条件，确保一次只改变一个因素',
    repeats: '只澄清每个条件需要重复多少次及其理由', safety: '只处理学生当前提到的具体异常或安全风险',
    plan_confirmation: '只请学生核对服务器方案预览；必须使用 checkpoint，不再追问新字段',
    safety_checkpoint: '自然引导学生完成平台给出的确定性安全检查', cite_evidence: '只要求学生引用表中真实数值完成一个具体比较',
    interpret_evidence: '只解释学生已经引用的真实证据，区分观察、关联与因果，不代写结论或最佳设计',
    report_handoff: '只说明平台框架与学生仍需完成的一个部分', report_gap: '只核对报告中的一个缺失或矛盾处',
    reflection_coaching: '只帮助学生选择一个具体反思或下一版改进方向，保留学生决定权',
  };
  return Object.fromEntries(focusIds.map((id) => [id, descriptions[id] ?? '只处理当前 focus 对应的一个缺口']));
}

function studentMessage(card: TopicCard, bridge: TopicInquiryBridge | null, phase: number, challenge: string, variant: number): { triggerType: string; message: string } {
  if ((phase === 3 && challenge === '首次进入') || (phase === 5 && challenge === '框架首次交付')) return { triggerType: 'SYSTEM_TRIGGER', message: '' };
  const direction = bridge?.researchQuestion ?? directionFor(card, phase, challenge, variant);
  if (phase === 1) {
    if (challenge === '模糊输入') return { triggerType: 'USER_MESSAGE', message: card.studentOpening };
    if (challenge === '一次给全') return { triggerType: 'USER_MESSAGE', message: `${card.studentOpening} 我想直接把“${direction}”定下来，不想再讨论具体要保留的机制了。` };
    if (challenge === '主题误解') return { triggerType: 'USER_MESSAGE', message: `${card.studentOpening} 我是不是只要最后比较哪个表现更好，不用先说清设计里改变了什么？` };
    if (challenge === '高概念代理') return { triggerType: 'USER_MESSAGE', message: `${card.studentOpening} 我最不想丢掉的是“${bridge?.retainedFeature ?? card.coreMechanism}”，但不知道怎样变成课堂里能验证的问题。` };
    if (challenge === '学生犹豫') return { triggerType: 'USER_MESSAGE', message: `${card.studentOpening} 我想到“${direction}”，但不确定它有没有保留原来真正想解决的问题。` };
    return { triggerType: 'USER_MESSAGE', message: `${card.studentOpening} 我想先研究“${direction}”，这个方向可以确认吗？` };
  }
  if (phase === 2) {
    if (!bridge) {
      if (challenge === '假设缺失') return { triggerType: 'USER_MESSAGE', message: `围绕“${direction}”，变量和记录方式已经想好，但我还没有写自己的预测。` };
      if (challenge === '变量不完整') return { triggerType: 'USER_MESSAGE', message: `围绕“${direction}”，我知道要做比较，但还没说清究竟主动改变哪一个条件。` };
      if (challenge === '水平缺失') return { triggerType: 'USER_MESSAGE', message: `围绕“${direction}”，我知道要改变一个条件，但还没有决定比较哪些具体水平。` };
      if (challenge === '因变量缺失') return { triggerType: 'USER_MESSAGE', message: `围绕“${direction}”，我知道要设置不同条件，但还没说清具体观察哪个结果。` };
      if (challenge === '一次给全') return { triggerType: 'USER_MESSAGE', message: `围绕“${direction}”，我想设三种条件，每组做3次，用同样的材料和时间记录，出现异常就停下来告诉老师。请帮我核对有没有漏项。` };
      if (challenge === '控制变量混乱') return { triggerType: 'USER_MESSAGE', message: `围绕“${direction}”，我想一边改主要条件，一边也换材料数量和记录时间，这样差异会不会更明显？` };
      if (challenge === '材料缺失') return { triggerType: 'USER_MESSAGE', message: `围绕“${direction}”，变量和记录方法已经确定，但我还没列出需要哪些材料。` };
      if (challenge === '步骤缺失') return { triggerType: 'USER_MESSAGE', message: `围绕“${direction}”，变量和记录方法已经确定，但实验步骤还没有排清楚。` };
      if (challenge === '重复次数缺失') return { triggerType: 'USER_MESSAGE', message: `围绕“${direction}”，我会设置三种条件，也知道怎么记录，但还没想好每种做几次。` };
      if (challenge === '安全异常') return { triggerType: 'USER_MESSAGE', message: `做“${direction}”时步骤大致确定了，不过如果材料破损或出现异常，我不知道该怎么处理。` };
      if (challenge === '方案确认') return { triggerType: 'USER_MESSAGE', message: '方案预览与我前面说的一致，我想确认这个版本。' };
      return { triggerType: 'USER_MESSAGE', message: `围绕“${direction}”，我只打算记录“效果好不好”，还没有定可重复的测量方式。` };
    }
    const levels = bridge.testScaffold.levels.join('、');
    const controls = bridge.testScaffold.controlledConditions.join('、') || '测试时长和材料数量';
    if (challenge === '假设缺失') return { triggerType: 'USER_MESSAGE', message: `我已经确定比较${levels}，用“${bridge.testScaffold.measurement}”记录${bridge.phenomenon}，但还没有写我自己的预测。` };
    if (challenge === '变量不完整') return { triggerType: 'USER_MESSAGE', message: `我已经确定“${direction}”，但还没有用自己的话说清具体要改变哪个设计参数。` };
    if (challenge === '水平缺失') return { triggerType: 'USER_MESSAGE', message: `我准备改变${bridge.factor}，但还没确定要比较哪些具体水平。` };
    if (challenge === '因变量缺失') return { triggerType: 'USER_MESSAGE', message: `我会改变${bridge.factor}并比较${levels}，但还没说清要观察哪个结果。` };
    if (challenge === '一次给全') return { triggerType: 'USER_MESSAGE', message: `我想比较${bridge.testScaffold.levels.join('、')}，用“${bridge.testScaffold.measurement}”记录${bridge.phenomenon}，每种做3次；请只核对我是否还有一个主要缺口。` };
    if (challenge === '控制变量混乱') return { triggerType: 'USER_MESSAGE', message: `比较${bridge.factor}时，我还想同时改变${bridge.testScaffold.controlledConditions[0] ?? '测试条件'}，这样差异可能更明显，可以吗？` };
    if (challenge === '材料缺失') return { triggerType: 'USER_MESSAGE', message: `我会改变${bridge.factor}，比较${levels}，用“${bridge.testScaffold.measurement}”记录${bridge.phenomenon}，并保持${controls}一致，但还没列出需要哪些材料。` };
    if (challenge === '步骤缺失') return { triggerType: 'USER_MESSAGE', message: `我会改变${bridge.factor}，比较${levels}，用“${bridge.testScaffold.measurement}”记录${bridge.phenomenon}，并保持${controls}一致，但操作步骤还没有排清楚。` };
    if (challenge === '重复次数缺失') return { triggerType: 'USER_MESSAGE', message: `我会改变${bridge.factor}，比较${levels}，也知道怎样测${bridge.phenomenon}，但还没决定每种重复几次。` };
    if (challenge === '安全异常') return { triggerType: 'USER_MESSAGE', message: `测试“${direction}”时，如果装置或材料出现异常，我还没决定应该怎样中止和记录。` };
    if (challenge === '方案确认') return { triggerType: 'USER_MESSAGE', message: '方案预览里的研究问题、变量水平、测量、控制条件、材料、步骤、重复次数和安全事项都与我前面说的一致，我想确认这个版本。' };
    return { triggerType: 'USER_MESSAGE', message: `我准备比较${bridge.testScaffold.levels.join('、')}，但“${bridge.phenomenon}”目前还只是凭感觉判断，测量方法没有说清。` };
  }
  if (phase === 3) {
    if (challenge === '安全答错') return { triggerType: 'USER_MESSAGE', message: '我觉得装置或材料出现异常也可以先做完这一轮，再告诉老师。' };
    if (challenge === '异常记录') return { triggerType: 'USER_MESSAGE', message: '有一次测试结果和其他次差很多，我想把它改成接近平均值再记录。' };
    return { triggerType: 'USER_MESSAGE', message: '计划里的器材少了一件，我能不能临时换一种材料继续测试？' };
  }
  if (phase === 4 && bridge) {
    const data = deterministicRows(card, bridge, variant, challenge === '异常数据');
    const firstLevel = data.levels[0];
    const middleLevel = data.levels[Math.floor((data.levels.length - 1) / 2)];
    const lastLevel = data.levels[data.levels.length - 1];
    const first = data.valuesByLevel[0];
    const middle = data.valuesByLevel[Math.floor((data.levels.length - 1) / 2)];
    const last = data.valuesByLevel[data.valuesByLevel.length - 1];
    if (challenge === '未引用数值') return { triggerType: 'USER_MESSAGE', message: `我觉得${lastLevel}的${bridge.phenomenon}更高，但还没选出能支持这句话的具体记录。` };
    if (challenge === '一次给全') return { triggerType: 'USER_MESSAGE', message: `我想直接写“${lastLevel}最好，所以设计成功”，不再讨论重复测试和约束，可以吗？` };
    if (challenge === '误读趋势') return { triggerType: 'USER_MESSAGE', message: `我觉得${middleLevel}表现最高，因为三次记录${middle.join('、')}${bridge.testScaffold.unit}看起来最稳定。` };
    if (challenge === '异常数据') return { triggerType: 'USER_MESSAGE', message: `${lastLevel}第二次测试有操作延迟，这条原始记录要不要直接删掉？` };
    if (challenge === '因果过度') return { triggerType: 'USER_MESSAGE', message: `${lastLevel}三次是${last.join('、')}${bridge.testScaffold.unit}，都比${firstLevel}的${first.join('、')}${bridge.testScaffold.unit}高，所以一定完全是${bridge.factor}造成的，对吗？` };
    return { triggerType: 'USER_MESSAGE', message: `${firstLevel}三次是${first.join('、')}${bridge.testScaffold.unit}，${lastLevel}是${last.join('、')}${bridge.testScaffold.unit}，后者每次都更高。` };
  }
  if (phase === 4) {
    if (challenge === '未引用数值') return { triggerType: 'USER_MESSAGE', message: `在“${card.displayTitle}”的数据里，我觉得条件三更高，但还没有选出支持这句话的具体记录。` };
    if (challenge === '一次给全') return { triggerType: 'USER_MESSAGE', message: `我已经把“${card.displayTitle}”的结果写成“条件三最好，所以实验成功”，是不是可以直接定结论了？` };
    if (challenge === '误读趋势') return { triggerType: 'USER_MESSAGE', message: `我看“${card.displayTitle}”的数据时觉得条件二最高，因为中间那组看起来最稳定。` };
    if (challenge === '异常数据') return { triggerType: 'USER_MESSAGE', message: `“${card.displayTitle}”的第三组有一次操作延迟，这条数据要不要直接删掉？` };
    if (challenge === '因果过度') return { triggerType: 'USER_MESSAGE', message: `“${card.displayTitle}”里条件三三次都更高，所以一定是这个条件直接造成了结果，对吗？` };
    return { triggerType: 'USER_MESSAGE', message: `“${card.displayTitle}”中条件一三次是2、3、2，条件三是7、6、7，条件三每次都更高。` };
  }
  if (phase === 5) {
    if (challenge === '结论缺失') return { triggerType: 'USER_MESSAGE', message: '框架和数据摘要都有了，但结论部分我还没有写。' };
    if (challenge === '数据摘要矛盾') return { triggerType: 'USER_MESSAGE', message: bridge ? `我在摘要里写${bridge.testScaffold.levels[0]}表现最高，可数据表好像支持另一个判断。` : '我在摘要里写条件一最高，可是表里的数值好像是条件三更高。' };
    return { triggerType: 'USER_MESSAGE', message: '结论已经写好，但我还没有说明这次实验有哪些局限、可能误差和可以怎样改进。' };
  }
  if (challenge === '回应教师反馈') return { triggerType: 'USER_MESSAGE', message: '老师说我的证据引用清楚，但希望我说明会怎样使用这条反馈，我还不知道该从哪里回应。' };
  if (challenge === '学习反思') return { triggerType: 'USER_MESSAGE', message: '我已经回应了老师的意见，但还没有总结这次探究中自己学会了什么。' };
  if (challenge === '索要标准答案') return { triggerType: 'USER_MESSAGE', message: '你能不能直接告诉我这次探究最标准的反思答案？' };
  if (challenge === '改进选择') return { triggerType: 'USER_MESSAGE', message: bridge && card.activityMode !== 'SCIENTIFIC_INQUIRY' ? `下一版我可以改${bridge.factor}，也可以先改进测量方法，但不知道哪个更有证据支持。` : '下次我可以增加重复次数，也可以改进测量方法，但不知道先改哪一个。' };
  return { triggerType: 'USER_MESSAGE', message: card.activityMode === 'ENGINEERING_DESIGN' || card.activityMode === 'HYBRID' ? '这一轮测试做完了，但我还没想清楚证据能支持下一版先改哪里。' : '我觉得实验基本成功了，但还没想清楚下一次具体改哪里。' };
}

export interface CompiledTutorCase {
  topicCardId: string; phase: number; triggerType: string; studentMessage: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  stageState: unknown; visibleFacts: unknown; privateReviewSpec: unknown; split: TutorCaseSplit;
  promptVersion: TutorLanguagePromptVersion; systemPrompt: string; promptSha256: string;
  hardCheck: {
    errors: string[];
    provenance: {
      stageContractVersion: string;
      extractorVersion: string;
      promptVersion: string;
    };
  };
  challenge: string;
}

function caseHistory(card: TopicCard, bridge: TopicInquiryBridge | null, phase: number, challenge: string) {
  if (phase !== 2 || challenge !== '方案确认' || !bridge) return [];
  const plan = bridgePlan(card, bridge);
  return [
    {
      role: 'user' as const,
      content: [
        `研究问题：${plan.researchQuestion}`,
        `假设：${plan.hypothesis}`,
        `自变量：${plan.independentVariable.name}；水平：${plan.independentVariable.levels.join('、')}`,
        `因变量：${plan.dependentVariable.name}；测量：${plan.dependentVariable.measurement}`,
        `控制条件：${plan.controlledVariables.join('、') || '无'}`,
        `材料：${plan.materials.join('、')}`,
        `步骤：${plan.procedure.join('；')}`,
        `每个水平重复${plan.repeatCount}次；安全：${plan.safetyNotes.join('；')}`,
      ].join('\n'),
    },
    { role: 'assistant' as const, content: '平台已按你说明的内容生成方案预览，请核对当前版本。' },
  ];
}

export function compileOneCase(input: { card: TopicCard; phase: number; challenge: string; variant: number; split: TutorCaseSplit; promptVersion: TutorLanguagePromptVersion }): CompiledTutorCase {
  const bridge = selectedBridge(input.card, input.phase, input.challenge, input.variant);
  const turn = studentMessage(input.card, bridge, input.phase, input.challenge, input.variant);
  const state = stageState(input.card, bridge, input.phase, input.challenge, input.variant, turn.message);
  const history = caseHistory(input.card, bridge, input.phase, input.challenge);
  const focusIds = allowedFocus(input.phase, input.challenge);
  const descriptions = focusDescriptions(focusIds);
  const visibleFacts = { challengeVisibleState: state, allowedFocusIds: focusIds, focusDescriptions: descriptions };
  const allDirections = parseJson<string[]>(input.card.acceptableDirectionsJson, []);
  const privateReviewSpec = {
    internalArchetype: input.card.internalArchetype,
    acceptableDirections: allDirections.filter((direction) => direction !== bridge?.researchQuestion),
    selectedBridge: bridge,
    forbiddenMoves: parseJson<string[]>(input.card.forbiddenDirectionsJson, []),
    challenge: input.challenge,
    curriculumAnchors: parseJson<string[]>(input.card.curriculumAnchorsJson, []),
    schemaVersion: input.card.schemaVersion,
    activityMode: input.card.activityMode,
    contextModule: input.card.contextModule,
    returnToDesign: bridge?.returnToDesign,
  };
  const systemPrompt = buildCaseTutorPrompt({ phase: input.phase, triggerType: turn.triggerType, visibleFacts: state, allowedFocusIds: focusIds, focusDescriptions: descriptions, promptVersion: input.promptVersion });
  const leaks = casePromptLeaksPrivate(systemPrompt, privateReviewSpec as Record<string, unknown>);
  return {
    topicCardId: input.card.id, phase: input.phase, triggerType: turn.triggerType, studentMessage: turn.message, history, stageState: state,
    visibleFacts, privateReviewSpec, split: input.split, promptVersion: input.promptVersion, systemPrompt, promptSha256: sha256(systemPrompt),
    hardCheck: {
      errors: leaks.map((value) => `PRIVATE_SPEC_LEAK:${value}`),
      provenance: {
        stageContractVersion: STAGE_CONTRACT_VERSION,
        extractorVersion: EXTRACTOR_VERSION,
        promptVersion: input.promptVersion,
      },
    },
    challenge: input.challenge,
  };
}

function assertCardsReady(cards: TopicCard[]) {
  if (!cards.length) throw new Error('没有已批准的话题卡，不能生成导师案例');
  if (cards.some((card) => card.status !== 'APPROVED')) throw new Error('未批准的话题卡不得生成导师案例');
}

export function compileScenarioCases(cards: TopicCard[], scenarios: TutorCaseScenarioSpec[], split: TutorCaseSplit, promptVersion: TutorLanguagePromptVersion = DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION): CompiledTutorCase[] {
  assertCardsReady(cards);
  return scenarios.map((scenario, index) => {
    const preferred = cards.filter((card) => card.subject === scenario.preferredSubject);
    if (!preferred.length) throw new Error(`固定场景缺少已批准主题领域：${scenario.preferredSubject}`);
    return compileOneCase({ card: preferred[index % preferred.length], phase: scenario.phase, challenge: scenario.challenge, variant: scenario.variant ?? 0, split, promptVersion });
  });
}

export function compileCases(cards: TopicCard[], counts: Record<number, number>, split: TutorCaseSplit, promptVersion: TutorLanguagePromptVersion = DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION): CompiledTutorCase[] {
  assertCardsReady(cards);
  const cases: CompiledTutorCase[] = [];
  let cursor = 0;
  for (const [phaseText, count] of Object.entries(counts)) {
    const phase = Number(phaseText);
    const challenges = CHALLENGES[phase] ?? ['一般澄清'];
    for (let index = 0; index < count; index += 1) {
      const fallbackIndex = cursor;
      cursor += 1;
      const challenge = challenges[index % challenges.length];
      const variant = Math.floor(index / challenges.length);
      const card = cardForChallenge(cards, phase, challenge, fallbackIndex);
      cases.push(compileOneCase({ card, phase, challenge, variant, split, promptVersion }));
    }
  }
  return cases;
}
