/**
 * 定义系统中使用的各种数据类型
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  phase: number;
  history: Message[];
}

export interface ChatResponse {
  dialogue: string;
  next_action_type: 'ask_choice' | 'text_input' | 'confirmation' | 'info';
  options?: string[];
  phase_complete: boolean;
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

/**
 * 每个阶段的数据结构
 */
export interface PhaseData {
  [PhaseEnum.TopicSelection]?: {
    interest?: string;
    selectedTopic?: string;
    researchQuestion?: string;
  };
  [PhaseEnum.PlanDesign]?: {
    variables?: {
      independent?: string;
      dependent?: string;
      control?: string[];
    };
    materials?: string[];
    procedure?: string[];
  };
  [PhaseEnum.Execution]?: {
    rawData?: any;
    observations?: string[];
  };
  [PhaseEnum.DataAnalysis]?: {
    analyzedData?: any;
    findings?: string[];
  };
  [PhaseEnum.ResultsFormation]?: {
    conclusion?: string;
    report?: string;
  };
  [PhaseEnum.Reflection]?: {
    improvements?: string[];
    nextSteps?: string[];
  };
}