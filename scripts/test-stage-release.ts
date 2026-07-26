/** 确定性单测：教师放行状态机、服务器产物、留痕幂等与正向训练隔离。 */
import { applyRelease, applyReview } from '../app/lib/review';
import { hasStageRelease, releasedTraceBlockReason } from '../app/lib/releasePolicy';
import { canAdvance } from '../app/lib/stageAdvance';
import type { StageData } from '../app/models/stageData';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
}

const common = { reason: '学生已经多轮尝试，教师确认可以继续下一阶段', teacherId: 'teacher-1', occurredAt: '2026-07-25T00:00:00.000Z' };
const stage2: StageData = {
  stage2: { submitted: false, approved: null, schema: { columns: [], minRows: 3, maxRows: 200 } },
};
const released2 = applyRelease(2, 2, stage2, common);
check('P2 放行进入 P3', released2.ok && released2.currentStage === 3 && released2.stageData.stage2?.approved === true);

const stage3: StageData = { stage3: { rows: [], submitted: false } };
const released3 = applyRelease(3, 3, stage3, common);
check('P3 放行进入 P4', released3.ok && released3.currentStage === 4 && released3.stageData.stage3?.approved === true);

const stage5: StageData = {
  stage5: {
    submitted: false,
    approved: false,
    teacherScore: 5,
    sections: { purpose: '', hypothesis: '', materials: '', procedure: '', dataSummary: '', analysis: '', conclusion: '', reflection: '' },
  },
};
const released5 = applyRelease(5, 5, stage5, { ...common, score: 5 });
check('P5 可保留 5 分并放行到 P6', released5.ok && released5.currentStage === 6 && released5.stageData.stage5?.approved === true && released5.stageData.stage5.teacherScore === 5);

check('放行理由必填且至少 10 字', !applyRelease(2, 2, stage2, { ...common, reason: '太短' }).ok);
check('只能放行当前阶段', !applyRelease(2, 3, stage2, common).ok);
check('P5 放行必须记录实际评分', !applyRelease(5, 5, stage5, common).ok);

const repeated = applyRelease(2, 2, released2.stageData, common);
check('相同放行重试不会重复追加', repeated.stageData.timeline?.releases?.length === 1);
check('放行轨迹包含教师、理由和阶段', released2.stageData.timeline?.releases?.[0]?.teacherId === 'teacher-1' && released2.stageData.timeline.releases[0].stage === 2);
check('放行阶段的轨迹被正向提名策略拒绝', Boolean(releasedTraceBlockReason(released2.stageData, 2)));
check('未放行阶段不被误伤', releasedTraceBlockReason(released2.stageData, 1) === null);
check('hasStageRelease 只命中被放行阶段', hasStageRelease(released2.stageData, 2) && !hasStageRelease(released2.stageData, 3));

const releasedWithoutStage2 = applyRelease(2, 2, {}, common);
const releaseSchema = releasedWithoutStage2.stageData.stage2?.schema;
check('P2 无 stage2 时补四列通用最小表', releaseSchema?.columns.length === 4);
check(
  'P2 放行表与方案来源明确标注 teacher_release',
  releaseSchema?.provenance === 'teacher_release'
    && releasedWithoutStage2.stageData.stage2?.planProvenance?.dataRecording?.source === 'teacher_release',
);
const noRows = canAdvance(3, 4, releasedWithoutStage2.stageData, { safetyQuizCompleted: true });
check('P2 无 stage2 放行后 3→4 只剩三行数据门禁', !noRows.ok && noRows.error === '请先录入至少 3 行实验数据');

const emptySchemaRelease = applyRelease(2, 2, stage2, common);
check('P2 空 columns 时同样补四列通用最小表', emptySchemaRelease.stageData.stage2?.schema.columns.length === 4);
const threeRows: Record<string, unknown>[] = [
  { trial: 1, condition: '方形截面', result: 10, notes: '' },
  { trial: 2, condition: '圆形截面', result: 7, notes: '' },
  { trial: 3, condition: '方形截面', result: 12, notes: '轻微偏移' },
];
const releasedWithRows: StageData = {
  ...releasedWithoutStage2.stageData,
  stage3: { rows: threeRows, submitted: false },
};
check('通用最小表补满三行后可通过 3→4', canAdvance(3, 4, releasedWithRows, { safetyQuizCompleted: true }).ok);

const originalSchema = {
  columns: [{ key: 'custom_result', title: '学生原表', type: 'number' as const, required: true }],
  minRows: 1,
  maxRows: 20,
};
const releasedWithExistingSchema = applyRelease(2, 2, {
  stage2: { submitted: false, approved: null, schema: originalSchema },
}, common);
check(
  '哨兵：P2 非空 schema 放行不覆盖学生原表',
  JSON.stringify(releasedWithExistingSchema.stageData.stage2?.schema) === JSON.stringify(originalSchema),
);

const released4 = applyRelease(4, 4, releasedWithRows, common);
check(
  'P4 放行进入 P5 并生成可编辑报告框架',
  released4.ok
    && released4.currentStage === 5
    && Boolean(released4.stageData.stage5?.sections)
    && released4.stageData.stage5?.sections.conclusion === '',
);
const existingSections = {
  purpose: '保留目的', hypothesis: '保留假设', materials: '保留材料', procedure: '保留步骤',
  dataSummary: '保留数据', analysis: '保留分析', conclusion: '保留结论', limitationsDiscussion: '保留局限', reflection: '保留局限',
};
const released4WithReport = applyRelease(4, 4, {
  ...releasedWithRows,
  stage5: { submitted: false, approved: null, sections: existingSections },
}, common);
check(
  '哨兵：P4 放行不覆盖已有报告框架',
  JSON.stringify(released4WithReport.stageData.stage5?.sections) === JSON.stringify(existingSections),
);

const chain2 = applyRelease(2, 2, {}, common);
const chain3 = applyRelease(3, 3, { ...chain2.stageData, stage3: { rows: threeRows, submitted: false } }, common);
const chain4 = applyRelease(4, 4, chain3.stageData, common);
const chain5 = applyRelease(5, 5, chain4.stageData, { ...common, score: 5 });
check(
  'P2→P3→P4→P5 放行链闭合到可响应的 P6',
  chain2.currentStage === 3
    && chain3.currentStage === 4
    && chain4.currentStage === 5
    && chain5.currentStage === 6
    && chain5.stageData.stage5?.approved === true
    && chain5.stageData.stage5.teacherScore === 5,
);

// 反向哨兵：普通审核没有 release 轨迹。
const approved = applyReview('approve', 2, 2, stage2, { feedback: '审核通过' });
check('哨兵：普通通过不写放行轨迹', !approved.stageData.timeline?.releases?.length);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
