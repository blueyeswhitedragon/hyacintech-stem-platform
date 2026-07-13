#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import type { ShareGPTRecord } from '../app/lib/dataLab/types';
import { validateShareGPTRecord, type ValidationMode } from '../app/lib/dataLab/validation';
import { STAGE_CONTRACT_VERSION } from '../app/lib/stageContract';
import type { DatasetV3Plan } from './dataset-v3-types';

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function validatePlan(value: unknown): string[] {
  const errors: string[] = [];
  const plan = value as DatasetV3Plan;
  if (plan.schemaVersion !== 3) errors.push('schemaVersion 必须为 3');
  if (plan.stageContractVersion !== STAGE_CONTRACT_VERSION) errors.push(`stageContractVersion 必须为 ${STAGE_CONTRACT_VERSION}`);
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) errors.push('tasks 不能为空');
  const ids = new Set<string>();
  for (const [index, task] of (plan.tasks ?? []).entries()) {
    const prefix = `tasks[${index}]`;
    if (!task.id || ids.has(task.id)) errors.push(`${prefix}.id 缺失或重复`);
    ids.add(task.id);
    if (task.phase < 1 || task.phase > 6) errors.push(`${prefix}.phase 无效`);
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
  }
  return errors;
}

function validateRecords(value: unknown, mode: ValidationMode): string[] {
  if (!Array.isArray(value)) return ['候选文件顶层必须是数组'];
  const errors: string[] = [];
  for (const [index, record] of (value as ShareGPTRecord[]).entries()) {
    const check = validateShareGPTRecord(record, mode);
    for (const issue of check.issues.filter((item) => item.severity === 'error')) {
      errors.push(`[${index}] ${record.id}: ${issue.ruleCode} ${issue.message}`);
    }
    if (record.meta?.sourceKind !== 'stage_contract_rollout') errors.push(`[${index}] ${record.id}: sourceKind 不是 stage_contract_rollout`);
    if (record.meta?.stageContractVersion !== STAGE_CONTRACT_VERSION) errors.push(`[${index}] ${record.id}: 阶段合同版本不匹配`);
    if (record.phase === 4 && Number(record.meta?.generationContext?.acceptedGroundedEvidenceRounds ?? 0) < 2) {
      errors.push(`[${index}] ${record.id}: P4 缺少两轮服务端核验的学生证据`);
    }
  }
  return errors;
}

async function main() {
  const file = path.resolve(flag('--file', 'data/sft/v3/plans/plan-v3.json')!);
  const kind = flag('--kind', 'plan');
  const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
  const errors = kind === 'plan'
    ? validatePlan(value)
    : validateRecords(value, kind === 'release' ? 'release' : 'submit');
  console.log(JSON.stringify({ file, kind, valid: errors.length === 0, errors }, null, 2));
  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
