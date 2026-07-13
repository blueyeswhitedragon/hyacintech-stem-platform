/**
 * 定义系统中使用的各种数据类型
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  options?: string[];
  /** 可选提示/引导建议，区别于 options（选项），hints 是思维引导而非直接选择 */
  hints?: string[];
  actionType?: 'ask_choice' | 'text_input' | 'confirmation' | 'info';
  /** 特殊消息类型：确认书或系统主动阶段过渡。 */
  messageType?: 'confirmation_doc' | 'stage_transition';
  phaseComplete?: boolean;
  status?: 'sending' | 'sent' | 'error';
}

import type {
  Stage2Column,
  Stage2RiskAnnotation,
  Stage5Sections,
  ThemeMapping,
} from './stageData';

/** stage5 报告框架预填字段（不含学生自填的 conclusion/reflection）。 */
export type ReportSections = Pick<
  Stage5Sections,
  'purpose' | 'hypothesis' | 'materials' | 'procedure' | 'dataSummary' | 'analysis'
>;


export interface TopicDirection {
  /** 阶段1只确定拟改变因素方向，不包含水平/梯度。 */
  factor: string;
  /** 阶段1只确定关注现象方向，不包含测量操作定义。 */
  phenomenon: string;
}

export interface ExperimentPlan {
  independentVariable: { name: string; levels: string[] };
  dependentVariable: { name: string; measurement: string };
  controlledVariables: string[];
  materials: string[];
  procedure: string[];
  repeatCount: number;
  safetyNotes: string[];
}

export interface AnalysisProgress {
  /** 学生本轮提出的观察，不应由 AI 代写。 */
  observation?: string;
  /** 学生本轮明确引用的数据证据。 */
  evidenceCitations?: string[];
  anomalyNoted?: string;
  interpretation?: string;
  /** 只有学生确实引用证据并完成比较时才为 true。 */
  studentEvidenceAccepted?: boolean;
}

export interface SafetyQuiz {
  question: string;
  options: string[];
  correct: number;
}

export interface ChatResponse {
  dialogue: string;
  next_action_type: 'ask_choice' | 'text_input' | 'confirmation' | 'info';
  options?: string[];
  /** 可选提示/引导建议（思维引导，不直接给答案）。点击填入输入框而非直接发送。 */
  hints?: string[];
  phase_complete: boolean;

  // ---- M4 结构化产出（可选，按阶段在合适时机出现）----
  // 阶段1：学生确认研究问题后
  stage1_confirmed?: boolean;
  snapshot?: string; // 《探究问题确认书》纯文本
  theme_mapping?: ThemeMapping;
  topic_direction?: TopicDirection;
  /** @deprecated 兼容旧记录；新阶段1不再正式操作化变量。 */
  variables?: { independent: string; dependent?: string; controlled?: string[] };
  // 阶段2：方案成型
  experiment_plan?: ExperimentPlan;
  data_table_schema?: { columns: Stage2Column[]; minRows: number; maxRows: number };
  risks?: Stage2RiskAnnotation[];
  // 阶段3：首次进入
  safety_quiz?: SafetyQuiz;
  // 阶段4：学生实际完成的证据分析进度
  analysis_progress?: AnalysisProgress;
  // 阶段5：生成报告框架
  report_sections?: ReportSections;
}

/**
 * 定义六个科学探究阶段
 */
export enum PhaseEnum {
  TopicSelection = 1,   // 选题定向
  PlanDesign = 2,       // 方案设计
  Execution = 3,        // 过程执行
  DataAnalysis = 4,     // 数据分析
  ResultsFormation = 5, // 报告成型
  Reflection = 6        // 结果反思
}
