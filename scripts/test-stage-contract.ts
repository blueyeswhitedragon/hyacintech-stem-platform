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
function findings(phase: number, value: ChatResponse, triggerType: StageTriggerType = 'USER_MESSAGE', visibleContext = '{"a":2,"b":3,"c":5}') {
  return validateStageResponseBehavior(phase, value, { triggerType, visibleContext });
}
function codes(phase: number, value: ChatResponse, triggerType: StageTriggerType = 'USER_MESSAGE', visibleContext = '{"a":2,"b":3,"c":5}') {
  return findings(phase, value, triggerType, visibleContext).map((item) => item.code);
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
check('P1 正文变相三选一被拒', codes(1, response({ dialogue: '你觉得关键是电池容量、能量转化效率，还是车身重量？' })).includes('P1_HIDDEN_CHOICE'));
check('P1 两个相关问号降为人工复核且允许提交', findings(1, response({ dialogue: '植物受到哪些限制？其中最让你好奇的是哪一个？' })).some((item) => item.code === 'P1_MULTI_QUESTION_REVIEW' && item.severity === 'warning'));
check('P1 无问号但测量和步骤越界仍是硬错误', findings(1, response({ dialogue: '请同时确定研究问题、测量方式和实验步骤。' })).some((item) => item.severity === 'error' && ['P1_MEASUREMENT_OVERREACH', 'P1_PROCEDURE_OVERREACH'].includes(item.code)));

const plan = {
  independentVariable: { name: '光照时长', levels: ['短', '长'] },
  dependentVariable: { name: '发芽数', measurement: '每天同一时间计数，单位个', unit: '个' },
  controlledVariables: ['种子数'], materials: ['绿豆'], procedure: ['连续记录'], repeatCount: 3, safetyNotes: [],
};
const schema = {
  columns: [
    { key: 'day', title: '天数', type: 'number' as const, required: true },
    { key: 'short_light_result', title: '短光照发芽数（个）', type: 'number' as const, required: true },
    { key: 'long_light_result', title: '长光照发芽数（个）', type: 'number' as const, required: true },
    { key: 'notes', title: '备注', type: 'text' as const, required: false },
  ], minRows: 3, maxRows: 200,
};
const p2Visible = JSON.stringify({
  businessContext: '已确认关注光照时长与发芽数。',
  currentStudentMessage: '我确认比较短、长两种光照时长，每天同一时间计数发芽数，单位个，控制种子数，用绿豆连续记录，每个水平重复3次。',
  confirmedFacts: ['我确认比较短、长两种光照时长，每天同一时间计数发芽数，单位个，控制种子数，用绿豆连续记录，每个水平重复3次。'],
  priorStudentMessages: [],
});
check('P2 方案与宽表通过', codes(2, response({ next_action_type: 'confirmation', experiment_plan: plan, data_table_schema: schema }), 'USER_MESSAGE', p2Visible).filter((code) => code.startsWith('P2_')).length === 0);
check('P2 缺结构化方案被拒', codes(2, response({ next_action_type: 'confirmation', data_table_schema: schema })).includes('P2_PLAN_MISSING'));
check('P2 方案数字必须由学生或前序状态确认', codes(2, response({ next_action_type: 'confirmation', experiment_plan: plan, data_table_schema: schema }), 'USER_MESSAGE', '{"学生说":"比较2个水平"}').includes('P2_UNGROUNDED_PLAN_NUMBER'));
check('P2 引导不能凭空提供候选数字', codes(2, response({ dialogue: '你想每组用30粒还是50粒？' }), 'USER_MESSAGE', JSON.stringify({ currentStudentMessage: '各组绿豆数量保持一致。' })).includes('P2_UNGROUNDED_SUGGESTION_NUMBER'));
check('P2 步骤编号不被误判为候选数字', !codes(2, response({ dialogue: '步骤：\n1. 配制溶液\n2. 记录结果' }), 'USER_MESSAGE', JSON.stringify({ currentStudentMessage: '我确认配制溶液并记录结果。' })).includes('P2_UNGROUNDED_SUGGESTION_NUMBER'));
check('P2 结构化事实中无法逐字追溯的普通内容只提示复核', findings(2, response({ next_action_type: 'confirmation', experiment_plan: plan, data_table_schema: schema }), 'USER_MESSAGE', JSON.stringify({ currentStudentMessage: '我只确认短、长两种光照，重复3次。', confirmedFacts: ['我只确认短、长两种光照，重复3次。'] })).some((item) => item.code === 'P2_POSSIBLE_UNGROUNDED_PLAN_ITEM' && item.severity === 'warning'));
check('P2 通用高低水平被拒', codes(2, response({ experiment_plan: { ...plan, independentVariable: { name: '光照时长', levels: ['较低', '中等', '较高'] } } }), 'USER_MESSAGE', p2Visible).includes('P2_GENERIC_LEVELS_FORBIDDEN'));
check('P2 否定“结果表明”不误判', !codes(2, response({ dialogue: '现在还不能说“结果表明”，先把方案补完整。' })).includes('P2_PREMATURE_RESULT'));
check('P2 真正提前给结果仍被拒', codes(2, response({ dialogue: '结果表明长光照组发芽更多。' })).includes('P2_PREMATURE_RESULT'));
const indexOnlySchema = { columns: [{ key: 'day', title: '天数', type: 'number' as const, required: true }, { key: 'notes', title: '备注', type: 'text' as const, required: false }], minRows: 3, maxRows: 200 };
check('P2 只有 day 数值索引列不能冒充结果列', codes(2, response({ next_action_type: 'confirmation', experiment_plan: plan, data_table_schema: indexOnlySchema }), 'USER_MESSAGE', p2Visible).includes('P2_NUMERIC_RESULT_COLUMN_MISSING'));

check('P3 首次进入必须安全题', codes(3, response({}), 'STAGE_ENTER').includes('P3_SAFETY_QUIZ_MISSING'));
check('P3 提前分析被拒', codes(3, response({ dialogue: '数据显示第二组变化趋势更明显。' })).includes('P3_ANALYSIS_OVERREACH'));
check('P3 否定性趋势提醒不误判', !codes(3, response({ dialogue: '现在不要分析变化趋势，只记录真实现象。' })).includes('P3_ANALYSIS_OVERREACH'));
check('P3 否定性新增组提醒不误判', !codes(3, response({ dialogue: '不要增加新的实验组，继续按审核方案执行。' })).includes('P3_CORE_PLAN_CHANGE'));
check('P3 普通材料同义改写不被硬拒', !codes(3, response({ dialogue: '请记录种子的实际状态。' }), 'USER_MESSAGE', JSON.stringify({ businessContext: '已审核材料：绿豆和清水。' })).includes('P3_UNAPPROVED_SAFETY_CRITICAL_ITEM'));
check('P3 新增高风险设备被拒', codes(3, response({ dialogue: '请再用酒精灯加热。' }), 'USER_MESSAGE', JSON.stringify({ businessContext: '已审核材料：绿豆和清水。' })).includes('P3_UNAPPROVED_SAFETY_CRITICAL_ITEM'));
check('P3 未审核美工刀至少进入安全复核', findings(3, response({ dialogue: '请用美工刀裁切材料。' }), 'USER_MESSAGE', JSON.stringify({ businessContext: '已审核材料：绿豆和清水。' })).some((item) => item.code === 'P3_UNAPPROVED_EQUIPMENT_REVIEW' && item.severity === 'warning'));

const transition = response({ dialogue: '我已读取数据表。先比较两列，并引用具体数值说明哪一列变化更明显。' });
const transitionContext = JSON.stringify({ businessContext: { dataRows: [{ low: 2, high: 5 }] } });
check('P4 主动开场由真实 dataRows 承接数据', !codes(4, transition, 'STAGE_TRANSITION', transitionContext).includes('P4_TRANSITION_NOT_GROUNDED'));
check('P4 正文说有数据但上下文没有 rows 仍被拒', codes(4, transition, 'STAGE_TRANSITION').includes('P4_TRANSITION_NOT_GROUNDED'));
check('P4 主动开场不能伪造进度', codes(4, response({ dialogue: transition.dialogue, analysis_progress: { observation: '更高', evidenceCitations: ['2与5'], studentEvidenceAccepted: true } }), 'STAGE_TRANSITION', transitionContext).includes('P4_TRANSITION_PROGRESS_FORBIDDEN'));
check('P4 接受证据必须有引用', codes(4, response({ analysis_progress: { observation: '更高', studentEvidenceAccepted: true } })).includes('P4_ACCEPTED_EVIDENCE_INCOMPLETE'));
const p4Grounded = JSON.stringify({
  businessContext: { dataRows: [{ result: 2 }, { result: 5 }] },
  currentStudentMessage: '第1行是2，第2行是5，所以我观察到2比5小。',
});
check('P4 两个真实值可形成学生证据', !codes(4, response({ analysis_progress: { observation: '2比5小', evidenceCitations: ['第1行2', '第2行5'], studentEvidenceAccepted: true } }), 'USER_MESSAGE', p4Grounded).includes('P4_STUDENT_EVIDENCE_TOO_THIN'));
const p4StringNested = JSON.stringify({
  businessContext: JSON.stringify({ dataRows: [{ result: 2 }, { result: 5 }] }),
  currentStudentMessage: '第1行是2，第2行是5。',
});
check('P4 JSON 字符串嵌套数据仍可核验', !codes(4, response({ analysis_progress: { observation: '2比5小', evidenceCitations: ['第1行2', '第2行5'], studentEvidenceAccepted: true } }), 'USER_MESSAGE', p4StringNested).includes('P4_STUDENT_EVIDENCE_TOO_THIN'));
check('P4 只有一个真实值不能接受进度', codes(4, response({ analysis_progress: { observation: '结果是2', evidenceCitations: ['第1行2'], studentEvidenceAccepted: true } }), 'USER_MESSAGE', JSON.stringify({ businessContext: { dataRows: [{ result: 2 }, { result: 5 }] }, currentStudentMessage: '我只看到2。' })).includes('P4_STUDENT_EVIDENCE_TOO_THIN'));
const equalEvidence = JSON.stringify({ businessContext: { dataRows: [{ group: 'A', result: 5 }, { group: 'B', result: 5 }] }, currentStudentMessage: 'A组是5，B组也是5。' });
check('P4 A=5、B=5 可作为两个可追溯数据位置', !codes(4, response({ analysis_progress: { observation: '两组相同', evidenceCitations: ['A组5', 'B组5'], studentEvidenceAccepted: true } }), 'USER_MESSAGE', equalEvidence).includes('P4_STUDENT_EVIDENCE_TOO_THIN'));
check('P4 因果过度被拒', codes(4, response({ dialogue: '这证明了光照一定导致发芽增加。' })).includes('P4_CAUSAL_OVERCLAIM'));
check('P4 否定因果通过', !codes(4, response({ dialogue: '这还不能说明光照导致发芽增加。' })).includes('P4_CAUSAL_OVERCLAIM'));
check('P4 前句否定不能掩盖后句确定因果', codes(4, response({ dialogue: '虽然还不能排除误差，但这说明光照导致发芽增加。' })).includes('P4_CAUSAL_OVERCLAIM'));
check('P4 换一种措辞给结论至少进入复核', findings(4, response({ dialogue: '可以得到的结论为：光照越长，发芽越多。' })).some((item) => item.code === 'P4_POSSIBLE_DIRECT_CONCLUSION' && item.severity === 'warning'));
check('P4 引用可见数据外数字被拒', codes(4, response({ dialogue: '数据显示结果是9。' })).includes('P4_UNSEEN_NUMBER'));

check('P5 初始化必须输出框架', codes(5, response({}), 'REPORT_BOOTSTRAP').includes('P5_REPORT_SECTIONS_MISSING'));
check('P5 否定完整报告声明不误判', !codes(5, response({ dialogue: '这只是报告框架，不是可直接提交的完整报告。' })).includes('P5_OVERHELPED_REPORT'));
check('P5 肯定可直接提交声明被拒', codes(5, response({ dialogue: '报告已经写好，可以直接提交。' })).includes('P5_OVERHELPED_REPORT'));
check('P5 无来源数字是硬错误', codes(5, response({ dialogue: '报告中记录结果为9。' })).includes('P5_UNSEEN_NUMBER'));
check('P5 后续核对轮必须使用 text_input', codes(5, response({ next_action_type: 'info' }), 'USER_MESSAGE').includes('P5_FOLLOWUP_ACTION_INVALID'));
check('P6 禁止 confirmation 完成', codes(6, response({ next_action_type: 'confirmation', phase_complete: true }), 'OPTIONAL_COACHING').includes('P6_COMPLETION_SIGNAL_INVALID'));
check('P6 两个相关问号降为人工复核且允许提交', findings(6, response({ dialogue: '你认为最大局限是什么？它会怎样影响结论？' }), 'OPTIONAL_COACHING').some((item) => item.code === 'P6_MULTI_QUESTION_REVIEW' && item.severity === 'warning'));
check('P6 最终表单提交不能触发导师模型', codes(6, response({}), 'FINAL_SUBMISSION').includes('P6_FINAL_SUBMISSION_MUST_BYPASS_LLM'));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
