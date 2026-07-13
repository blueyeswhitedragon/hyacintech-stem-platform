export const DATASET_BATCH_STATUSES = [
  'ACTIVE',
  'LEGACY_QUARANTINED',
  'REGRESSION_ONLY',
  'REJECTED_ONLY',
] as const;

export type DatasetBatchStatus = (typeof DATASET_BATCH_STATUSES)[number];

export const ACTIVE_DATASET_BATCH_STATUS: DatasetBatchStatus = 'ACTIVE';
export const LEGACY_QUARANTINED_BATCH_STATUS: DatasetBatchStatus = 'LEGACY_QUARANTINED';

export function isTrainableBatchStatus(status: string): status is 'ACTIVE' {
  return status === ACTIVE_DATASET_BATCH_STATUS;
}

export function resolveImportedBatchStatus(input: {
  name: string;
  sourceFileName: string;
  recordIds: string[];
  requestedStatus?: DatasetBatchStatus;
}): { status: DatasetBatchStatus; reason: 'LEGACY_489_DERIVATIVE' | 'EXPLICIT_CURRENT_IMPORT' } {
  const legacy489Derivative =
    /sharegpt-distill-dsv4|dataset-base-v1/i.test(`${input.name} ${input.sourceFileName}`)
    || (input.recordIds.length > 0 && input.recordIds.every((id) => /^stem-distill-dsv4-/i.test(id)));
  return legacy489Derivative
    ? { status: LEGACY_QUARANTINED_BATCH_STATUS, reason: 'LEGACY_489_DERIVATIVE' }
    : { status: input.requestedStatus ?? ACTIVE_DATASET_BATCH_STATUS, reason: 'EXPLICIT_CURRENT_IMPORT' };
}

export function datasetBatchStatusLabel(status: string): string {
  if (status === 'ACTIVE') return '可用于标注与发布';
  if (status === 'LEGACY_QUARANTINED') return '历史隔离（禁止正向训练）';
  if (status === 'REGRESSION_ONLY') return '仅回归测试';
  if (status === 'REJECTED_ONLY') return '仅负例/偏好数据';
  return `未知状态：${status}`;
}
