import type { ChatResponse } from '@/app/models/types';

export const STAGE_CONTRACT_VERSION = 'stage-contract-v2';

export type StageTriggerType =
  | 'USER_MESSAGE'
  | 'STAGE_ENTER'
  | 'STAGE_TRANSITION'
  | 'TEACHER_APPROVAL'
  | 'REPORT_BOOTSTRAP'
  | 'OPTIONAL_COACHING';

export interface StageBehaviorContract {
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  allow: readonly string[];
  forbid: readonly string[];
  completion: string;
}

export const STAGE_BEHAVIOR_CONTRACTS: Record<number, StageBehaviorContract> = {
  1: {
    phase: 1,
    label: '选题定向',
    allow: [
      '理解学生原始兴趣和希望保留的机制、困难或约束',
      '判断课堂可行性、安全性和低成本代理方向',
      '引导学生形成具体研究问题',
      '确认拟改变因素方向和关注现象方向，但不做变量操作化',
      '解释课堂代理与原始主题的对应关系',
    ],
    forbid: [
      '正式确定自变量水平、梯度或实验组别',
      '确定因变量测量指标、操作定义或计算公式',
      '逐项确定控制变量、材料、步骤、重复次数或数据表',
      '提供隐藏式课题或指标选项替学生决定',
      '阶段确认后继续生成额外确认轮',
    ],
    completion: '输出 stage1_confirmed、theme_mapping、topic_direction 和 snapshot；不要输出阶段2方案。',
  },
  2: {
    phase: 2,
    label: '方案设计',
    allow: [
      '正式确定自变量及水平、因变量及测量方式、控制变量',
      '确定材料、步骤、重复次数和安全方案',
      '信息完整后输出 experiment_plan 和 data_table_schema',
      '让数据表直接服务于后续比较和图表分析',
    ],
    forbid: [
      '重新替学生选择研究主题',
      '信息不足时一次性代写完整方案',
      '提前讨论实验结果、趋势、结论或报告',
      '输出重复列 key、长表组别结构或与方案不一致的数据表',
      '已生成数据表却使用非 confirmation 动作',
    ],
    completion: '同一回复输出 experiment_plan 与有效 data_table_schema，并使用 confirmation。',
  },
  3: {
    phase: 3,
    label: '过程执行',
    allow: [
      '首次进入时输出与当前实验相关的 safety_quiz',
      '指导学生在数据表面板记录真实数据和异常备注',
      '提供不改变核心研究设计的操作排查',
      '危险操作时停止并给出保留原研究机制的安全替代',
    ],
    forbid: [
      '编造数据、预测结果或提前分析趋势',
      '改变研究问题、自变量或未经审核增加实验条件',
      '删除、美化或忽略异常数据',
      '给出模型可见上下文中不存在的具体参数',
    ],
    completion: '由数据表按钮推进，不使用 confirmation 或 phase_complete。',
  },
  4: {
    phase: 4,
    label: '数据分析',
    allow: [
      '阶段进入时基于真实 rows 主动发送分析开场',
      '每轮只推进一个分析动作并要求引用具体证据',
      '比较组间差异、时间趋势、最大最小、平均和异常值',
      '区分观察、解释、相关性、因果和结论强度',
      '通过 analysis_progress 记录学生已经完成的分析证据',
    ],
    forbid: [
      '无数据却声称已经查看数据',
      '引用当前模型可见上下文中不存在的数值',
      '直接替学生给出完整趋势、原因和最终结论',
      '把相关性表述成确定因果',
      '一轮堆叠多个核心分析问题',
    ],
    completion: '至少形成两轮有效的学生证据分析后，由按钮推进。',
  },
  5: {
    phase: 5,
    label: '报告成型',
    allow: [
      '仅使用结构化方案、真实数据和已完成分析生成报告框架',
      '预填 purpose、hypothesis、materials、procedure、dataSummary、analysis',
      '缺失信息明确标注，不编造',
      '保留 conclusion 和 reflection 给学生填写',
    ],
    forbid: [
      '引用模型可见上下文中不存在的材料、步骤或数值',
      '使用通用 A/B/C 模板数据填充报告',
      '直接代写最终结论和反思',
      '将占位内容描述为已经完成的完整报告',
    ],
    completion: 'REPORT_BOOTSTRAP 触发时输出 report_sections；提交由报告面板按钮完成。',
  },
  6: {
    phase: 6,
    label: '结果反思',
    allow: [
      '基于真实报告、教师评价和证据局限提出一个反思问题',
      '引导学生自己识别误差、提出改进和限定迁移范围',
      '作为 Stage6Panel 最终学生反思的可选辅导',
    ],
    forbid: [
      '直接给出完整误差分析、改进方案或迁移答案',
      '一轮堆叠多个反思任务',
      '引入与本次研究无关的新实验或复杂工程任务',
      '使用 confirmation 或 phase_complete 代替学生提交',
    ],
    completion: '最终完成只由 Stage6Panel 的学生提交触发。',
  },
};

export function buildStageContractInstruction(phase: number): string {
  const contract = STAGE_BEHAVIOR_CONTRACTS[phase];
  if (!contract) return '';
  return [
    `【阶段行为合同 ${STAGE_CONTRACT_VERSION}：${contract.label}】`,
    '本阶段允许：',
    ...contract.allow.map((item, index) => `${index + 1}. ${item}`),
    '本阶段禁止：',
    ...contract.forbid.map((item, index) => `${index + 1}. ${item}`),
    `完成条件：${contract.completion}`,
  ].join('\n');
}

export type StageContractIssueSeverity = 'warning' | 'error';

export interface StageContractIssue {
  code: string;
  severity: StageContractIssueSeverity;
  message: string;
  evidence?: string;
}

export interface StageContractValidationContext {
  triggerType?: StageTriggerType;
  visibleContext?: string;
}

function issue(code: string, severity: StageContractIssueSeverity, message: string, evidence?: string): StageContractIssue {
  return { code, severity, message, evidence };
}

function responseText(response: ChatResponse): string {
  return [
    response.dialogue,
    ...(response.hints ?? []),
    response.snapshot,
    response.topic_direction ? JSON.stringify(response.topic_direction) : undefined,
    response.variables ? JSON.stringify(response.variables) : undefined,
    response.experiment_plan ? JSON.stringify(response.experiment_plan) : undefined,
    response.analysis_progress ? JSON.stringify(response.analysis_progress) : undefined,
    response.report_sections ? JSON.stringify(response.report_sections) : undefined,
  ].filter((item): item is string => typeof item === 'string' && item.length > 0).join('\n');
}

function numericTokens(value: string): Set<string> {
  const tokens = new Set((value.match(/-?\d+(?:\.\d+)?/g) ?? []).map((item) => String(Number(item))));
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  for (const match of value.matchAll(/([零一二两三四五六七八九十]+)\s*(?=次|个|组|颗|粒|株|皿|天|小时|分钟|秒|℃|摄氏度|毫升|ml|%|档|水平)/gi)) {
    const chinese = match[1];
    let number: number | undefined;
    if (chinese.includes('十')) {
      const [left, right] = chinese.split('十');
      number = (left ? digits[left] : 1) * 10 + (right ? digits[right] : 0);
    } else if (chinese.length === 1) {
      number = digits[chinese];
    }
    if (number !== undefined && Number.isFinite(number)) tokens.add(String(number));
  }
  return tokens;
}

function unseenNumericTokens(text: string, visibleContext?: string): string[] {
  if (!visibleContext?.trim()) return [];
  const visible = numericTokens(visibleContext);
  return [...numericTokens(text)].filter((token) => !visible.has(token));
}

export function validateStageResponseBehavior(
  phase: number,
  response: ChatResponse,
  context: StageContractValidationContext = {},
): StageContractIssue[] {
  const issues: StageContractIssue[] = [];
  const text = responseText(response);

  if (phase === 1) {
    const activeStage1Text = text
      .split(/[。！？!?；;\n]/)
      .filter((segment) => !/下一阶段|留到(?:阶段2|方案设计)|暂不|本阶段不|将在方案设计/.test(segment))
      .join('\n');
    if (response.next_action_type === 'ask_choice' || (response.options?.length ?? 0) > 0) {
      issues.push(issue('P1_CHOICE_ACTION_FORBIDDEN', 'error', '阶段1必须使用开放式引导，禁止 ask_choice 和非空 options'));
    }
    if (/怎么测|如何测|测量方式|用什么.{0,8}(?:测|记录)|记录哪些|观察指标|衡量.{0,8}(?:方法|指标)/.test(activeStage1Text)) {
      issues.push(issue('P1_MEASUREMENT_OVERREACH', 'error', '阶段1不能追问或指定因变量测量方式', text));
    }
    if (/梯度|设定.{0,8}(?:档|组|水平)|比较哪几种|哪几个水平|每组\d+|\d+\s*(?:小时|℃|%|毫升|ml).{0,12}(?:组|档|水平)/i.test(activeStage1Text)) {
      issues.push(issue('P1_LEVEL_OVERREACH', 'error', '阶段1不能确定自变量水平、梯度或实验组别', text));
    }
    if (/哪些控制变量|控制变量有|保持不变的因素|除了.{0,12}还要保持|逐项.{0,8}控制/.test(activeStage1Text)) {
      issues.push(issue('P1_CONTROL_OVERREACH', 'error', '阶段1不能逐项确定控制变量', text));
    }
    if (/实验步骤|材料清单|准备哪些材料|设计数据表|记录表|重复\d+次|取平均|计算.{0,12}(?:率|平均|偏差)/.test(activeStage1Text)) {
      issues.push(issue('P1_PROCEDURE_OVERREACH', 'error', '阶段1不能设计步骤、材料、重复或数据表', text));
    }
    if (/三选一|二选一|你更想.{0,30}还是|比如.{0,30}(?:、|还是).{0,30}(?:、|还是)/.test(text)) {
      issues.push(issue('P1_HIDDEN_CHOICE', 'error', '阶段1不能使用隐藏式选项替学生决定方向', text));
    }
    if (!response.stage1_confirmed && /自变量|因变量/.test(text)) {
      issues.push(issue('P1_FORMAL_VARIABLE_LANGUAGE', 'warning', '阶段1确认前应优先使用“拟改变因素/关注现象”而非正式变量术语', text));
    }
    if (response.stage1_confirmed) {
      if (!response.topic_direction?.factor?.trim() || !response.topic_direction?.phenomenon?.trim()) {
        issues.push(issue('P1_TOPIC_DIRECTION_MISSING', 'error', '阶段1确认必须包含 factor 与 phenomenon 方向'));
      }
      if (!response.theme_mapping || !response.snapshot?.trim()) {
        issues.push(issue('P1_CONFIRMATION_ARTIFACT_MISSING', 'error', '阶段1确认必须包含 theme_mapping 与 snapshot'));
      }
      if (response.next_action_type !== 'confirmation') {
        issues.push(issue('P1_CONFIRMATION_ACTION_INVALID', 'error', '阶段1确认回复必须使用 confirmation'));
      }
      if (response.variables?.dependent?.trim() || (response.variables?.controlled?.length ?? 0) > 0) {
        issues.push(issue('P1_VARIABLE_OPERATIONALIZATION', 'error', '阶段1确认不能写入因变量操作化或控制变量'));
      }
    }
  }

  if (phase === 2) {
    if (context.triggerType === 'STAGE_TRANSITION' && (response.experiment_plan || response.data_table_schema)) {
      issues.push(issue('P2_TRANSITION_OVERCOMPLETION', 'error', '刚进入方案设计时只推进第一个方案缺口，不能立即代写完整方案或数据表'));
    }
    if (/数据显示|结果表明|可以看出|证明了|支持.{0,8}假设|得出结论|最终结论/.test(text)) {
      issues.push(issue('P2_PREMATURE_RESULT', 'error', '方案设计阶段不能提前分析结果或得出结论', text));
    }
    if (response.data_table_schema) {
      if (!response.experiment_plan) {
        issues.push(issue('P2_PLAN_MISSING', 'error', '生成数据表时必须同时输出结构化 experiment_plan'));
      } else if (
        response.experiment_plan.independentVariable.levels.length < 2 ||
        !response.experiment_plan.dependentVariable.measurement.trim() ||
        response.experiment_plan.procedure.length === 0 ||
        !Number.isInteger(response.experiment_plan.repeatCount) ||
        response.experiment_plan.repeatCount < 1
      ) {
        issues.push(issue('P2_PLAN_INCOMPLETE', 'error', 'experiment_plan 必须包含至少两个水平、因变量测量方式、非空步骤和有效重复次数'));
      }
      if (response.next_action_type !== 'confirmation') {
        issues.push(issue('P2_SCHEMA_ACTION_MISMATCH', 'error', '生成数据表时 next_action_type 必须为 confirmation'));
      }
      if (response.data_table_schema.minRows < 3) {
        issues.push(issue('P2_MIN_ROWS_TOO_SMALL', 'error', '数据表 minRows 必须至少为3'));
      }
      if (response.data_table_schema.maxRows !== 200) {
        issues.push(issue('P2_MAX_ROWS_INVALID', 'error', '数据表 maxRows 必须固定为200'));
      }
      if (!response.data_table_schema.columns.some((column) => column.key === 'notes' && column.type === 'text')) {
        issues.push(issue('P2_NOTES_COLUMN_MISSING', 'error', '数据表必须包含 notes 文本备注列'));
      }
      if (!response.data_table_schema.columns.some((column) => column.type === 'number')) {
        issues.push(issue('P2_NUMERIC_RESULT_COLUMN_MISSING', 'error', '数据表必须包含至少一个 number 数值列'));
      }
      const keys = response.data_table_schema.columns.map((column) => column.key);
      if (new Set(keys).size !== keys.length) {
        issues.push(issue('P2_DUPLICATE_COLUMN_KEY', 'error', '数据表存在重复列 key'));
      }
      if (keys.some((key) => !/^[a-z][a-z0-9_]*$/.test(key))) {
        issues.push(issue('P2_COLUMN_KEY_INVALID', 'error', '数据表列 key 必须使用 snake_case'));
      }
      if (keys.some((key) => /^(group|condition|treatment)(?:_name|_label)?$/.test(key))) {
        issues.push(issue('P2_LONG_FORMAT_GROUP_COLUMN', 'warning', '当前图表流程优先使用每个组别独立数值列的宽表结构'));
      }
    }
    if (response.experiment_plan) {
      const unseenPlanNumbers = unseenNumericTokens(JSON.stringify(response.experiment_plan), context.visibleContext);
      if (unseenPlanNumbers.length > 0) {
        issues.push(issue(
          'P2_UNGROUNDED_PLAN_NUMBER',
          'error',
          `实验方案包含学生或前序状态未确认的数字：${unseenPlanNumbers.join('、')}`,
          JSON.stringify(response.experiment_plan),
        ));
      }
    }
  }

  if (phase === 3) {
    if (context.triggerType === 'STAGE_ENTER' && !response.safety_quiz) {
      issues.push(issue('P3_SAFETY_QUIZ_MISSING', 'error', '首次进入过程执行阶段必须输出 safety_quiz'));
    }
    if (/数据显示|结果表明|变化趋势|可以看出|得出结论|证明了/.test(text)) {
      issues.push(issue('P3_ANALYSIS_OVERREACH', 'error', '过程执行阶段不能提前分析数据或得出结论', text));
    }
    if (/改用.{0,20}研究|增加.{0,10}(?:组|条件)|新增.{0,10}(?:组|条件)|换一个实验/.test(text)) {
      issues.push(issue('P3_CORE_PLAN_CHANGE', 'error', '过程执行阶段不能未经审核改变核心方案', text));
    }
    const unseenNumbers = unseenNumericTokens(text, context.visibleContext);
    if (unseenNumbers.length > 0) {
      issues.push(issue('P3_UNGROUNDED_PARAMETER', 'warning', `回复包含方案上下文中未出现的具体数字：${unseenNumbers.join('、')}`, text));
    }
    if (response.next_action_type === 'confirmation' || response.phase_complete) {
      issues.push(issue('P3_COMPLETION_SIGNAL_INVALID', 'error', '阶段3由数据表按钮推进，不使用 completion/confirmation'));
    }
  }

  if (phase === 4) {
    if (context.triggerType === 'STAGE_TRANSITION' && !/数据|记录表|表格|行|列/.test(text)) {
      issues.push(issue('P4_TRANSITION_NOT_GROUNDED', 'error', '阶段4主动开场必须明确承接已提交数据'));
    }
    if (/证明了|因此可以确定|说明.{0,12}导致|必然导致|一定是因为/.test(text) && !/不能|还不能|不代表/.test(text)) {
      issues.push(issue('P4_CAUSAL_OVERCLAIM', 'error', '阶段4不能把相关性表述成确定因果', text));
    }
    if (/结论是|最终结论|由此可见|数据显示.{0,30}(?:所以|因此)/.test(text)) {
      issues.push(issue('P4_DIRECT_CONCLUSION', 'error', '阶段4不能替学生直接给出最终结论', text));
    }
    if (context.triggerType === 'STAGE_TRANSITION' && !/具体数据|数值|引用|比较|哪一组|哪一列|变化/.test(text)) {
      issues.push(issue('P4_EVIDENCE_REQUEST_MISSING', 'warning', '主动开场应要求学生引用具体数据完成第一个分析动作', text));
    }
    if (context.triggerType === 'STAGE_TRANSITION' && response.next_action_type !== 'text_input') {
      issues.push(issue('P4_TRANSITION_ACTION_INVALID', 'error', '系统主动开场必须使用 text_input'));
    }
    if (context.triggerType === 'STAGE_TRANSITION' && response.analysis_progress) {
      issues.push(issue('P4_TRANSITION_PROGRESS_FORBIDDEN', 'error', '系统主动开场不能伪造学生已经完成的 analysis_progress'));
    }
    if (
      response.analysis_progress?.studentEvidenceAccepted &&
      (!response.analysis_progress.observation?.trim() || (response.analysis_progress.evidenceCitations?.length ?? 0) === 0)
    ) {
      issues.push(issue('P4_ACCEPTED_EVIDENCE_INCOMPLETE', 'error', '接受学生证据时必须同时记录 observation 和 evidenceCitations'));
    }
    const unseenNumbers = unseenNumericTokens(text, context.visibleContext);
    if (unseenNumbers.length > 0) {
      issues.push(issue('P4_UNSEEN_NUMBER', 'error', `回复包含可见数据中未出现的数字：${unseenNumbers.join('、')}`, text));
    }
    if (response.next_action_type === 'confirmation' || response.phase_complete) {
      issues.push(issue('P4_COMPLETION_SIGNAL_INVALID', 'error', '阶段4由分析面板按钮推进，不使用 completion/confirmation'));
    }
  }

  if (phase === 5) {
    if (context.triggerType === 'REPORT_BOOTSTRAP' && !response.report_sections) {
      issues.push(issue('P5_REPORT_SECTIONS_MISSING', 'error', '报告初始化必须输出 report_sections'));
    }
    if (/完整报告已经|已经帮你写好|已经替你|可直接提交/.test(text)) {
      issues.push(issue('P5_OVERHELPED_REPORT', 'error', '不能把报告框架描述成可直接提交的完整报告', text));
    }
    if (response.report_sections && Object.values(response.report_sections).some((value) => !value.trim())) {
      issues.push(issue('P5_REPORT_SECTIONS_INCOMPLETE', 'error', 'report_sections 的六个预填字段都必须非空；缺失信息应显式标注待补充'));
    }
    if (response.report_sections && /结论是|证明了|由此可见|因此可以确定/.test(response.report_sections.analysis)) {
      issues.push(issue('P5_ANALYSIS_CONCLUSION_LEAK', 'error', 'analysis 不能代写学生最终结论', response.report_sections.analysis));
    }
    const unseenNumbers = unseenNumericTokens(text, context.visibleContext);
    if (unseenNumbers.length > 0) {
      issues.push(issue('P5_UNSEEN_NUMBER', 'warning', `报告框架包含前序摘要中未出现的数字：${unseenNumbers.join('、')}`, text));
    }
  }

  if (phase === 6) {
    if (response.next_action_type === 'confirmation' || response.phase_complete) {
      issues.push(issue('P6_COMPLETION_SIGNAL_INVALID', 'error', '阶段6最终完成只能由学生在反思面板提交'));
    }
    const questionCount = (text.match(/[？?]/g) ?? []).length;
    if (questionCount > 2) {
      issues.push(issue('P6_TOO_MANY_QUESTIONS', 'warning', '阶段6每轮只应聚焦一个反思任务', text));
    }
  }

  return issues;
}
