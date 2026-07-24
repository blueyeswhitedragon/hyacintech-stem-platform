/**
 * Conversation.stageData 字段的 TypeScript 结构（按「框架2(1).txt」第三章）。
 * 前后端共用。Conversation.stageData 在数据库中以 JSON 字符串存储，
 * 读写时用 JSON.parse / JSON.stringify 与本结构互转。
 */

export interface ThemeMapping {
  /** 学生最初提出的宽泛兴趣或高概念主题。 */
  originalInterest: string;
  /** 从原始主题中保留下来的真实特征、困难或约束。 */
  retainedFeature: string;
  /** 在课堂中安全、可操作地模拟该特征的代理方式。 */
  classroomProxy: string;
  /** 最终收敛出的可探究问题。 */
  researchQuestion: string;
}

export interface Stage1Data {
  confirmed: boolean;
  snapshot: string; // 纯文本《探究问题确认书》
  /** 阶段1唯一必需的语义产物。 */
  researchQuestion?: string;
  /** 确认绑定到规范化研究问题；问题变化后旧确认立即失效。 */
  confirmedQuestionHash?: string;
  confirmationSource?: {
    type: 'student_explicit' | 'legacy_recovery';
    sourceQuote: string;
    messageId?: string;
  };
  themeMapping?: ThemeMapping;
  /** @deprecated 阶段2字段的只读兼容镜像，不再作为阶段1门禁。 */
  factorDirection?: string;
  /** @deprecated 阶段2字段的只读兼容镜像，不再作为阶段1门禁。 */
  phenomenonDirection?: string;
  /** @deprecated 兼容旧会话；新流程在阶段2才正式定义变量。 */
  variables?: {
    independent: string;
    dependent?: string;
    controlled?: string[];
  };
}

export interface Stage2Column {
  key: string;
  title: string;
  type: 'text' | 'number' | 'image';
  required: boolean;
}

export interface Stage2RiskAnnotation {
  columnKey?: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface Stage2ExperimentPlan {
  researchQuestion?: string;
  hypothesis?: string;
  independentVariable: { name: string; levels: string[] };
  dependentVariable: { name: string; measurement: string; unit?: string };
  controlledVariables: string[];
  materials: string[];
  procedure: string[];
  /** 每个自变量水平至少重复多少次；用于区分“组别数”和“重复测量次数”。 */
  repeatCount: number;
  safetyNotes: string[];
}

export type Stage2CoreField =
  | 'hypothesis'
  | 'independent_variable'
  | 'levels'
  | 'dependent_variable'
  | 'measurement'
  | 'controls'
  | 'repeats';

export interface Stage2Readiness {
  policyVersion: 'stage2-readiness-v1';
  complete: boolean;
  completedFields: Stage2CoreField[];
  missingFields: Stage2CoreField[];
  nextFocusId: Stage2CoreField | 'plan_confirmation';
}

export type Stage2PlanProvenanceSource = 'student_fact' | 'server_composed' | 'server_baseline';

export interface Stage2PlanProvenanceEntry {
  source: Stage2PlanProvenanceSource;
  sourceFields: string[];
}

export type Stage2PlanProvenance = Partial<Record<
  | 'researchQuestion'
  | 'hypothesis'
  | 'independentVariable'
  | 'levels'
  | 'dependentVariable'
  | 'measurement'
  | 'controlledVariables'
  | 'materials'
  | 'procedure'
  | 'repeatCount'
  | 'safetyNotes',
  Stage2PlanProvenanceEntry
>>;

export interface Stage2Data {
  submitted: boolean;
  /** @deprecated 兼容旧记录；新流程以 confirmedPlanHash 为准。 */
  factsConfirmed?: boolean;
  approved: boolean | null; // null=未审核
  teacherFeedback?: string;
  /** 从已验证学生事实实时组装、尚未冻结的服务器草案。 */
  planDraft?: Stage2ExperimentPlan;
  /** 科学核心字段的统一就绪状态，供抽取、Tutor、UI 与推进门禁共用。 */
  readiness?: Stage2Readiness;
  /** 方案各字段来自学生事实还是服务器组装；不进入 Tutor SFT 目标。 */
  planProvenance?: Stage2PlanProvenance;
  draftHash?: string;
  /** 学生通过专用端点确认的草案哈希。 */
  confirmedPlanHash?: string;
  confirmationSource?: {
    type: 'student_checkpoint' | 'legacy_recovery';
    confirmedAt: string;
  };
  /** 冻结后的权威方案；只有确认 draftHash 后才写入。 */
  experimentPlan?: Stage2ExperimentPlan;
  schema: {
    columns: Stage2Column[];
    minRows: number;
    maxRows: number; // 默认200
  };
  aiRiskAnnotations?: Stage2RiskAnnotation[];
}

export interface Stage3FileAssociation {
  rowIndex: number;
  colKey: string;
  fileUrl: string;
}

export interface Stage3Data {
  rows: Record<string, unknown>[]; // 每行都是 { [colKey]: value }
  fileAssociations?: Stage3FileAssociation[];
  safetyQuiz?: {
    question: string;
    options: string[];
    correct?: number;
    selected?: number;
    passed: boolean;
  };
  /** 学生点 3→4 推进时置 true，进入教师「数据表待过目（可选）」清单（非阻塞）。 */
  submitted?: boolean;
  /** 教师审核结果：true=已过目认可；false=被打回需修改；undefined=未过目。 */
  approved?: boolean | null;
  teacherFeedback?: string;
}

// 阶段4：分析轮次计数（至少2轮有效分析才能进入阶段5）
export interface Stage4Data {
  analysisCount: number;
  observations?: string[];
  evidenceCitations?: string[];
  anomalies?: string[];
  interpretations?: string[];
  evidenceRounds?: Array<{
    observation: string;
    citations: string[];
    matchedValues: string[];
    evidence?: Array<{
      rowIndex: number;
      columnKey: string;
      columnName: string;
      citedValue: string;
      fingerprint: string;
    }>;
    roundFingerprint?: string;
    anomaly?: string;
    interpretation?: string;
  }>;
}

export interface Stage5Sections {
  purpose: string;
  hypothesis: string;
  materials: string;
  procedure: string;
  dataSummary: string;
  analysis: string;
  conclusion: string; // 学生填写
  /** 阶段5只讨论本次实验的局限、误差与改进，不承担阶段6的学习反思。 */
  limitationsDiscussion?: string;
  /** @deprecated 旧会话兼容镜像；新写入与 limitationsDiscussion 保持一致。 */
  reflection: string;
}

export interface Stage5ReferenceScore {
  overall: number; // 1-10
  dimensions: {
    completeness: number;
    logic: number;
    dataUsage: number;
    innovation: number;
    expression: number;
  };
  highlights: string[];
  suggestions: { text: string; targetSection: string }[];
  safetyCompliance: boolean;
}

export interface Stage5Data {
  submitted: boolean;
  approved: boolean | null;
  sections: Stage5Sections;
  aiReferenceScore?: Stage5ReferenceScore;
  /** 本次送审的平台报告字段哈希；不包含上传 Word 的正文。 */
  submittedSectionsHash?: string;
  /** AI 参考分实际对应的平台报告字段哈希。 */
  aiScoreSectionsHash?: string;
  teacherScore?: number;
  teacherFeedback?: string;
  /** docx 轻量导入：学生上传报告的原文件 URL（留存）。 */
  uploadedDocUrl?: string;
  /** docx 轻量导入：从上传报告提取的纯文本（供学生/教师参考，不覆盖 AI 框架）。 */
  uploadedText?: string;
}

export interface Stage6Data {
  /** @deprecated 旧客户端的合并文本镜像。 */
  studentResponse: string;
  responseToTeacherFeedback: string;
  learningReflection: string;
  finalReadonly: boolean;
}

export interface ExtractedFactLedgerEntry {
  value: unknown;
  sourceQuote: string;
}

export interface StageData {
  contractMeta?: {
    stageContractVersion: string;
    extractorVersion: string;
    revision: number;
    stateHash: string;
    lastMutation: string;
    promptPolicyVersion?: string;
    serverArtifactTypes?: string[];
  };
  timeline?: {
    dueAt?: string;
    lateEvents: Array<{
      event: 'STAGE2_SUBMITTED' | 'DATA_COLLECTION_COMPLETED' | 'STAGE5_SUBMITTED' | 'FINAL_SUBMITTED';
      stage: number;
      occurredAt: string;
      dueAt: string;
    }>;
  };
  /** 仅保存通过逐字来源校验的学生事实；Tutor 历史永不写入。 */
  extractedFacts?: Record<string, ExtractedFactLedgerEntry>;
  stage1?: Stage1Data;
  stage2?: Stage2Data;
  stage3?: Stage3Data;
  stage4?: Stage4Data;
  stage5?: Stage5Data;
  stage6?: Stage6Data;
  /** 各阶段累计对话轮次（学生消息数），用于过度追问的节奏兜底与逃生按钮判定。键为阶段号。 */
  roundCounts?: Record<number, number>;
}

/** StudentAssignment.status 取值。 */
export type AssignmentStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PENDING_STAGE2'
  | 'PENDING_STAGE5'
  | 'COMPLETED';
