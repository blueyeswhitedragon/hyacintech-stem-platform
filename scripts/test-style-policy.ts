import {
  ASSISTANT_STYLE_OPTIONS,
  AUTO_STYLE_STRATEGY_VERSION,
  DEFAULT_STYLE_POLICY_VERSION,
  STYLE_FAMILIES,
  STYLE_POLICIES,
  buildStyleInstruction,
  evaluateStyleAuthenticity,
  resolveStyleFamily,
} from '../app/lib/stylePolicy';
import { stylesForSampleSlots, weightedStyleSequence } from '../app/lib/dataLab/assignment';
import { getPromptForPhase } from '../app/prompts';
import { PhaseEnum } from '../app/models/types';
import { assertTrainingConversationFormat, resolveRecordStyle, summarizeStyles, toTrainingShareGPTRecord, toTrainingShareGPTRecords, withStyleMetadata } from '../app/lib/dataLab/styleMetadata';
import { aggregateEvaluationsByStyle } from '../app/lib/dataLab/evaluation';
import type { ShareGPTRecord } from '../app/lib/dataLab/types';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

check('五种风格和自动选项齐全', STYLE_FAMILIES.length === 5 && ASSISTANT_STYLE_OPTIONS.length === 6);
check('所有风格使用同一初版规范版本', STYLE_FAMILIES.every((family) => STYLE_POLICIES[family].version === DEFAULT_STYLE_POLICY_VERSION));
check('每种风格都有标注规则和禁止模式', STYLE_FAMILIES.every((family) => STYLE_POLICIES[family].annotationRubric.length >= 3 && STYLE_POLICIES[family].forbiddenPatterns.length >= 3));

const fixed = resolveStyleFamily('warm_companion', 'assignment-a', 'student-a');
check('固定风格不会被自动策略覆盖', fixed === 'warm_companion');

const firstAuto = resolveStyleFamily('auto', 'assignment-a', 'student-a');
const secondAuto = resolveStyleFamily('auto', 'assignment-a', 'student-a');
check('自动风格对同一作业和学生保持稳定', firstAuto === secondAuto);
const autoCoverage = new Set(Array.from({ length: 100 }, (_, index) => resolveStyleFamily('auto', 'assignment-a', `student-${index}`)));
check(`${AUTO_STYLE_STRATEGY_VERSION} 能覆盖全部风格`, autoCoverage.size === STYLE_FAMILIES.length);

const weighted = weightedStyleSequence({ socratic_concise: 2, warm_companion: 1, engineering_mentor: 0, evidence_analyst: 0, classroom_coach: 0 });
check('风格权重生成预期轮换序列', weighted.join(',') === 'socratic_concise,socratic_concise,warm_companion');
const slots = stylesForSampleSlots(2, 3, { socratic_concise: 1, warm_companion: 1 });
check('同一样本的所有独立标注槽位共享目标风格', slots.length === 3 && new Set(slots).size === 1);

const styleResponse = (dialogue: string) => ({ dialogue, next_action_type: 'text_input' as const, phase_complete: false });
check('苏格拉底风格用短且唯一的开放问题作为可观察证据', evaluateStyleAuthenticity('socratic_concise', styleResponse('你能先指出最关键的一条证据吗？'), { phase: 4 }).issues.length === 0);
check('温和陪伴风格缺少具体承接时不能只靠标签过关', evaluateStyleAuthenticity('warm_companion', styleResponse('请继续回答。'), { phase: 2 }).issues.length > 0);
check('工程导师风格需要出现约束、参数或验证视角', evaluateStyleAuthenticity('engineering_mentor', styleResponse('先核对这个参数是否在可测范围内。'), { phase: 2 }).issues.length === 0);
check('证据分析风格需要指向证据或不确定性', evaluateStyleAuthenticity('evidence_analyst', styleResponse('请引用两个数值，并区分观察和解释。'), { phase: 4 }).issues.length === 0);
check('课堂教练风格需要清晰任务或检查点', evaluateStyleAuthenticity('classroom_coach', styleResponse('本轮先完成一项检查，核对后再进入下一步。'), { phase: 2 }).issues.length === 0);
check('固定安全触发可标记为中性而不冒充风格证据', evaluateStyleAuthenticity('warm_companion', { ...styleResponse('请完成安全确认。'), safety_quiz: { question: '怎么做？', options: ['安全', '危险'], correct: 0 } }, { phase: 3, triggerType: 'STAGE_ENTER' }).neutralSystemResponse);
check('P1 结构化确认轮不被强迫追加开放问题', evaluateStyleAuthenticity('socratic_concise', {
  ...styleResponse('请查看探究问题确认书。'),
  next_action_type: 'confirmation',
  stage1_confirmed: true,
  snapshot: '研究问题确认书',
  theme_mapping: { originalInterest: '植物', retainedFeature: '光照', classroomProxy: '绿豆', researchQuestion: '光照如何影响绿豆？' },
  topic_direction: { factor: '光照', phenomenon: '绿豆生长' },
}, { phase: 1 }).neutralSystemResponse);
check('P2 方案与表格确认轮不被强迫追加开放问题', evaluateStyleAuthenticity('socratic_concise', {
  ...styleResponse('方案和数据表已经生成，请核对。'),
  next_action_type: 'confirmation',
  experiment_plan: {
    independentVariable: { name: '光照时长', levels: ['4小时', '8小时'] },
    dependentVariable: { name: '株高', measurement: '第5天测量株高（cm）' },
    controlledVariables: ['品种'], materials: ['绿豆'], procedure: ['测量'], repeatCount: 3, safetyNotes: [],
  },
  data_table_schema: { columns: [{ key: 'notes', title: '备注', type: 'text', required: false }], minRows: 3, maxRows: 200 },
}, { phase: 2 }).neutralSystemResponse);

for (const family of STYLE_FAMILIES) {
  const instruction = buildStyleInstruction(family);
  check(`${STYLE_POLICIES[family].label} 指令含标签与边界`, instruction.includes(STYLE_POLICIES[family].label) && instruction.includes('不能覆盖当前实验阶段'));
  const prompt = getPromptForPhase(PhaseEnum.TopicSelection, { styleFamily: family, stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION });
  check(`${STYLE_POLICIES[family].label} 注入正式阶段提示词`, prompt.includes(instruction));
}

const sourceRecord: ShareGPTRecord = {
  id: 'style-export-test',
  scenario: '风格训练导出测试',
  phase: 1,
  meta: { expectedTransformation: { hidden: 'evaluator-only' } },
  conversations: [
    { from: 'human', value: '我想研究纸桥。' },
    { from: 'gpt', value: JSON.stringify({ dialogue: '你最想比较纸桥的哪个特征？', next_action_type: 'text_input', phase_complete: false }) },
  ],
};
const recordStyle = resolveRecordStyle(sourceRecord, 'engineering_mentor', DEFAULT_STYLE_POLICY_VERSION);
const enriched = withStyleMetadata(sourceRecord, recordStyle);
check('人工修订记录写入风格元数据', enriched.meta?.styleFamily === 'engineering_mentor' && enriched.meta?.stylePolicyVersion === DEFAULT_STYLE_POLICY_VERSION);
const trainingRecord = toTrainingShareGPTRecord(enriched, recordStyle);
check('训练导出首条为模型可见 system 风格指令', trainingRecord.conversations[0].from === 'system' && trainingRecord.conversations[0].value.includes('工程导师型'));
check('训练导出包含完整生产阶段合同而非仅风格指令', trainingRecord.conversations[0].value.includes('阶段行为合同 stage-contract-v2') && trainingRecord.conversations[0].value.includes('选题定向'));
check('训练导出保留原始 human/gpt 对话', trainingRecord.conversations[1].from === 'human' && trainingRecord.conversations[2].from === 'gpt');
check('训练导出剥离 evaluator-only expectedTransformation', !Object.prototype.hasOwnProperty.call(trainingRecord.meta ?? {}, 'expectedTransformation'));
const multiTurn = toTrainingShareGPTRecords({
  ...enriched,
  id: 'multi-turn-style-export',
  conversations: [
    { from: 'human', value: '第一问' },
    { from: 'gpt', value: JSON.stringify({ dialogue: '先回答第一问。', next_action_type: 'text_input', phase_complete: false }) },
    { from: 'human', value: '第二问' },
    { from: 'gpt', value: JSON.stringify({ dialogue: '再回答第二问。', next_action_type: 'text_input', phase_complete: false }) },
  ],
  meta: {
    ...enriched.meta,
    generationContext: { turnSystemPrompts: ['第一轮生产提示词', '第二轮生产提示词'] },
  },
}, recordStyle);
check('多轮记录按导师轮次拆成两个训练样本', multiTurn.length === 2);
check('每个训练样本只有开头一条 system 消息', multiTurn.every((item) => item.conversations.filter((message) => message.from === 'system').length === 1 && item.conversations[0].from === 'system'));
check(
  '第二轮训练样本使用纯 dialogue 历史且只把当前目标保留为 JSON',
  multiTurn[1].conversations.length === 5
    && multiTurn[1].conversations[0].value === '第二轮生产提示词'
    && multiTurn[1].conversations[2].value === '先回答第一问。'
    && JSON.parse(multiTurn[1].conversations[4].value).dialogue === '再回答第二问。'
);
check(
  '所有多轮训练样本通过历史导师 JSON 硬门禁',
  multiTurn.every((item) => {
    try {
      assertTrainingConversationFormat(item);
      return true;
    } catch {
      return false;
    }
  })
);
let rejectedHistoricalJson = false;
try {
  assertTrainingConversationFormat({
    ...multiTurn[1],
    conversations: multiTurn[1].conversations.map((message, index) => index === 2
      ? { ...message, value: JSON.stringify({ dialogue: '错误历史格式', next_action_type: 'text_input', phase_complete: false }) }
      : message),
  });
} catch {
  rejectedHistoricalJson = true;
}
check('发布门禁拒绝历史导师 ChatResponse JSON', rejectedHistoricalJson);
const productionHistory = toTrainingShareGPTRecord({
  ...enriched,
  id: 'production-history-export',
  meta: {
    ...enriched.meta,
    systemPrompt: '生产完整提示词',
    generationContext: {
      modelVisibleHistory: [
        { role: 'assistant', content: '欢迎开始探究。' },
        { role: 'user', content: '我想先比较纸桥宽度。' },
        { role: 'assistant', content: '你准备比较哪些宽度？' },
      ],
    },
  },
}, recordStyle);
check(
  '生产训练导出恢复模型当轮实际看到的对话历史',
  productionHistory.conversations.length === 6
    && productionHistory.conversations[0].from === 'system'
    && productionHistory.conversations[1].from === 'gpt'
    && productionHistory.conversations[3].value === '你准备比较哪些宽度？'
    && productionHistory.conversations[4].from === 'human'
);
const styleCounts = summarizeStyles([recordStyle, recordStyle, resolveRecordStyle(sourceRecord, 'warm_companion')]);
check('manifest 风格汇总按最终入选记录计数', styleCounts.engineering_mentor === 2 && styleCounts.warm_companion === 1);

const evaluationAggregate = aggregateEvaluationsByStyle([
  { styleFamily: 'warm_companion', summaryJson: JSON.stringify({ scenario: { A: 2, B: 1, tie: 0, inconsistent: 0 } }) },
  { styleFamily: 'warm_companion', summaryJson: JSON.stringify({ scenario: { A: 1, B: 1, tie: 1, inconsistent: 1 } }) },
  { styleFamily: null, summaryJson: '{}' },
]);
check('双盲结果按目标风格累计且忽略旧版未知风格', evaluationAggregate.warm_companion?.runs === 2 && evaluationAggregate.warm_companion.A === 3 && Object.keys(evaluationAggregate).length === 1);

console.log(`\nStyle policy tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
