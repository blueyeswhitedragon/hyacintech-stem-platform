#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import { assertTrainingConversationFormat } from '../app/lib/dataLab/styleMetadata';
import type { ShareGPTRecord, TrainingShareGPTRecord } from '../app/lib/dataLab/types';
import { validateShareGPTRecord, type ValidationMode } from '../app/lib/dataLab/validation';
import { STAGE_CONTRACT_VERSION } from '../app/lib/stageContract';
import { isStyleFamily, STYLE_FAMILIES } from '../app/lib/stylePolicy';
import type { DatasetV3Plan, DatasetV3Task } from './dataset-v3-types';

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function matrixKey(task: DatasetV3Task): string | undefined {
  if (task.studentVisible.realRows.length === 0) return undefined;
  return JSON.stringify(task.studentVisible.realRows.map((row) => Object.entries(row)
    .filter(([key]) => key !== 'trial' && key !== 'notes')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value)));
}

function validateCoverage(items: Array<{ phase: number; styleFamily: unknown; cellKey?: unknown }>): string[] {
  const errors: string[] = [];
  if (items.length !== 30) errors.push(`校准集必须恰好30条，当前为${items.length}条`);
  for (const phase of [1, 2, 3, 4, 5, 6]) {
    const count = items.filter((item) => item.phase === phase).length;
    if (count !== 5) errors.push(`P${phase} 必须恰好5条，当前为${count}条`);
  }
  for (const style of STYLE_FAMILIES) {
    const count = items.filter((item) => item.styleFamily === style).length;
    if (count !== 6) errors.push(`${style} 必须恰好6条，当前为${count}条`);
  }
  const cells = new Map<string, number>();
  for (const item of items) {
    const expected = isStyleFamily(item.styleFamily) ? `P${item.phase}:${item.styleFamily}` : '';
    const cell = typeof item.cellKey === 'string' ? item.cellKey : expected;
    if (cell !== expected) errors.push(`单元格标识 ${cell || '缺失'} 与阶段/风格 ${expected || '无效'} 不一致`);
    cells.set(cell, (cells.get(cell) ?? 0) + 1);
  }
  for (const phase of [1, 2, 3, 4, 5, 6]) {
    for (const style of STYLE_FAMILIES) {
      const cell = `P${phase}:${style}`;
      if (cells.get(cell) !== 1) errors.push(`${cell} 必须恰好1条，当前为${cells.get(cell) ?? 0}条`);
    }
  }
  return errors;
}

function validatePlan(value: unknown, calibration: boolean): string[] {
  const errors: string[] = [];
  const plan = value as DatasetV3Plan;
  if (plan.schemaVersion !== 3) errors.push('schemaVersion 必须为 3');
  if (plan.stageContractVersion !== STAGE_CONTRACT_VERSION) errors.push(`stageContractVersion 必须为 ${STAGE_CONTRACT_VERSION}`);
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) errors.push('tasks 不能为空');
  const ids = new Set<string>();
  const matrices = new Map<string, string>();
  for (const [index, task] of (plan.tasks ?? []).entries()) {
    const prefix = `tasks[${index}]`;
    if (!task.id || ids.has(task.id)) errors.push(`${prefix}.id 缺失或重复`);
    ids.add(task.id);
    if (task.phase < 1 || task.phase > 6) errors.push(`${prefix}.phase 无效`);
    if (!isStyleFamily(task.styleFamily)) errors.push(`${prefix}.styleFamily 无效`);
    if (!task.studentVisible || !task.tutorVisible || !task.evaluatorOnly) errors.push(`${prefix} 必须明确分离三个角色视图`);
    const student = task.studentVisible as unknown as Record<string, unknown>;
    const tutor = task.tutorVisible as unknown as Record<string, unknown>;
    if ('evaluatorOnly' in student || 'expectedTransformation' in student) errors.push(`${prefix}.studentVisible 泄漏评估器字段`);
    if ('evaluatorOnly' in tutor || 'expectedTransformation' in tutor) errors.push(`${prefix}.tutorVisible 泄漏评估器字段`);
    if (task.phase === 1 && task.tutorVisible.priorSummary) errors.push(`${prefix} P1 不应携带后续阶段摘要`);
    if (task.phase === 2 && /教师已审核方案|真实数据|分析进度/.test(task.tutorVisible.priorSummary ?? '')) {
      errors.push(`${prefix} P2 提前看到了完整方案或数据`);
    }
    if (task.phase === 4 && (!task.tutorVisible.dataRows?.length || !task.tutorVisible.dataSchema)) {
      errors.push(`${prefix} P4 缺少可核验的真实数据上下文`);
    }
    const spec = task.domainSpec;
    if (!spec?.researchQuestion || !spec.hypothesis || spec.independentVariable.levels.length < 2) errors.push(`${prefix}.domainSpec 缺少研究问题、假设或具体水平`);
    if (!spec?.dependentVariable.unit || spec.dependentVariable.reasonableRange.length !== 2) errors.push(`${prefix}.domainSpec 缺少单位或合理范围`);
    if (!spec?.materials.length || !spec.procedure.length || !spec.safetyRisks.length) errors.push(`${prefix}.domainSpec 缺少材料、步骤或安全风险`);
    if (spec?.independentVariable.levels.some((level) => /^(?:较低|中等|较高|低|中|高)(?:水平|条件|实验条件)?$/.test(level))) {
      errors.push(`${prefix}.domainSpec 使用了通用高低水平`);
    }
    if (/level_[123]/i.test(JSON.stringify(task))) errors.push(`${prefix} 含用户可见 level_1/2/3`);
    const [min, max] = spec?.dependentVariable.reasonableRange ?? [0, 0];
    for (const [rowIndex, row] of task.studentVisible.realRows.entries()) {
      for (const [key, raw] of Object.entries(row)) {
        if (!/^result_[a-z]$/.test(key) || raw === '') continue;
        const number = Number(raw);
        if (!Number.isFinite(number) || number < min || number > max) errors.push(`${prefix}.realRows[${rowIndex}].${key} 超出主题合理范围`);
      }
      if (/(因为|导致|可能是|原因)/.test(String(row.notes ?? ''))) errors.push(`${prefix}.realRows[${rowIndex}].notes 提前泄露异常原因`);
    }
    const matrix = matrixKey(task);
    if (matrix) {
      const existing = matrices.get(matrix);
      if (existing && existing !== task.scenario) errors.push(`${prefix} 与主题“${existing}”跨主题复用了同一数值矩阵`);
      matrices.set(matrix, task.scenario);
    }
  }
  if (calibration) {
    errors.push(...validateCoverage((plan.tasks ?? []).map((task) => ({ phase: task.phase, styleFamily: task.styleFamily, cellKey: task.cellKey }))));
    const patterns = new Set(plan.tasks.map((task) => task.domainSpec.dataPattern));
    if (patterns.size < 8) errors.push(`校准集数据模式至少覆盖8类，当前为${patterns.size}类`);
    const monotonic = plan.tasks.filter((task) => task.domainSpec.dataPattern === 'rising' || task.domainSpec.dataPattern === 'falling').length;
    if (monotonic / plan.tasks.length > 0.4) errors.push('明显单调模板比例超过40%');
    const p5 = plan.tasks.filter((task) => task.phase === 5);
    if (p5.filter((task) => task.reportPath === 'complete').length !== 4 || p5.filter((task) => task.reportPath === 'fallback').length !== 1) {
      errors.push('P5 校准必须为4条完整路径和1条 fallback 路径');
    }
  }
  return errors;
}

function validateRecords(value: unknown, mode: ValidationMode, calibration: boolean): string[] {
  if (!Array.isArray(value)) return ['候选文件顶层必须是数组'];
  const errors: string[] = [];
  const records = value as ShareGPTRecord[];
  for (const [index, record] of records.entries()) {
    const check = validateShareGPTRecord(record, mode);
    for (const issue of check.issues.filter((item) => item.severity === 'error')) {
      errors.push(`[${index}] ${record.id}: ${issue.ruleCode} ${issue.message}`);
    }
    if (record.meta?.sourceKind !== 'stage_contract_rollout') errors.push(`[${index}] ${record.id}: sourceKind 不是 stage_contract_rollout`);
    if (record.meta?.stageContractVersion !== STAGE_CONTRACT_VERSION) errors.push(`[${index}] ${record.id}: 阶段合同版本不匹配`);
    if (record.phase === 4 && Number(record.meta?.generationContext?.acceptedGroundedEvidenceRounds ?? 0) < 2) {
      errors.push(`[${index}] ${record.id}: P4 缺少两轮服务端核验的学生证据`);
    }
    const independent = record.meta?.generationContext?.evaluatorIndependent === true;
    if (!independent && record.meta?.tier !== 'needs_review') errors.push(`[${index}] ${record.id}: Tutor 与 Evaluator 非独立时只能是 needs_review`);
    if (record.meta?.tier === 'human_gold') errors.push(`[${index}] ${record.id}: 自动评估不能直接产生 Human Gold`);
    const evaluatorReasons = record.meta?.generationContext?.evaluatorReasons;
    if (!Array.isArray(evaluatorReasons) || evaluatorReasons.length === 0 || evaluatorReasons.some((reason) => typeof reason !== 'string' || !reason.trim())) {
      errors.push(`[${index}] ${record.id}: 评估器必须返回可定位的具体 reasons`);
    }
    if (/level_[123]/i.test(record.conversations.map((message) => message.value).join('\n'))) {
      errors.push(`[${index}] ${record.id}: 对话含用户可见 level_1/2/3`);
    }
  }
  if (calibration) {
    errors.push(...validateCoverage(records.map((record) => ({
      phase: record.phase,
      styleFamily: record.meta?.styleFamily,
      cellKey: record.meta?.generationContext?.cellKey,
    }))));
  }
  return errors;
}

function validateTraining(value: unknown, calibration: boolean): string[] {
  if (!Array.isArray(value)) return ['训练文件顶层必须是数组'];
  const errors: string[] = [];
  const records = value as TrainingShareGPTRecord[];
  for (const [index, record] of records.entries()) {
    try { assertTrainingConversationFormat(record); } catch (error) {
      errors.push(`[${index}] ${error instanceof Error ? error.message : String(error)}`);
    }
    if (Object.prototype.hasOwnProperty.call(record.meta ?? {}, 'expectedTransformation')) {
      errors.push(`[${index}] ${record.id}: 训练元数据泄漏 evaluator-only expectedTransformation`);
    }
  }
  if (calibration) {
    const cells = new Set(records.map((record) => String(record.meta?.generationContext?.cellKey ?? '')));
    if (cells.size !== 30 || cells.has('')) errors.push(`训练导出必须覆盖30个有效单元格，当前为${cells.size}`);
  }
  return errors;
}

async function main() {
  const file = path.resolve(flag('--file', 'data/sft/v3/plans/plan-v3.json')!);
  const kind = flag('--kind', 'plan');
  const calibration = flag('--profile') === 'calibration-30';
  const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
  const errors = kind === 'plan'
    ? validatePlan(value, calibration)
    : kind === 'training'
      ? validateTraining(value, calibration)
      : validateRecords(value, kind === 'release' ? 'release' : 'submit', calibration);
  console.log(JSON.stringify({ file, kind, profile: calibration ? 'calibration-30' : 'default', valid: errors.length === 0, errors }, null, 2));
  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
