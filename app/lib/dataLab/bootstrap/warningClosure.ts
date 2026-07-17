/** Legacy single-choice values. Kept readable so historical approvals are never rewritten. */
export const TUTOR_WARNING_RESOLUTIONS = [
  'FIXED',
  'ACCEPTABLE',
  'NOT_APPLICABLE',
  'FALSE_POSITIVE',
] as const;
export type TutorWarningResolution = (typeof TUTOR_WARNING_RESOLUTIONS)[number];

/** Legacy three-axis values from the Trial 36 workflow. */
export const TUTOR_WARNING_VALIDITIES = ['VALID', 'PARTIALLY_VALID', 'FALSE_POSITIVE'] as const;
export type TutorWarningValidity = (typeof TUTOR_WARNING_VALIDITIES)[number];

export const TUTOR_WARNING_FINAL_RELATIONS = ['PRESENT_IN_FINAL', 'REMOVED_BY_EDIT', 'ONLY_UNSELECTED_CANDIDATE'] as const;
export type TutorWarningFinalRelation = (typeof TUTOR_WARNING_FINAL_RELATIONS)[number];

export const TUTOR_WARNING_SEVERITIES = ['BLOCKING', 'MINOR', 'NEGLIGIBLE'] as const;
export type TutorWarningSeverity = (typeof TUTOR_WARNING_SEVERITIES)[number];

export const TUTOR_WARNING_DETECTOR_VERDICTS = ['CORRECT', 'PARTIAL', 'MISCLASSIFIED', 'FALSE_POSITIVE'] as const;
export type TutorWarningDetectorVerdict = (typeof TUTOR_WARNING_DETECTOR_VERDICTS)[number];

export const TUTOR_WARNING_CORRECTED_CATEGORIES = [
  'ANSWER_MENU',
  'OVER_ADVANCEMENT',
  'COGNITIVE_LOAD',
  'RHETORICAL_QUESTION',
  'EXAMPLE_TOO_DIRECT',
  'SAFETY_OVERREACTION',
  'STAGE_MISMATCH',
  'EVIDENCE_INTERPRETATION',
  'OTHER',
] as const;
export type TutorWarningCorrectedCategory = (typeof TUTOR_WARNING_CORRECTED_CATEGORIES)[number];

export interface LegacyTutorWarningClosure {
  resolution: TutorWarningResolution;
  note?: string;
}

export interface TutorWarningAssessment {
  validity: TutorWarningValidity;
  finalRelation: TutorWarningFinalRelation;
  severity: TutorWarningSeverity;
  note?: string;
}

export interface TutorWarningAssessmentV2 {
  detectorVerdict: TutorWarningDetectorVerdict;
  correctedCategory?: TutorWarningCorrectedCategory | string;
  finalRelation: TutorWarningFinalRelation;
  finalSeverity?: TutorWarningSeverity;
  candidateSeverity?: TutorWarningSeverity;
  note?: string;
}

export type TutorWarningClosure = LegacyTutorWarningClosure | TutorWarningAssessment | TutorWarningAssessmentV2;
export type TutorWarningClosureValue = boolean | TutorWarningClosure;
export type TutorWarningClosureMap = Record<string, TutorWarningClosureValue>;

export const TUTOR_WARNING_RESOLUTION_LABELS: Record<TutorWarningResolution, string> = {
  ...SHARED_RESOLUTION_LABELS,
};

export const TUTOR_WARNING_VALIDITY_LABELS: Record<TutorWarningValidity, string> = {
  ...SHARED_VALIDITY_LABELS,
};

export const TUTOR_WARNING_DETECTOR_VERDICT_LABELS: Record<TutorWarningDetectorVerdict, string> = {
  ...SHARED_DETECTOR_VERDICT_LABELS,
};

export const TUTOR_WARNING_CORRECTED_CATEGORY_LABELS: Record<TutorWarningCorrectedCategory, string> = {
  ...SHARED_CORRECTED_CATEGORY_LABELS,
};

export const TUTOR_WARNING_FINAL_RELATION_LABELS: Record<TutorWarningFinalRelation, string> = {
  ...SHARED_FINAL_RELATION_LABELS,
};

export const TUTOR_WARNING_SEVERITY_LABELS: Record<TutorWarningSeverity, string> = {
  ...SHARED_SEVERITY_LABELS,
};

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

export function isTutorWarningAssessment(value: unknown): value is TutorWarningAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const assessment = value as Record<string, unknown>;
  return includes(TUTOR_WARNING_VALIDITIES, assessment.validity)
    && includes(TUTOR_WARNING_FINAL_RELATIONS, assessment.finalRelation)
    && includes(TUTOR_WARNING_SEVERITIES, assessment.severity);
}

export function isTutorWarningAssessmentV2(value: unknown): value is TutorWarningAssessmentV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const assessment = value as Record<string, unknown>;
  if (!includes(TUTOR_WARNING_DETECTOR_VERDICTS, assessment.detectorVerdict)) return false;
  if (!includes(TUTOR_WARNING_FINAL_RELATIONS, assessment.finalRelation)) return false;
  if (assessment.detectorVerdict === 'MISCLASSIFIED' && (typeof assessment.correctedCategory !== 'string' || !assessment.correctedCategory.trim())) return false;
  if (assessment.finalSeverity !== undefined && !includes(TUTOR_WARNING_SEVERITIES, assessment.finalSeverity)) return false;
  if (assessment.candidateSeverity !== undefined && !includes(TUTOR_WARNING_SEVERITIES, assessment.candidateSeverity)) return false;
  if (assessment.finalRelation === 'PRESENT_IN_FINAL' && assessment.detectorVerdict !== 'FALSE_POSITIVE' && !includes(TUTOR_WARNING_SEVERITIES, assessment.finalSeverity)) return false;
  return true;
}

export function isLegacyTutorWarningClosure(value: unknown): value is LegacyTutorWarningClosure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return includes(TUTOR_WARNING_RESOLUTIONS, (value as Record<string, unknown>).resolution);
}

function closureNote(value: Record<string, unknown>) {
  return typeof value.note === 'string' ? value.note.trim().slice(0, 1000) : '';
}

export function sanitizeTutorWarningClosures(value: unknown): TutorWarningClosureMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: TutorWarningClosureMap = {};
  for (const [warningId, rawClosure] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    if (!warningId) continue;
    if (typeof rawClosure === 'boolean') {
      result[warningId] = rawClosure;
      continue;
    }
    if (!rawClosure || typeof rawClosure !== 'object' || Array.isArray(rawClosure)) continue;
    const closure = rawClosure as Record<string, unknown>;
    const note = closureNote(closure);
    if (isTutorWarningAssessmentV2(closure)) {
      result[warningId] = {
        detectorVerdict: closure.detectorVerdict,
        finalRelation: closure.finalRelation,
        ...(typeof closure.correctedCategory === 'string' && closure.correctedCategory.trim() ? { correctedCategory: closure.correctedCategory.trim().slice(0, 120) } : {}),
        ...(closure.finalSeverity ? { finalSeverity: closure.finalSeverity } : {}),
        ...(closure.candidateSeverity ? { candidateSeverity: closure.candidateSeverity } : {}),
        ...(note ? { note } : {}),
      };
      continue;
    }
    if (isTutorWarningAssessment(closure)) {
      result[warningId] = {
        validity: closure.validity,
        finalRelation: closure.finalRelation,
        severity: closure.severity,
        ...(note ? { note } : {}),
      };
      continue;
    }
    if (isLegacyTutorWarningClosure(closure)) {
      result[warningId] = { resolution: closure.resolution, ...(note ? { note } : {}) };
    }
  }
  return result;
}

export function isTutorWarningClosed(value: TutorWarningClosureValue | undefined): boolean {
  if (value === true) return true;
  return isTutorWarningAssessmentV2(value) || isTutorWarningAssessment(value) || isLegacyTutorWarningClosure(value);
}

export function tutorWarningBlocksFinal(value: TutorWarningClosureValue | undefined): boolean {
  if (isTutorWarningAssessmentV2(value)) {
    return value.detectorVerdict !== 'FALSE_POSITIVE'
      && value.finalRelation === 'PRESENT_IN_FINAL'
      && value.finalSeverity === 'BLOCKING';
  }
  return isTutorWarningAssessment(value)
    && value.validity !== 'FALSE_POSITIVE'
    && value.finalRelation === 'PRESENT_IN_FINAL'
    && value.severity === 'BLOCKING';
}
import {
  TUTOR_WARNING_CORRECTED_CATEGORY_LABELS as SHARED_CORRECTED_CATEGORY_LABELS,
  TUTOR_WARNING_DETECTOR_VERDICT_LABELS as SHARED_DETECTOR_VERDICT_LABELS,
  TUTOR_WARNING_FINAL_RELATION_LABELS as SHARED_FINAL_RELATION_LABELS,
  TUTOR_WARNING_RESOLUTION_LABELS as SHARED_RESOLUTION_LABELS,
  TUTOR_WARNING_SEVERITY_LABELS as SHARED_SEVERITY_LABELS,
  TUTOR_WARNING_VALIDITY_LABELS as SHARED_VALIDITY_LABELS,
} from '@/app/lib/dataLab/labels';
