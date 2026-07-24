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
  { field: 'stage2.hypothesis', value: '光照越长豆苗越高', sourceQuote: '光照越长豆苗越高' },
  { field: 'stage2.independentVariable.name', value: '每天光照时长', sourceQuote: '控制每天光照时长' },
  { field: 'stage2.independentVariable.levels', value: ['0小时', '8小时', '12小时', '24小时'], sourceQuote: '0、8、12、24小时四组' },
  { field: 'stage2.dependentVariable.name', value: '豆苗高度', sourceQuote: '测量豆苗高度' },
  { field: 'stage2.dependentVariable.measurement', value: '每天固定时间用刻度尺从种子量到茎尖', sourceQuote: '每天固定时间用刻度尺从种子量到茎尖' },
  { field: 'stage2.controlledVariables', value: ['营养液量', '水位'], sourceQuote: '营养液量水位等相同' },
  { field: 'stage2.repeatCount', value: 10, sourceQuote: '每组10颗取平均值' },
];

const withoutRepeats = mergeExtractedFacts(2, base, coreFacts.filter((fact) => fact.field !== 'stage2.repeatCount')).stageData;
check(!evaluateStage2Readiness(withoutRepeats).complete, '缺少重复次数时科学核心尚未就绪');
check(!withoutRepeats.stage2?.planDraft, '核心未就绪时不生成方案预览');
check(tutorFocusPlan(2, withoutRepeats).allowedFocusIds[0] === 'repeats', 'Tutor 只追问唯一的重复次数缺口');

const complete = mergeExtractedFacts(2, base, coreFacts).stageData;
const readiness = evaluateStage2Readiness(complete);
check(readiness.complete && readiness.missingFields.length === 0, '七项科学核心齐全即就绪');
check(tutorFocusPlan(2, complete).allowedFocusIds[0] === 'plan_confirmation', '四个充分水平不会被重新追问');

const endpointResult = applyDeterministicExtractionFallbacks(
  2,
  [{ field: 'stage2.dependentVariable.measurement', value: '用刻度尺测量', sourceQuote: '用刻度尺' }],
  '用刻度尺从种子量到茎尖，不包括根',
  { expectedFocusId: 'dependent_variable' },
);
check(endpointResult.accepted.some((fact) => fact.field === 'stage2.dependentVariable.name' && String(fact.value).includes('长度')), '因变量追问下可从明确起止点恢复长度结果');
const explicitLength = applyDeterministicExtractionFallbacks(2, [], '测量距离豆的直线长度', { expectedFocusId: 'dependent_variable' });
check(explicitLength.accepted.some((fact) => fact.field === 'stage2.dependentVariable.name' && fact.value === '豆的直线长度'), '因变量追问下可从学生原话恢复明确长度指标');

const originalMeasurement = complete.extractedFacts?.['stage2.dependentVariable.measurement']?.value;
const locked = mergeExtractedFacts(2, complete, [{
  field: 'stage2.dependentVariable.measurement',
  value: '取平均值',
  sourceQuote: '取平均值',
}], { currentStudentMessage: '每组10颗取平均值', expectedFocusId: 'repeats' }).stageData;
check(locked.extractedFacts?.['stage2.dependentVariable.measurement']?.value === originalMeasurement, '非当前 focus 的已完成核心字段不会被误覆盖');

const composed = composeStage2Plan(complete);
check(Boolean(composed?.plan.materials.length && composed.plan.procedure.length), '缺失材料和步骤时服务器生成可核对操作方案');
check(composed?.provenance.materials?.source === 'server_composed' && composed.provenance.procedure?.source === 'server_composed', '系统组装材料和步骤记录来源');
check(composed?.provenance.safetyNotes?.source === 'server_baseline' && Boolean(composed.plan.safetyNotes[0]), '低风险实验由服务器补充安全基线而不追问学生');

const originalHash = complete.stage2?.draftHash;
const revised = mergeExtractedFacts(2, complete, [{
  field: 'stage2.dependentVariable.measurement',
  value: '每天固定时间用软绳贴合茎后再用刻度尺测量',
  sourceQuote: '改成用软绳贴合茎后再量',
}], { currentStudentMessage: '我改成用软绳贴合茎后再量' }).stageData;
check(revised.stage2?.draftHash !== originalHash, '学生明确修改核心事实后生成新的方案哈希');
check(!revised.stage2?.confirmedPlanHash, '方案内容变化会使旧确认失效');

console.log(`\nStage2 readiness tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
