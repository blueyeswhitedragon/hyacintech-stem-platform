/**
 * 定义系统中使用的各种数据类型
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  options?: string[];
  actionType?: 'ask_choice' | 'text_input' | 'confirmation' | 'info';
  phaseComplete?: boolean;
  status?: 'sending' | 'sent' | 'error';
}

import type {
  Stage2Column,
  Stage2RiskAnnotation,
  Stage5Sections,
} from './stageData';

/** stage5 报告框架预填字段（不含学生自填的 conclusion/reflection）。 */
export type ReportSections = Pick<
  Stage5Sections,
  'purpose' | 'hypothesis' | 'materials' | 'procedure' | 'dataSummary' | 'analysis'
>;

export interface SafetyQuiz {
  question: string;
  options: string[];
  correct: number;
}

export interface ChatResponse {
  dialogue: string;
  next_action_type: 'ask_choice' | 'text_input' | 'confirmation' | 'info';
  options?: string[];
  phase_complete: boolean;

  // ---- M4 结构化产出（可选，按阶段在合适时机出现）----
  // 阶段1：学生确认研究问题后
  stage1_confirmed?: boolean;
  snapshot?: string; // 《探究问题确认书》纯文本
  variables?: { independent: string; dependent: string };
  // 阶段2：方案成型
  data_table_schema?: { columns: Stage2Column[]; minRows: number; maxRows: number };
  risks?: Stage2RiskAnnotation[];
  // 阶段3：首次进入
  safety_quiz?: SafetyQuiz;
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
  ResultsFormation = 5, // 成果成型
  Reflection = 6        // 结果反思
}