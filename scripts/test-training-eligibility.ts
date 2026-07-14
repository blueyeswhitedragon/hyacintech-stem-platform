#!/usr/bin/env tsx
import {
  assertTransformationType,
  buildPreferenceRecord,
  computeTransformationMetrics,
  evaluateTrainingEligibility,
} from '../app/lib/trainingEligibility';
import type { ShareGPTRecord } from '../app/lib/dataLab/types';
import { STAGE_CONTRACT_VERSION } from '../app/lib/stageContract';
import { ACTIVE_DATASET_BATCH_STATUS, resolveImportedBatchStatus } from '../app/lib/dataLab/datasetPolicy';

let passed = 0;
let failed = 0;
function check(condition: unknown, label: string) {
  if (condition) { passed++; console.log(`PASS ${label}`); }
  else { failed++; console.error(`FAIL ${label}`); }
}
function record(dialogue: string, action = 'text_input'): ShareGPTRecord {
  return { id: 'x', scenario: 's', phase: 4, conversations: [{ from: 'human', value: '请分析数据' }, { from: 'gpt', value: JSON.stringify({ dialogue, next_action_type: action, phase_complete: false }) }] };
}

const original = record('数据似乎上升，你能先比较相邻两组吗？');
const exact = computeTransformationMetrics(original, record('数据似乎上升，你能先比较相邻两组吗？'));
check(exact.recommendedType === 'NO_CHANGE', '完全相同识别为 NO_CHANGE');
const material = computeTransformationMetrics(original, record('先不要直接下结论。请分别计算各组均值，比较变化幅度，并说明异常点是否会改变趋势判断。'));
check(['MATERIAL_CORRECTION', 'HUMAN_REWRITE'].includes(material.recommendedType), '显著改写识别为实质纠正或人工重写');
const structural = computeTransformationMetrics(original, record('请选择下一步。', 'ask_choice'));
check(structural.structureChanged && structural.recommendedType !== 'LIGHT_EDIT', '结构字段变化不能算轻微润色');
let overclaimBlocked = false;
try { assertTransformationType('HUMAN_REWRITE', { ...material, textChangeRatio: 0.05, structureChanged: false, recommendedType: 'LIGHT_EDIT' }); } catch { overclaimBlocked = true; }
check(overclaimBlocked, '服务端阻止把轻微差异虚报成人工重写');
const current = { batchStatus: ACTIVE_DATASET_BATCH_STATUS, stageContractVersion: STAGE_CONTRACT_VERSION };
check(evaluateTrainingEligibility({ sourceKind: 'stage_contract_rollout', ...current, workReviewApproved: true, finallySelected: true }).eligibility === 'SFT_ALLOWED', '当前合同的角色分离 rollout 可进入 SFT');
check(evaluateTrainingEligibility({ sourceKind: 'sharegpt_clean', ...current, workReviewApproved: true, finallySelected: true }).eligibility === 'BLOCKED', '旧 sharegpt_clean 不能凭审核状态绕过来源隔离');
check(evaluateTrainingEligibility({ sourceKind: 'production_trace', ...current, candidateStatus: 'CONVERTED', consentStatus: 'GRANTED', transformationType: 'NO_CHANGE', metrics: exact, workReviewApproved: true, finallySelected: true }).eligibility === 'MONITORING_ONLY', '生产原回答 NO_CHANGE 只能监测');
const allowed = evaluateTrainingEligibility({ sourceKind: 'production_trace', ...current, candidateStatus: 'CONVERTED', consentStatus: 'GRANTED', transformationType: 'MATERIAL_CORRECTION', metrics: material, workReviewApproved: true, finallySelected: true });
check(allowed.eligibility === 'SFT_ALLOWED' && allowed.preferenceAllowed, '生产实质纠正同时允许 SFT 和偏好对');
const preference = buildPreferenceRecord({ id: 'p1', original, chosen: record('请先计算各组均值，再判断趋势。'), meta: { sourceModelVersionId: 'm1' } });
check(preference.prompt.length === 1 && preference.chosen[0].value !== preference.rejected[0].value, '偏好导出保留同一提示下的人工 chosen 与模型 rejected');
check(evaluateTrainingEligibility({ sourceKind: 'production_trace', ...current, candidateStatus: 'WITHDRAWN', consentStatus: 'WITHDRAWN', transformationType: 'MATERIAL_CORRECTION', metrics: material, workReviewApproved: true, finallySelected: true }).eligibility === 'BLOCKED', '撤回授权阻断训练');
check(evaluateTrainingEligibility({ sourceKind: 'production_trace', ...current, candidateStatus: 'CONVERTED', consentStatus: 'GRANTED', leakageBlocked: true, transformationType: 'MATERIAL_CORRECTION', metrics: material, workReviewApproved: true, finallySelected: true }).eligibility === 'BLOCKED', '泄漏命中阻断训练');
check(evaluateTrainingEligibility({ sourceKind: 'stage_contract_rollout', batchStatus: 'LEGACY_QUARANTINED', stageContractVersion: STAGE_CONTRACT_VERSION, workReviewApproved: true, finallySelected: true }).eligibility === 'BLOCKED', '已隔离批次永远不能导出训练集');
check(resolveImportedBatchStatus({ name: '换了名字', sourceFileName: 'new.json', recordIds: ['stem-distill-dsv4-p1-a', 'stem-distill-dsv4-p2-b'], requestedStatus: 'ACTIVE' }).status === 'LEGACY_QUARANTINED', '旧 489 衍生记录换名导入仍自动隔离');

console.log(`\nTraining eligibility tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
