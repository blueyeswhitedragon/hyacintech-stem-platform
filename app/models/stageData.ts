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
  themeMapping?: ThemeMapping;
  factorDirection?: string;
  phenomenonDirection?: string;
  /** @deprecated 兼容旧会话；新流程在阶段2才正式定义变量。 */
  variables: {
    independent: string;
    /** 第一阶段只确定自变量方向；因变量的具体测量方式下沉到第二阶段，故此处可空。 */
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
  independentVariable: { name: string; levels: string[] };
  dependentVariable: { name: string; measurement: string };
  controlledVariables: string[];
  materials: string[];
  procedure: string[];
  /** 每个自变量水平至少重复多少次；用于区分“组别数”和“重复测量次数”。 */
  repeatCount: number;
  safetyNotes: string[];
}

export interface Stage2Data {
  submitted: boolean;
  approved: boolean | null; // null=未审核
  teacherFeedback?: string;
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
    correct: number;
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
  reflection: string; // 学生填写
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
  teacherScore?: number;
  teacherFeedback?: string;
  /** docx 轻量导入：学生上传报告的原文件 URL（留存）。 */
  uploadedDocUrl?: string;
  /** docx 轻量导入：从上传报告提取的纯文本（供学生/教师参考，不覆盖 AI 框架）。 */
  uploadedText?: string;
}

export interface Stage6Data {
  studentResponse: string;
  finalReadonly: boolean;
}

export interface StageData {
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
