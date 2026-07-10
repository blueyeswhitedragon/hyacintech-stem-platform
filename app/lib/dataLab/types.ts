import type { ChatResponse } from '@/app/models/types';

export const STYLE_FAMILIES = [
  'socratic_concise',
  'warm_companion',
  'engineering_mentor',
  'evidence_analyst',
  'classroom_coach',
] as const;

export type StyleFamily = (typeof STYLE_FAMILIES)[number];

export const STYLE_LABELS: Record<StyleFamily, string> = {
  socratic_concise: '苏格拉底简洁型',
  warm_companion: '温和陪伴型',
  engineering_mentor: '工程导师型',
  evidence_analyst: '证据分析型',
  classroom_coach: '课堂教练型',
};

export const ISSUE_TAGS = [
  'student_agency_loss',
  'theme_drift',
  'proxy_drift',
  'cognitive_overload',
  'safety_missing',
  'safety_overload',
  'stage_violation',
  'premature_conclusion',
  'formulaic_tone',
  'structure_invalid',
] as const;

export type IssueTag = (typeof ISSUE_TAGS)[number];

export interface ShareGPTMessage {
  from: 'human' | 'gpt';
  value: string;
}

export interface ShareGPTRecord {
  id: string;
  source?: string;
  scenario: string;
  phase: number;
  rubricTargets?: string[];
  evidence?: string[];
  qualityNotes?: string;
  conversations: ShareGPTMessage[];
  meta?: Record<string, unknown> & {
    tier?: string;
    sourceKind?: string;
    distillTaskId?: string;
    personaId?: string;
  };
}

export interface AutoCheckIssue {
  ruleCode: string;
  severity: 'error' | 'warning';
  message: string;
  evidence?: string;
}

export interface AutoCheckResult {
  status: 'ok' | 'warning' | 'error';
  issues: AutoCheckIssue[];
}

export interface AssistantRevision {
  messageIndex: number;
  response: ChatResponse;
}

export interface RevisionInput {
  assistantMessages: AssistantRevision[];
  issueTags: string[];
  changeReason: string;
  noChange: boolean;
}

export interface AnnotationPayload {
  taskId: string;
  sampleId: string;
  sourceRecordId: string;
  phase: number;
  scenario: string;
  styleFamily: StyleFamily | null;
  conversations: Array<{
    index: number;
    from: 'human' | 'gpt';
    value: string;
    response?: ChatResponse;
  }>;
  draft?: RevisionInput;
  leaseExpiresAt: string | null;
}

export interface CampaignSelection {
  batchIds?: string[];
  phases?: number[];
  candidateTiers?: string[];
  limit?: number;
}

export type StyleQuota = Partial<Record<StyleFamily, number>>;

export interface ReleaseRecipe {
  goldWeight: number;
  silverWeight: number;
  includeHumanGold: boolean;
  includeReviewedSilver: boolean;
}
