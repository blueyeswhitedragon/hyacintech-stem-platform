import type { StyleFamily } from '../app/lib/stylePolicy';

export type DatasetV3Phase = 1 | 2 | 3 | 4 | 5 | 6;
export type DatasetV3DataPattern =
  | 'rising'
  | 'falling'
  | 'weak_trend'
  | 'plateau'
  | 'non_monotonic'
  | 'overlap'
  | 'single_outlier'
  | 'missing_measurement'
  | 'replicate_variation';
export type DatasetV3AnomalyPattern = 'none' | 'single_outlier' | 'missing_measurement' | 'replicate_variation';

export interface DatasetV3DomainSpec {
  researchQuestion: string;
  hypothesis: string;
  independentVariable: { name: string; levels: string[] };
  dependentVariable: { name: string; measurement: string; unit: string; reasonableRange: [number, number] };
  controlledVariables: string[];
  materials: string[];
  procedure: string[];
  repeatCount: number;
  safetyRisks: string[];
  dataPattern: DatasetV3DataPattern;
  anomalyPattern: DatasetV3AnomalyPattern;
}

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
  cellKey: string;
  parentLegacyRecordId: string;
  familyKey: string;
  phase: DatasetV3Phase;
  scenario: string;
  styleFamily: StyleFamily;
  triggerType: 'USER_MESSAGE' | 'STAGE_ENTER' | 'STAGE_TRANSITION' | 'REPORT_BOOTSTRAP' | 'OPTIONAL_COACHING';
  reportPath?: 'complete' | 'fallback';
  domainSpec: DatasetV3DomainSpec;
  studentVisible: {
    profile: string;
    openingMessage: string;
    brief: string[];
    decisionFacts: string[];
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
    approvedPlan?: DatasetV3DomainSpec;
    acceptedAnalysis?: string[];
  };
  evaluatorOnly: {
    expectedTransformation?: DatasetV3ExpectedTransformation;
    domainSpec: DatasetV3DomainSpec;
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
