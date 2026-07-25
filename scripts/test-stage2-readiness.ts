#!/usr/bin/env tsx
import { composeStage2Plan, evaluateStage2Readiness } from '../app/lib/stage2Readiness';
import { applyDeterministicExtractionFallbacks, mergeExtractedFacts } from '../app/lib/stateExtractor';
import { tutorFocusPlan } from '../app/lib/serverTutorState';
import type { ExtractedFact } from '../app/lib/stateExtractor';
import type { StageData } from '../app/models/stageData';

let passed = 0;
let failed = 0;

function check(condition: unknown, label: string) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

const base: StageData = {
  stage1: {
    confirmed: true,
    snapshot: '《探究问题确认书》\n研究问题：光照时长如何影响豆苗高度？',
    researchQuestion: '光照时长如何影响豆苗高度？',
  },
};

const coreFacts: ExtractedFact[] = [
  { field: 'stage2.independentVariable.name', value: '每天光照时长', sourceQuote: '控制每天光照时长' },
  { field: 'stage2.independentVariable.levels', value: ['0小时', '8小时', '12小时', '24小时'], sourceQuote: '0、8、12、24小时四组' },
  { field: 'stage2.dependentVariable.name', value: '豆苗高度', sourceQuote: '测量豆苗高度' },
  { field: 'stage2.dependentVariable.measurement', value: '第7天用刻度尺从种子量到茎尖', sourceQuote: '第7天用刻度尺从种子量到茎尖' },
  { field: 'stage2.measurement.tool', value: '刻度尺', sourceQuote: '刻度尺' },
  { field: 'stage2.measurement.timing', value: '第7天', sourceQuote: '第7天' },
  { field: 'stage2.recordedFields', value: ['豆苗高度'], sourceQuote: '豆苗高度' },
  { field: 'stage2.procedure', value: ['设置四个光照组', '第7天测量并记录高度'], sourceQuote: '设置四个光照组，第7天测量并记录高度' },
  { field: 'stage2.controlledVariables', value: ['营养液量', '水位'], sourceQuote: '营养液量水位等相同' },
  { field: 'stage2.repeatCount', value: 3, sourceQuote: '整个实验重复3轮' },
  { field: 'stage2.hypothesis', value: '光照越长豆苗越高', sourceQuote: '光照越长豆苗越高' },
];

const withoutRepeats = mergeExtractedFacts(2, base, coreFacts.filter((fact) => fact.field !== 'stage2.repeatCount')).stageData;
check(!evaluateStage2Readiness(withoutRepeats).complete, '缺少独立重复次数时四环节尚未就绪');
check(!withoutRepeats.stage2?.planDraft, '四环节未就绪时不生成方案预览');
check(tutorFocusPlan(2, withoutRepeats).allowedFocusIds[0] === 'experiment_process', 'Tutor 聚焦仍有缺口的实验过程环节');

const complete = mergeExtractedFacts(2, base, coreFacts).stageData;
const readiness = evaluateStage2Readiness(complete);
check(readiness.complete && readiness.completedSections.length === 4, '四个思考环节全部完成即就绪');
check(readiness.policyVersion === 'stage2-readiness-v2', '新会话使用 P2 v2 就绪合同');
check(tutorFocusPlan(2, complete).allowedFocusIds[0] === 'plan_confirmation', '四环节完整后只要求核对方案');

const duplicateLevels = mergeExtractedFacts(2, base, coreFacts.map((fact) => fact.field === 'stage2.independentVariable.levels'
  ? { ...fact, value: ['8 小时', '８小时', '08.0h'] }
  : fact)).stageData;
check(!evaluateStage2Readiness(duplicateLevels).complete, '格式不同但归一化相同的水平不能通过两水平门禁');
check(tutorFocusPlan(2, duplicateLevels).allowedFocusIds[0] === 'variable_design', '重复水平继续聚焦变量设计环节');

const endpointResult = applyDeterministicExtractionFallbacks(
  2,
  [{ field: 'stage2.dependentVariable.measurement', value: '用刻度尺测量', sourceQuote: '用刻度尺' }],
  '用刻度尺从种子量到茎尖，不包括根',
  { expectedFocusId: 'variable_design' },
);
check(endpointResult.accepted.some((fact) => fact.field === 'stage2.dependentVariable.name' && String(fact.value).includes('长度')), '可从明确起止点恢复长度观测指标');
const explicitLength = applyDeterministicExtractionFallbacks(2, [], '测量距离豆的直线长度', { expectedFocusId: 'variable_design' });
check(explicitLength.accepted.some((fact) => fact.field === 'stage2.dependentVariable.name' && fact.value === '豆的直线长度'), '可从学生原话恢复明确长度指标');

const liveMessage = '每天光照4小时和8小时，第7天用刻度尺测量豆苗高度，每组5株，其他条件保持不变，整个实验重复3次。';
const liveFallback = applyDeterministicExtractionFallbacks(2, [
  {
    field: 'stage2.independentVariable.levels',
    value: ['7天', '4小时', '8小时', '5天', '3天'],
    sourceQuote: liveMessage,
  },
  { field: 'stage2.repeatCount', value: 5, sourceQuote: '每组5株' },
], liveMessage, { expectedFocusId: 'variable_design' });
const liveLevels = liveFallback.accepted.find((fact) => fact.field === 'stage2.independentVariable.levels')?.value;
check(JSON.stringify(liveLevels) === JSON.stringify(['4小时', '8小时']), '真实长句只提取与自变量绑定的4小时和8小时');
check(liveFallback.accepted.some((fact) => fact.field === 'stage2.sampleSizePerLevel' && fact.value === 5), '每组5株识别为样本数');
check(liveFallback.accepted.some((fact) => fact.field === 'stage2.repeatCount' && fact.value === 3), '实验重复3次识别为独立重复');
check(liveFallback.accepted.some((fact) => fact.field === 'stage2.measurement.timing' && fact.value === '第7天'), '第7天识别为读数时间而不是水平');
check(liveFallback.accepted.some((fact) => fact.field === 'stage2.measurement.tool' && fact.value === '刻度尺'), '完整长句中的刻度尺稳定识别为测量工具');

const browserMessage = '我只改变每天光照时长，设置4小时和8小时两个水平，观察第7天豆苗高度；用刻度尺在第7天同一时间读数，记录每株豆苗高度（厘米），每组5株。步骤是选同品种同高度豆苗随机分组，每天按计划光照并等量浇水，第7天测量；豆苗品种、水量、土壤和温度保持不变，每组实验独立重复3次。我推测光照从4小时增加到8小时时豆苗高度会升高。';
const browserFallback = applyDeterministicExtractionFallbacks(2, [], browserMessage, { expectedFocusId: 'variable_design' });
const browserState = mergeExtractedFacts(2, base, browserFallback.accepted, { currentStudentMessage: browserMessage }).stageData;
check(evaluateStage2Readiness(browserState).complete, '浏览器真实的一次性四环节回答可直接进入方案核对');
check(browserState.extractedFacts?.['stage2.independentVariable.name']?.value === '每天光照时长', '只改变的条件稳定识别为唯一自变量');
check(browserState.extractedFacts?.['stage2.dependentVariable.name']?.value === '豆苗高度', '趋势句中的“从4小时增加到8小时”不会误识别为长度端点');
check(JSON.stringify(browserState.extractedFacts?.['stage2.controlledVariables']?.value) === JSON.stringify(['豆苗品种', '水量', '土壤', '温度']), '明确列出的控制条件逐项保留');
check(Array.isArray(browserState.extractedFacts?.['stage2.procedure']?.value), '带“步骤是”的操作过程可稳定提取');
check(String(browserState.extractedFacts?.['stage2.hypothesis']?.value).includes('会升高'), '带“我推测”的结果趋势可稳定提取');

const originalMeasurement = complete.extractedFacts?.['stage2.dependentVariable.measurement']?.value;
const locked = mergeExtractedFacts(2, complete, [{
  field: 'stage2.dependentVariable.measurement',
  value: '取平均值',
  sourceQuote: '取平均值',
}], { currentStudentMessage: '每组10颗取平均值', expectedFocusId: 'experiment_process' }).stageData;
check(locked.extractedFacts?.['stage2.dependentVariable.measurement']?.value === originalMeasurement, '没有明确修订时已完成字段不会被误覆盖');

const composed = composeStage2Plan(complete);
check(Boolean(composed?.plan.materials.length && composed.plan.procedure.length), '四环节完整后生成可核对操作方案');
check(composed?.plan.contractVersion === 'stage2-plan-v2', '新方案带有 v2 合同版本');
check(composed?.provenance.materials?.source === 'server_composed' && composed.provenance.procedure?.source === 'student_fact', '材料可由系统组装但步骤必须来自学生');
check(composed?.provenance.safetyNotes?.source === 'server_baseline' && Boolean(composed.plan.safetyNotes[0]), '低风险实验由服务器补充安全基线');

const originalHash = complete.stage2?.draftHash;
const revised = mergeExtractedFacts(2, complete, [{
  field: 'stage2.dependentVariable.measurement',
  value: '第7天用软尺贴合茎后测量',
  sourceQuote: '改成第7天用软尺贴合茎后测量',
}], { currentStudentMessage: '我改成第7天用软尺贴合茎后测量' }).stageData;
check(revised.stage2?.draftHash !== originalHash, '学生明确修改核心事实后生成新的方案哈希');
check(!revised.stage2?.confirmedPlanHash, '方案内容变化会使旧确认失效');

const legacyPlan = {
  independentVariable: { name: '温度', levels: ['20℃', '30℃'] },
  dependentVariable: { name: '萌发数', measurement: '每天计数' },
  controlledVariables: ['水量'],
  materials: ['种子'],
  procedure: ['设置温度并观察'],
  repeatCount: 3,
  safetyNotes: [],
};
const legacyHash = 'legacy-hash';
const legacyState: StageData = {
  ...base,
  stage2: {
    submitted: true,
    approved: true,
    experimentPlan: legacyPlan,
    planDraft: legacyPlan,
    draftHash: legacyHash,
    confirmedPlanHash: legacyHash,
    schema: { columns: [{ key: 'trial', title: '重复序号', type: 'number', required: true }], minRows: 3, maxRows: 200 },
  },
};
const legacyReadiness = evaluateStage2Readiness(legacyState);
check(legacyReadiness.complete && legacyReadiness.policyVersion === 'stage2-readiness-v1', '已确认历史方案保持有效且不被 v2 重新门禁');

console.log(`\nStage2 readiness tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
