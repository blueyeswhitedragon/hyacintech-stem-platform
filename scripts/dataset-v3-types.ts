import type { StyleFamily } from '../app/lib/stylePolicy';

export type DatasetV3Phase = 1 | 2 | 3 | 4 | 5 | 6;

export interface DatasetV3ExpectedTransformation {
  originalInterest?: string;
  retainedFeature?: string;
  classroomProxy?: string;
  researchQuestion?: string;
  independentVariable?: string;
  dependentDirection?: string;
  safetyNotes?: string[];
}

export interface DatasetV3Task {
  id: string;
  parentLegacyRecordId: string;
  familyKey: string;
  phase: DatasetV3Phase;
  scenario: string;
  styleFamily: StyleFamily;
  triggerType: 'USER_MESSAGE' | 'STAGE_ENTER' | 'STAGE_TRANSITION' | 'REPORT_BOOTSTRAP' | 'OPTIONAL_COACHING';
  studentVisible: {
    profile: string;
    openingMessage: string;
    brief: string[];
    realRows: Record<string, unknown>[];
  };
  tutorVisible: {
    priorSummary?: string;
    dataRows?: Record<string, unknown>[];
    dataSchema?: {
      columns: Array<{ key: string; title: string; type: 'text' | 'number'; required: boolean }>;
      minRows: number;
      maxRows: number;
    };
  };
  evaluatorOnly: {
    expectedTransformation?: DatasetV3ExpectedTransformation;
    failureModes: string[];
    rubricTargets: string[];
  };
}

export interface DatasetV3Plan {
  schemaVersion: 3;
  stageContractVersion: string;
  createdAt: string;
  sourceFile: string;
  sourceUsage: 'SCENARIO_SEEDS_ONLY';
  tasks: DatasetV3Task[];
}
