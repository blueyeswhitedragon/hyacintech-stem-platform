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
  /** 新方案显式标记合同版本；缺失时按历史 v1 方案处理。 */
  contractVersion?: 'stage2-plan-v2';
  researchQuestion?: string;
  hypothesis?: string;
  independentVariable: { name: string; levels: string[] };
  dependentVariable: { name: string; measurement: string; unit?: string };
  dataRecording?: {
    tool: string;
    timing: string;
    recordedFields: string[];
  };
  controlledVariables: string[];
  materials: string[];
  procedure: string[];
  /** 每个自变量水平包含的实验对象数量；与独立重复轮次严格区分。 */
  sampleSizePerLevel?: number;
  /** 每个自变量水平至少独立重复多少轮。 */
  repeatCount: number;
  safetyNotes: string[];
}

export type Stage2CoreField =
  | 'independent_variable'
  | 'levels'
  | 'dependent_variable'
  | 'measurement_tool'
  | 'measurement_timing'
  | 'recorded_fields'
  | 'procedure'
  | 'controls'
  | 'repeats'
  | 'hypothesis';

export type Stage2SectionId =
  | 'variable_design'
  | 'data_recording'
  | 'experiment_process'
  | 'expected_result';

export interface Stage2Readiness {
  policyVersion: 'stage2-readiness-v1' | 'stage2-readiness-v2';
  complete: boolean;
  completedFields: Stage2CoreField[];
  missingFields: Stage2CoreField[];
  completedSections: Stage2SectionId[];
  missingSections: Stage2SectionId[];
  nextFocusId: Stage2SectionId | 'plan_confirmation';
}

export type Stage2PlanProvenanceSource = 'student_fact' | 'student_form' | 'server_composed' | 'server_baseline' | 'teacher_release';

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
  | 'dataRecording'
  | 'controlledVariables'
  | 'materials'
  | 'procedure'
  | 'sampleSizePerLevel'
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
    provenance?: 'server_composed' | 'teacher_release';
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

/** 单轮分析未被计入的原因；null/缺省表示该轮已被接受。 */
export type Stage4RoundRejection =
  | 'NO_EVIDENCE'
  | 'SINGLE_EVIDENCE'
  | 'NO_COMPARISON'
  | 'NO_NEW_EVIDENCE';

// 阶段4：分析轮次计数（至少2轮有效分析才能进入阶段5）
export interface Stage4Data {
  analysisCount: number;
  /**
   * 最近一轮分析的服务器判定，只用于告诉学生和导师「差在哪一半」。
   * 不参与门禁计数；旧记录缺省即可。
   */
  lastRound?: {
    accepted: boolean;
    rejection?: Stage4RoundRejection;
    evidenceCount: number;
    newEvidenceCount: number;
    hasComparison: boolean;
    matchedValues: string[];
  };
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

export type Stage5ImportField = Exclude<keyof Stage5Sections, 'reflection'>;

export interface Stage5ImportPreview {
  previewHash: string;
  originalFileName: string;
  sections: Partial<Stage5Sections>;
  detectedFields: Stage5ImportField[];
  missingFields: Stage5ImportField[];
  complete: boolean;
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
  /** 待学生核对的服务器章节识别结果；确认前不覆盖权威报告字段。 */
  importPreview?: Stage5ImportPreview;
  lastConfirmedImport?: {
    previewHash: string;
    importedFields: Stage5ImportField[];
    confirmedAt: string;
  };
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
  /** 缺省按 tutor_dialogue 处理，兼容历史账本。 */
  origin?: 'tutor_dialogue' | 'student_form';
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
    releases?: Array<{
      stage: number;
      fromStage: number;
      toStage: number;
      teacherId: string;
      reason: string;
      occurredAt: string;
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
