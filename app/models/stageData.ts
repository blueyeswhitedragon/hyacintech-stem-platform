/**
 * Conversation.stageData 字段的 TypeScript 结构（按「框架2(1).txt」第三章）。
 * 前后端共用。Conversation.stageData 在数据库中以 JSON 字符串存储，
 * 读写时用 JSON.parse / JSON.stringify 与本结构互转。
 */

export interface Stage1Data {
  confirmed: boolean;
  snapshot: string; // 纯文本《探究问题确认书》
  variables: {
    independent: string;
    dependent: string;
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

export interface Stage2Data {
  submitted: boolean;
  approved: boolean | null; // null=未审核
  teacherFeedback?: string;
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
}

// 阶段4无存储数据，图表实时生成。

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
}

export interface Stage6Data {
  studentResponse: string;
  finalReadonly: boolean;
}

export interface StageData {
  stage1?: Stage1Data;
  stage2?: Stage2Data;
  stage3?: Stage3Data;
  stage5?: Stage5Data;
  stage6?: Stage6Data;
}

/** StudentAssignment.status 取值。 */
export type AssignmentStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PENDING_STAGE2'
  | 'PENDING_STAGE5'
  | 'COMPLETED';
