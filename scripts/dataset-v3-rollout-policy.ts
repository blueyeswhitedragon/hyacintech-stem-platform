import type { ChatResponse } from '../app/models/types';
import type { DatasetV3Phase } from './dataset-v3-types';

export interface DatasetV3RolloutProgress {
  turns: number;
  acceptedEvidence: number;
  hasSafetyQuiz: boolean;
  hasReportSections: boolean;
}

export function maxTurnsForPhase(phase: DatasetV3Phase): number {
  if (phase === 1) return 6;
  if (phase === 2) return 10;
  if (phase === 4) return 6;
  if (phase === 6) return 2;
  return 2;
}

/**
 * 系统结构化交付轮不能单独证明目标风格。P3/P5 因此至少再保留一轮
 * 普通师生互动，既验证触发后的状态机，也提供真实的风格证据。
 */
export function reachedDatasetV3Stop(
  phase: DatasetV3Phase,
  response: ChatResponse,
  progress: DatasetV3RolloutProgress,
): boolean {
  if (phase === 1) return response.stage1_confirmed === true;
  if (phase === 2) return !!response.experiment_plan && !!response.data_table_schema;
  if (phase === 3) return progress.hasSafetyQuiz && progress.turns >= 2;
  if (phase === 4) return progress.turns >= 3 && progress.acceptedEvidence >= 2;
  if (phase === 5) return progress.hasReportSections && progress.turns >= 2;
  return progress.turns >= 1;
}
