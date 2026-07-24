import type { Stage5Data, Stage5Sections } from '@/app/models/stageData';
import { contractHash } from '@/app/lib/stageState';

export function limitationsDiscussion(sections: Stage5Sections): string {
  return sections.limitationsDiscussion ?? sections.reflection ?? '';
}

export function withLimitationsDiscussion(
  sections: Stage5Sections,
  value: string,
): Stage5Sections {
  return {
    ...sections,
    limitationsDiscussion: value,
    reflection: value,
  };
}

/** Hash only the platform report fields that are submitted for teacher/AI review. */
export function stage5SubmissionHash(sections: Stage5Sections): string {
  return contractHash('stage-contract-v3/stage5-submission/v1', {
    purpose: sections.purpose,
    hypothesis: sections.hypothesis,
    materials: sections.materials,
    procedure: sections.procedure,
    dataSummary: sections.dataSummary,
    analysis: sections.analysis,
    conclusion: sections.conclusion,
    limitationsDiscussion: limitationsDiscussion(sections),
  });
}

/** A delayed AI score may be written only while the exact submitted report is still current. */
export function isCurrentStage5Submission(
  stage5: Stage5Data | undefined,
  submissionHash: string,
): stage5 is Stage5Data {
  return stage5?.submitted === true
    && stage5.submittedSectionsHash === submissionHash
    && stage5SubmissionHash(stage5.sections) === submissionHash;
}
