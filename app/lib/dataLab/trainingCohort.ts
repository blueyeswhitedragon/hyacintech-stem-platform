import { STAGE_CONTRACT_VERSION } from '@/app/lib/stageContract';
import { EXTRACTOR_VERSION } from '@/app/lib/stateExtractor';
import {
  DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION,
  TUTOR_LANGUAGE_CONTRACT_VERSION,
} from '@/app/lib/tutorLanguage';

export const TUTOR_TRAINING_COHORT = {
  contractVersion: TUTOR_LANGUAGE_CONTRACT_VERSION,
  stageContractVersion: STAGE_CONTRACT_VERSION,
  extractorVersion: EXTRACTOR_VERSION,
  promptVersion: DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION,
} as const;

export interface TutorCohortProvenance {
  contractVersion?: string | null;
  stageContractVersion?: string | null;
  extractorVersion?: string | null;
  promptVersion?: string | null;
}

export function tutorCohortReasons(input: TutorCohortProvenance): string[] {
  const reasons: string[] = [];
  if (input.contractVersion !== TUTOR_TRAINING_COHORT.contractVersion) reasons.push('TUTOR_CONTRACT_VERSION_MISMATCH');
  if (input.stageContractVersion !== TUTOR_TRAINING_COHORT.stageContractVersion) reasons.push('STAGE_CONTRACT_VERSION_MISMATCH');
  if (input.extractorVersion !== TUTOR_TRAINING_COHORT.extractorVersion) reasons.push('EXTRACTOR_VERSION_MISMATCH');
  if (input.promptVersion !== TUTOR_TRAINING_COHORT.promptVersion) reasons.push('PROMPT_VERSION_MISMATCH');
  return reasons;
}

export function caseStageContractVersion(hardCheckJson: string): string | undefined {
  try {
    const parsed = JSON.parse(hardCheckJson) as { provenance?: { stageContractVersion?: unknown } };
    return typeof parsed.provenance?.stageContractVersion === 'string'
      ? parsed.provenance.stageContractVersion
      : undefined;
  } catch {
    return undefined;
  }
}
