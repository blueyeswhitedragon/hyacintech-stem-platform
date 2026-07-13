import type { ChatResponse } from '@/app/models/types';
export { STYLE_FAMILIES, STYLE_LABELS } from '@/app/lib/stylePolicy';
export type { StyleFamily } from '@/app/lib/stylePolicy';
import type { StyleFamily } from '@/app/lib/stylePolicy';

export const WORK_REVIEW_STATUSES = ['PENDING', 'APPROVED', 'RETURNED', 'INVALID'] as const;
export type WorkReviewStatus = (typeof WORK_REVIEW_STATUSES)[number];

export const WORK_REVIEW_LABELS: Record<WorkReviewStatus, string> = {
  PENDING: '待审核',
  APPROVED: '审核通过',
  RETURNED: '退回修改',
  INVALID: '无效',
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

export const ISSUE_TAG_META: Record<IssueTag, { label: string; description: string }> = {
  student_agency_loss: { label: '学生主导性丢失', description: '导师替学生直接决定研究问题、变量、方案或结论，没有保留学生作出选择的空间。' },
  theme_drift: { label: '研究主题偏移', description: '回复逐渐偏离学生最初提出的兴趣、机制或真实研究问题。' },
  proxy_drift: { label: '课堂替代实验偏移', description: '课堂中的替代实验没有保留原问题的关键机制、约束或可比较关系。' },
  cognitive_overload: { label: '认知负担过重', description: '单轮提出的问题、概念或任务过多，超出学生容易处理的范围。' },
  safety_missing: { label: '安全提醒缺失', description: '存在明显实验风险，但导师没有给出必要、具体的安全提醒。' },
  safety_overload: { label: '安全提醒过度', description: '安全提醒重复或篇幅过长，压过了当前阶段真正需要完成的探究任务。' },
  stage_violation: { label: '阶段越界', description: '回复提前进入后续阶段，或遗漏了当前阶段必须完成的关键工作。' },
  premature_conclusion: { label: '过早下结论', description: '尚未获得或分析足够证据时，导师已经给出确定性结论。' },
  formulaic_tone: { label: '表达过于模板化', description: '回复机械套用固定话术，没有回应学生当前提供的具体信息。' },
  structure_invalid: { label: '输出结构不合法', description: '结构化字段缺失、互相矛盾或不符合当前阶段的数据契约。' },
};

export const PHASE_META: Record<number, { label: string; goal: string; guardrail: string }> = {
  1: { label: '选题定向', goal: '把兴趣转化为可操作、可测量的研究问题。', guardrail: '不要替学生直接决定最终题目。' },
  2: { label: '方案设计', goal: '明确变量、实验步骤、测量方法和数据记录方式。', guardrail: '变量尚未确认前，不要提前生成最终数据表。' },
  3: { label: '过程执行', goal: '按方案记录真实过程、数据、异常情况和安全措施。', guardrail: '不要编造实验结果或替学生补录数据。' },
  4: { label: '数据分析', goal: '比较数据、识别趋势，并区分证据与推测。', guardrail: '不要跳过数据证据直接给出结论。' },
  5: { label: '报告成型', goal: '把目的、方法、数据和分析组织成完整报告。', guardrail: '不要代写学生应完成的结论和反思。' },
  6: { label: '结果反思', goal: '评价证据质量、局限与下一步改进方向。', guardrail: '反思应建立在本次真实过程和结果之上。' },
};

export type AnnotationClaimReason =
  | 'NO_ACTIVE_CAMPAIGN'
  | 'NO_CAMPAIGN_ASSIGNMENT'
  | 'DOUBLE_BLIND_EXHAUSTED'
  | 'NO_PENDING_TASKS';

export interface AnnotationClaimAvailability {
  reason: AnnotationClaimReason | null;
  remainingGlobal: number;
  eligibleForUser: number;
  blockedByDoubleBlind: number;
}

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
    styleFamily?: StyleFamily;
    stylePolicyVersion?: string;
  };
}

export interface TrainingShareGPTRecord extends Omit<ShareGPTRecord, 'conversations'> {
  conversations: Array<{
    from: 'system' | 'human' | 'gpt';
    value: string;
  }>;
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
  transformationType?: TransformationType;
}

export const TRANSFORMATION_TYPES = ['NO_CHANGE', 'LIGHT_EDIT', 'MATERIAL_CORRECTION', 'HUMAN_REWRITE'] as const;
export type TransformationType = (typeof TRANSFORMATION_TYPES)[number];

export const TRANSFORMATION_LABELS: Record<TransformationType, string> = {
  NO_CHANGE: '无需修改',
  LIGHT_EDIT: '轻微润色',
  MATERIAL_CORRECTION: '实质纠正',
  HUMAN_REWRITE: '人工重写',
};

export interface AnnotationPayload {
  taskId: string;
  sampleId: string;
  sourceRecordId: string;
  sourceKind: string;
  phase: number;
  scenario: string;
  styleFamily: StyleFamily | null;
  stylePolicyVersion: string;
  conversations: Array<{
    index: number;
    from: 'human' | 'gpt';
    value: string;
    response?: ChatResponse;
  }>;
  autoCheck: AutoCheckResult;
  rubricTargets: string[];
  draft?: RevisionInput;
  leaseExpiresAt: string | null;
}

export interface CampaignSelection {
  batchIds?: string[];
  phases?: number[];
  candidateTiers?: string[];
  limit?: number;
}

export interface CampaignParticipantInput {
  userId: string;
  taskLimit?: number;
}

export type StyleQuota = Partial<Record<StyleFamily, number>>;

export interface ReleaseRecipe {
  goldWeight: number;
  silverWeight: number;
  includeHumanGold: boolean;
  includeReviewedSilver: boolean;
}
