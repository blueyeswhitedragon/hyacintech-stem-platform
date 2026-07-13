/** stage-contract-v2 deterministic allow/forbid tests. */
import type { ChatResponse } from '../app/models/types';
import { validateStageResponseBehavior, type StageTriggerType } from '../app/lib/stageContract';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
function response(extra: Partial<ChatResponse>): ChatResponse {
  return { dialogue: '请继续说明。', next_action_type: 'text_input', phase_complete: false, ...extra };
}
function codes(phase: number, value: ChatResponse, triggerType: StageTriggerType = 'USER_MESSAGE') {
  return validateStageResponseBehavior(phase, value, { triggerType, visibleContext: '{"a":2,"b":5}' }).map((item) => item.code);
}

console.log('stage-contract-v2:');
const p1Valid = response({
  dialogue: '请查看确认书。测量方式和控制变量留到下一阶段。',
  next_action_type: 'confirmation',
  phase_complete: true,
  stage1_confirmed: true,
  snapshot: '研究问题：光照方向与发芽表现。具体方案留到阶段2。',
  theme_mapping: { originalInterest: '种植物', retainedFeature: '人工光照', classroomProxy: '改变光照方向', researchQuestion: '光照方向是否影响发芽表现' },
  topic_direction: { factor: '光照方向', phenomenon: '发芽表现' },
});
check('P1 合法确认通过', codes(1, p1Valid).filter((code) => code.startsWith('P1_')).length === 0);
check('P1 测量越界被拒', codes(1, response({ dialogue: '你准备用什么仪器测量株高？' })).includes('P1_MEASUREMENT_OVERREACH'));
check('P1 延后声明不能掩盖同回复组别越界', codes(1, response({ dialogue: '测量方式留到下一阶段；现在先设定三个水平。' })).includes('P1_LEVEL_OVERREACH'));
check('P1 选择菜单被拒', codes(1, response({ next_action_type: 'ask_choice', options: ['温度', '光照'] })).includes('P1_CHOICE_ACTION_FORBIDDEN'));

const plan = {
  independentVariable: { name: '光照时长', levels: ['短', '长'] },
  dependentVariable: { name: '发芽数', measurement: '每天同一时间计数' },
  controlledVariables: ['种子数'], materials: ['绿豆'], procedure: ['连续记录'], safetyNotes: [],
};
const schema = {
  columns: [
    { key: 'day', title: '天数', type: 'number' as const, required: true },
    { key: 'short_light_result', title: '短光照发芽数', type: 'number' as const, required: true },
    { key: 'long_light_result', title: '长光照发芽数', type: 'number' as const, required: true },
    { key: 'notes', title: '备注', type: 'text' as const, required: false },
  ], minRows: 3, maxRows: 200,
};
check('P2 方案与宽表通过', codes(2, response({ next_action_type: 'confirmation', experiment_plan: plan, data_table_schema: schema })).filter((code) => code.startsWith('P2_')).length === 0);
check('P2 缺结构化方案被拒', codes(2, response({ next_action_type: 'confirmation', data_table_schema: schema })).includes('P2_PLAN_MISSING'));

check('P3 首次进入必须安全题', codes(3, response({}), 'STAGE_ENTER').includes('P3_SAFETY_QUIZ_MISSING'));
check('P3 提前分析被拒', codes(3, response({ dialogue: '数据显示第二组变化趋势更明显。' })).includes('P3_ANALYSIS_OVERREACH'));

const transition = response({ dialogue: '我已读取数据表。先比较两列，并引用具体数值说明哪一列变化更明显。' });
check('P4 主动开场承接数据', !codes(4, transition, 'STAGE_TRANSITION').includes('P4_TRANSITION_NOT_GROUNDED'));
check('P4 主动开场不能伪造进度', codes(4, response({ dialogue: transition.dialogue, analysis_progress: { observation: '更高', evidenceCitations: ['2与5'], studentEvidenceAccepted: true } }), 'STAGE_TRANSITION').includes('P4_TRANSITION_PROGRESS_FORBIDDEN'));
check('P4 接受证据必须有引用', codes(4, response({ analysis_progress: { observation: '更高', studentEvidenceAccepted: true } })).includes('P4_ACCEPTED_EVIDENCE_INCOMPLETE'));
check('P4 因果过度被拒', codes(4, response({ dialogue: '这证明了光照一定导致发芽增加。' })).includes('P4_CAUSAL_OVERCLAIM'));
check('P4 引用可见数据外数字被拒', codes(4, response({ dialogue: '数据显示结果是9。' })).includes('P4_UNSEEN_NUMBER'));

check('P5 初始化必须输出框架', codes(5, response({}), 'REPORT_BOOTSTRAP').includes('P5_REPORT_SECTIONS_MISSING'));
check('P6 禁止 confirmation 完成', codes(6, response({ next_action_type: 'confirmation', phase_complete: true }), 'OPTIONAL_COACHING').includes('P6_COMPLETION_SIGNAL_INVALID'));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
