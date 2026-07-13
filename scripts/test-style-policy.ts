import {
  ASSISTANT_STYLE_OPTIONS,
  AUTO_STYLE_STRATEGY_VERSION,
  DEFAULT_STYLE_POLICY_VERSION,
  STYLE_FAMILIES,
  STYLE_POLICIES,
  buildStyleInstruction,
  resolveStyleFamily,
} from '../app/lib/stylePolicy';
import { stylesForSampleSlots, weightedStyleSequence } from '../app/lib/dataLab/assignment';
import { getPromptForPhase } from '../app/prompts';
import { PhaseEnum } from '../app/models/types';
import { resolveRecordStyle, summarizeStyles, toTrainingShareGPTRecord, toTrainingShareGPTRecords, withStyleMetadata } from '../app/lib/dataLab/styleMetadata';
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
check('第二轮训练样本保留此前对话但不混入旧 system', multiTurn[1].conversations.length === 5 && multiTurn[1].conversations[0].value === '第二轮生产提示词');
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
