import { assertTrainingConversationFormat } from '../app/lib/dataLab/styleMetadata';
import type { TrainingShareGPTRecord } from '../app/lib/dataLab/types';
import { buildVisibleFacts, validateStageResponseBehavior, type StageTriggerType } from '../app/lib/stageContract';
import { evaluateStyleAuthenticity } from '../app/lib/stylePolicy';
import { validateShareGPTRecord } from '../app/lib/dataLab/validation';
import type { ShareGPTRecord } from '../app/lib/dataLab/types';
import type { ChatResponse } from '../app/models/types';
import { reachedDatasetV3Stop } from './dataset-v3-rollout-policy';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
function response(extra: Partial<ChatResponse>): ChatResponse {
  return { dialogue: '请继续说明。', next_action_type: 'text_input', phase_complete: false, ...extra };
}
function codes(phase: number, value: ChatResponse, visibleContext: string, triggerType: StageTriggerType = 'USER_MESSAGE') {
  return validateStageResponseBehavior(phase, value, { visibleContext, triggerType }).map((item) => item.code);
}

const facts = buildVisibleFacts({
  visibleContext: JSON.stringify({
    businessContext: { dataRows: [{ height_mm: 12 }, { height_mm: 18 }] },
    priorStudentMessages: ['我用刻度尺测株高。'],
    currentStudentMessage: '第1次是12 mm，第2次是18 mm。',
  }),
});
check('VisibleFacts 只合并业务状态和学生消息', facts.dataNumericTokens.includes('12') && facts.studentText.includes('刻度尺') && !facts.sourceText.includes('evaluatorOnly'));

check('P1 括号中的隐藏菜单也被拒绝', codes(1, response({ dialogue: '你最关心哪一部分（电池、效率，还是重量）？' }), '{}').includes('P1_HIDDEN_CHOICE'));

const plan = {
  independentVariable: { name: '光照时长', levels: ['4 h', '8 h'] },
  dependentVariable: { name: '株高', measurement: '第7天测量株高，单位mm' },
  controlledVariables: ['浇水量'],
  materials: ['绿豆', '刻度尺'],
  procedure: ['每天照明', '第7天测量'],
  repeatCount: 3,
  safetyNotes: ['避免直视LED灯'],
};
const badSchema = {
  columns: [
    { key: 'trial', title: '重复序号', type: 'number' as const, required: true },
    { key: 'result_a', title: '4 h株高（mm）', type: 'number' as const, required: true },
    { key: 'notes', title: '备注', type: 'text' as const, required: false },
  ],
  minRows: 3,
  maxRows: 200,
};
const p2Context = JSON.stringify({ currentStudentMessage: '我确认光照时长是4 h和8 h，第7天用刻度尺测株高，单位mm，控制浇水量，用绿豆每天照明并第7天测量，重复3次，避免直视LED灯。' });
check('P2 schema 缺少真实水平列时被拒', codes(2, response({ next_action_type: 'confirmation', experiment_plan: plan, data_table_schema: badSchema }), p2Context).includes('P2_SCHEMA_PLAN_MISMATCH'));

check('P3 安全题不能凭空加入酒精灯', codes(3, response({
  safety_quiz: { question: '酒精灯打翻怎么办？', options: ['用湿布覆盖', '继续加热'], correct: 0 },
}), JSON.stringify({ businessContext: { approvedPlan: { materials: ['绿豆'], safetyRisks: ['避免直视LED灯'] } } }), 'STAGE_ENTER').includes('P3_SAFETY_QUIZ_UNGROUNDED'));

check('P4 导师引用表外数字会硬拒绝', codes(4, response({ dialogue: '你引用的12和99分别来自哪一行？' }), JSON.stringify({ businessContext: { dataRows: [{ value: 12 }, { value: 18 }] }, currentStudentMessage: '我看到12和18。' })).includes('P4_UNSEEN_NUMBER'));
check('P4 无法确定语义等价时进入人工复核', codes(4, response({ analysis_progress: { observation: '整体呈平台期', evidenceCitations: ['12', '18'], studentEvidenceAccepted: true } }), JSON.stringify({ businessContext: { dataRows: [{ value: 12 }, { value: 18 }] }, currentStudentMessage: '我只引用12和18。' })).includes('P4_PROGRESS_PARAPHRASE_REVIEW'));

const p5 = response({
  next_action_type: 'info',
  report_sections: {
    purpose: '研究光照时长如何影响株高',
    hypothesis: '光照时长会使株高出现差异',
    materials: '绿豆、刻度尺、酒精灯',
    procedure: '每天照明，第7天测量',
    dataSummary: '4 h组为12 mm，8 h组为18 mm',
    analysis: '学生已比较12 mm和18 mm，但没有确定因果',
  },
});
check('P5 新增前序方案没有的高风险材料会被拒', codes(5, p5, JSON.stringify({ businessContext: '研究光照时长如何影响株高。假设光照时长会使株高出现差异。材料绿豆、刻度尺。步骤每天照明，第7天测量。数据12 mm和18 mm。学生已比较12 mm和18 mm，但没有确定因果。' }), 'REPORT_BOOTSTRAP').includes('P5_UNSEEN_SAFETY_CRITICAL_ITEM'));

check('P6 直接给改进方案会被拒', codes(6, response({ dialogue: '改进方案是增加一组实验。' }), '{}', 'OPTIONAL_COACHING').includes('P6_DIRECT_REFLECTION_OR_NEW_EXPERIMENT'));

const validTraining: TrainingShareGPTRecord = {
  id: 'training-gate', scenario: '测试', phase: 4,
  conversations: [
    { from: 'system', value: '生产提示词' },
    { from: 'human', value: '第一问' },
    { from: 'gpt', value: '先引用两个数值。' },
    { from: 'human', value: '第二问' },
    { from: 'gpt', value: JSON.stringify(response({ dialogue: '当前目标。' })) },
  ],
};
assertTrainingConversationFormat(validTraining);
let historyJsonRejected = false;
try {
  assertTrainingConversationFormat({
    ...validTraining,
    conversations: validTraining.conversations.map((message, index) => index === 2
      ? { ...message, value: JSON.stringify(response({ dialogue: '错误历史。' })) }
      : message),
  });
} catch { historyJsonRejected = true; }
check('训练发布门禁拒绝历史导师 JSON', historyJsonRejected);

check('风格标签没有可观察证据时不能过关', evaluateStyleAuthenticity('evidence_analyst', response({ dialogue: '请继续。' }), { phase: 4 }).issues.length > 0);

check('P3 安全题后必须再有一轮普通互动才能停止',
  !reachedDatasetV3Stop(3, response({ safety_quiz: { question: '怎么做？', options: ['安全', '危险'], correct: 0 } }), {
    turns: 1, acceptedEvidence: 0, hasSafetyQuiz: true, hasReportSections: false,
  }) && reachedDatasetV3Stop(3, response({ dialogue: '你准备先记录哪一项？' }), {
    turns: 2, acceptedEvidence: 0, hasSafetyQuiz: true, hasReportSections: false,
  }));
check('P5 报告框架后必须再有一轮普通核对才能停止',
  !reachedDatasetV3Stop(5, p5, { turns: 1, acceptedEvidence: 0, hasSafetyQuiz: false, hasReportSections: true })
  && reachedDatasetV3Stop(5, response({ dialogue: '你想先核对哪个字段的来源？' }), { turns: 2, acceptedEvidence: 0, hasSafetyQuiz: false, hasReportSections: true }));

const recordLevelStyle: ShareGPTRecord = {
  id: 'record-style-evidence', scenario: '记录级风格证据', phase: 6,
  conversations: [
    { from: 'human', value: '我想检查证据是否可靠。' },
    { from: 'gpt', value: JSON.stringify(response({ dialogue: '哪两条证据最能支持你当前的判断？' })) },
    { from: 'human', value: '我已经找到两条。' },
    { from: 'gpt', value: JSON.stringify(response({ dialogue: '你下一步准备检查什么？' })) },
  ],
  meta: {
    styleFamily: 'evidence_analyst',
    stageContractVersion: 'stage-contract-v2',
    systemPrompt: '测试提示词',
    stageTriggerType: 'OPTIONAL_COACHING',
    visibleContext: JSON.stringify({ tutorVisible: {} }),
    generationContext: { turnTriggerTypes: ['OPTIONAL_COACHING', 'OPTIONAL_COACHING'] },
  },
};
check('风格按整条记录验收，不因单个普通轮缺少风格词误杀',
  !validateShareGPTRecord(recordLevelStyle, 'submit').issues.some((item) => item.ruleCode === 'STYLE_NOT_OBSERVABLE'));
check('整条记录都没有风格证据时进入人工复核但不硬拒',
  validateShareGPTRecord({
    ...recordLevelStyle,
    conversations: recordLevelStyle.conversations.map((message) => message.from === 'gpt'
      ? { ...message, value: JSON.stringify(response({ dialogue: '请继续说明。' })) }
      : message),
  }, 'submit').issues.some((item) => item.ruleCode === 'STYLE_NOT_OBSERVABLE' && item.severity === 'warning'));

console.log(`\nDataset v3 adversarial gates: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
