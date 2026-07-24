import { attachDeterministicArtifacts, buildDataTableSchema } from '../app/lib/stageArtifacts';
import { attachServerOwnedArtifacts } from '../app/lib/serverTutorState';
import { validateStageResponseBehavior } from '../app/lib/stageContract';
import { studentVisibleStageData } from '../app/lib/stageState';
import type { ChatResponse, ExperimentPlan } from '../app/models/types';
import type { StageData } from '../app/models/stageData';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const plan: ExperimentPlan = {
  researchQuestion: '白醋稀释液pH如何影响第5天发芽率？',
  hypothesis: '不同pH会使第5天发芽率出现差异。',
  independentVariable: { name: '白醋稀释液pH', levels: ['pH 4.5', 'pH 5.5', 'pH 6.5'] },
  dependentVariable: { name: '第5天发芽率', measurement: '第5天统计已发芽种子数并计算百分比', unit: '%' },
  controlledVariables: ['绿豆数量', '培养温度'],
  materials: ['绿豆', '白醋稀释液', '培养皿'],
  procedure: ['配制三种pH稀释液', '第5天统计发芽数'],
  repeatCount: 3,
  safetyNotes: ['只使用教师配制的白醋稀释液'],
};

const schema = buildDataTableSchema(plan)!;
check('P2 数据表由方案确定性生成', schema.columns.length === 5 && schema.columns.at(-1)?.key === 'notes');
check('P2 明确单位进入结果列标题', schema.columns.filter((column) => column.key.startsWith('result_')).every((column) => column.title.includes('%')));
check('P2 不会把“第5天”中的“天”误当测量单位', !schema.columns.some((column) => /（天）/.test(column.title)));

const p2Response: ChatResponse = {
  dialogue: '方案信息已完整，请核对。', next_action_type: 'confirmation', phase_complete: false,
  experiment_plan: plan, data_table_schema: schema,
  artifact_provenance: { data_table_schema: 'server_composed' },
};
const confirmedText = [
  plan.researchQuestion!, plan.hypothesis!,
  '我确认白醋稀释液pH水平为pH 4.5、pH 5.5、pH 6.5。',
  '第5天统计已发芽种子数并计算百分比，单位%。',
  '控制绿豆数量和培养温度。', '材料是绿豆、白醋稀释液、培养皿。',
  '步骤是配制三种pH稀释液，第5天统计发芽数。',
  '每个水平重复3次，只使用教师配制的白醋稀释液。',
];
const p2Issues = validateStageResponseBehavior(2, p2Response, {
  visibleContext: JSON.stringify({ confirmedFacts: confirmedText, currentStudentMessage: confirmedText.at(-1) }),
});
check('P2 服务器生成表与确认方案通过契约', !p2Issues.some((item) => item.severity === 'error'));

const stage3Entry = attachServerOwnedArtifacts({
  stage: 3,
  stageData: { stage2: { schema, experimentPlan: plan, submitted: true, approved: true } },
  triggerType: 'STAGE_ENTER',
  safetyQuizCompleted: false,
});
check('P3 服务端状态不持久化安全题答案键', !Object.hasOwn(stage3Entry.stageData.stage3?.safetyQuiz ?? {}, 'correct'));
check('P3 学生响应不包含安全题答案键', !Object.hasOwn(stage3Entry.envelope.artifacts?.safety_quiz ?? {}, 'correct'));
const sanitized = studentVisibleStageData({
  stage3: { rows: [], safetyQuiz: { question: '旧题', options: ['A', 'B'], correct: 1, passed: false } },
});
check('旧会话答案键在学生边界被剥离', !Object.hasOwn(sanitized.stage3?.safetyQuiz ?? {}, 'correct'));

const stageData: StageData = {
  stage1: {
    confirmed: true, snapshot: '研究白醋稀释液pH与第5天发芽率。', variables: { independent: '白醋稀释液pH' },
    themeMapping: { originalInterest: '发芽', retainedFeature: '酸碱度', classroomProxy: '白醋稀释液pH', researchQuestion: plan.researchQuestion! },
    factorDirection: '白醋稀释液pH', phenomenonDirection: '第5天发芽率',
  },
  stage2: { schema, experimentPlan: plan, aiRiskAnnotations: [], submitted: true, approved: true },
  stage3: { rows: [
    { trial: 1, result_a: 45, result_b: 60, result_c: 55, notes: '' },
    { trial: 2, result_a: 50, result_b: 65, result_c: 58, notes: '第二行有一粒种皮破损' },
    { trial: 3, result_a: 48, result_b: 63, result_c: 57, notes: '' },
  ] },
  stage4: { analysisCount: 2, evidenceRounds: [{
    observation: 'pH 5.5三次记录都高于pH 4.5。', citations: ['45与60', '50与65'], matchedValues: ['45', '60', '50', '65'],
    interpretation: '目前只说明有差异，不能确定因果。',
  }] },
};
const p5Base: ChatResponse = { dialogue: '框架已按可追溯状态生成，请核对来源。', next_action_type: 'info', phase_complete: false };
const p5Context = { stageData, priorSummary: '结构化摘要' };
const p5Response = attachDeterministicArtifacts(5, p5Base, p5Context, 'REPORT_BOOTSTRAP');
check('P5 六字段由服务器确定性生成', !!p5Response.report_sections && Object.values(p5Response.report_sections).every(Boolean));
check('P5 报告标记服务器来源', p5Response.artifact_provenance?.report_sections === 'server_composed');
const p5Issues = validateStageResponseBehavior(5, p5Response, {
  triggerType: 'REPORT_BOOTSTRAP', visibleContext: JSON.stringify({ businessContext: p5Context }),
});
check('P5 确定性报告不受同义词词面门禁误杀', !p5Issues.some((item) => item.severity === 'error'));

console.log(`\nstage-artifacts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
