import type { ChatResponse } from '@/app/models/types';
import { planUnit } from '@/app/lib/stageArtifacts';
import { STAGE_CONTRACT_VERSION } from '@/app/lib/contractVersions';

export { STAGE_CONTRACT_VERSION } from '@/app/lib/contractVersions';

export type StageTriggerType =
  | 'USER_MESSAGE'
  | 'STAGE_ENTER'
  | 'STAGE_TRANSITION'
  | 'TEACHER_APPROVAL'
  | 'REPORT_BOOTSTRAP'
  | 'OPTIONAL_COACHING'
  | 'FINAL_SUBMISSION';

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
      '理解学生原始兴趣；机制、困难、约束和课堂代理只作为可选背景',
      '引导学生形成具体研究问题',
      '让学生明确核对并确认当前研究问题',
    ],
    forbid: [
      '正式确定自变量水平、梯度或实验组别',
      '确定因变量测量指标、操作定义或计算公式',
      '逐项确定控制变量、材料、步骤、重复次数或数据表',
      '提供隐藏式课题或指标选项替学生决定',
      '阶段确认后继续生成额外确认轮',
    ],
    completion: '只需规范研究问题和学生明确确认；确认绑定问题哈希，由服务器生成 snapshot。不要要求任何阶段2字段。',
  },
  2: {
    phase: 2,
    label: '方案设计',
    allow: [
      '正式确定自变量及水平、因变量及测量方式、控制变量',
      '确定材料、步骤、重复次数和安全方案',
      '信息完整后由服务器组装带 draftHash 的方案预览',
      '学生核对当前 draftHash 后冻结方案，由平台确定性生成 data_table_schema 和风险',
      '让数据表直接服务于后续比较和图表分析',
    ],
    forbid: [
      '重新替学生选择研究主题',
      '信息不足时一次性代写完整方案',
      '提前讨论实验结果、趋势、结论或报告',
      '输出重复列 key、长表组别结构或与方案不一致的数据表',
      '把聊天中的口头同意当作方案冻结，或接受过期 draftHash',
    ],
    completion: '所有方案事实完整后使用 checkpoint 展示服务器草案；专用确认端点冻结同一 draftHash 并生成数据表。',
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
      '保留 conclusion 和实验局限/讨论给学生填写',
    ],
    forbid: [
      '引用模型可见上下文中不存在的材料、步骤或数值',
      '使用通用 A/B/C 模板数据填充报告',
      '直接代写最终结论和实验局限讨论',
      '将占位内容描述为已经完成的完整报告',
    ],
    completion: 'REPORT_BOOTSTRAP 触发时输出 report_sections；提交由报告面板按钮完成。',
  },
  6: {
    phase: 6,
    label: '结果反思',
    allow: [
      '显示教师分数与反馈，引导学生先回应反馈，再反思学习过程',
      '引导学生自己识别误差、提出改进和限定迁移范围',
      '作为 Stage6Panel 最终学生反思的可选辅导',
    ],
    forbid: [
      '直接给出完整误差分析、改进方案或迁移答案',
      '一轮堆叠多个反思任务',
      '引入与本次研究无关的新实验或复杂工程任务',
      '使用 confirmation 或 phase_complete 代替学生提交',
    ],
    completion: '学生填写对教师反馈的回应和学习反思后，只由 Stage6Panel 提交完成。',
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

export interface VisibleFacts {
  triggerType: StageTriggerType;
  sourceText: string;
  businessText: string;
  studentText: string;
  currentStudentMessage: string;
  numericTokens: string[];
  studentNumericTokens: string[];
  dataNumericTokens: string[];
  confirmedFacts: string[];
  confirmedFactIds: string[];
  hasDataRows: boolean;
}

function issue(code: string, severity: StageContractIssueSeverity, message: string, evidence?: string): StageContractIssue {
  return { code, severity, message, evidence };
}

function parseJsonValue(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function flattenVisibleValue(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    const parsed = parseJsonValue(value);
    return parsed === value ? [value] : flattenVisibleValue(parsed);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenVisibleValue);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => [key, ...flattenVisibleValue(item)]);
  }
  return [];
}

function dataValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const parsed = parseJsonValue(value);
    return parsed === value ? [] : dataValues(parsed);
  }
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(dataValues);
  const object = value as Record<string, unknown>;
  return Object.entries(object).flatMap(([key, item]) => {
    if (/^(?:dataRows|realRows|rows)$/i.test(key)) return flattenVisibleValue(item);
    return dataValues(item);
  });
}

function containsDataRows(value: unknown): boolean {
  if (typeof value === 'string') {
    const parsed = parseJsonValue(value);
    return parsed === value ? false : containsDataRows(parsed);
  }
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsDataRows);
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => (
    /^(?:dataRows|realRows|rows)$/i.test(key) && Array.isArray(item) && item.length > 0
  ) || containsDataRows(item));
}

function valuesForKeys(value: unknown, keys: RegExp): string[] {
  if (typeof value === 'string') {
    const parsed = parseJsonValue(value);
    return parsed === value ? [] : valuesForKeys(parsed, keys);
  }
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item) => valuesForKeys(item, keys));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [
    ...(keys.test(key) ? flattenVisibleValue(item) : []),
    ...valuesForKeys(item, keys),
  ]);
}

function derivedVisibleValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const parsed = parseJsonValue(value);
    return parsed === value ? [] : derivedVisibleValues(parsed);
  }
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(derivedVisibleValues);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const derived: string[] = [];
    if (/^(?:dataRows|realRows|rows)$/i.test(key) && Array.isArray(item)) {
      derived.push(String(item.length), ...item.map((_, index) => String(index + 1)));
    }
    if (/^(?:approvedPlan|experimentPlan|experiment_plan)$/i.test(key) && item && typeof item === 'object') {
      const plan = item as Record<string, unknown>;
      const independent = plan.independentVariable as Record<string, unknown> | undefined;
      const levels = independent?.levels;
      if (Array.isArray(levels)) derived.push(String(levels.length));
      const procedure = plan.procedure;
      if (Array.isArray(procedure)) derived.push(String(procedure.length), ...procedure.map((_, index) => String(index + 1)));
      if (typeof plan.repeatCount === 'number') {
        derived.push(String(plan.repeatCount));
        if (Array.isArray(levels)) derived.push(String(plan.repeatCount * levels.length));
      }
    }
    return [...derived, ...derivedVisibleValues(item)];
  });
}

/** Build the only facts that runtime and dataset gates may trust. */
export function buildVisibleFacts(context: StageContractValidationContext = {}): VisibleFacts {
  const triggerType = context.triggerType ?? 'USER_MESSAGE';
  const parsed = context.visibleContext?.trim() ? parseJsonValue(context.visibleContext) : {};
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : { businessContext: parsed };
  const businessValue = Object.prototype.hasOwnProperty.call(root, 'businessContext')
    ? root.businessContext
    : Object.prototype.hasOwnProperty.call(root, 'tutorVisible')
      ? root.tutorVisible
      : root;
  const currentStudentMessage = typeof root.currentStudentMessage === 'string'
    ? root.currentStudentMessage
    : Array.isArray(root.studentMessages)
      ? String(root.studentMessages.at(-1) ?? '')
      : '';
  const priorStudentMessages = Array.isArray(root.priorStudentMessages)
    ? root.priorStudentMessages.map(String)
    : Array.isArray(root.studentMessages)
      ? root.studentMessages.slice(0, -1).map(String)
      : [];
  const businessText = flattenVisibleValue(businessValue).join('\n');
  const studentText = [...priorStudentMessages, currentStudentMessage].filter(Boolean).join('\n');
  const sourceText = [businessText, studentText].filter(Boolean).join('\n');
  const dataText = dataValues(businessValue).join('\n');
  const confirmedFacts = valuesForKeys(root, /^confirmedFacts$/i);
  const confirmedFactIds = valuesForKeys(root, /^confirmedFactIds$/i);
  const derivedText = derivedVisibleValues(businessValue).join('\n');
  return {
    triggerType,
    sourceText,
    businessText,
    studentText,
    currentStudentMessage,
    numericTokens: [...numericTokens([sourceText, derivedText].filter(Boolean).join('\n'))],
    studentNumericTokens: [...numericTokens(currentStudentMessage)],
    dataNumericTokens: [...numericTokens(dataText)],
    confirmedFacts,
    confirmedFactIds,
    hasDataRows: containsDataRows(businessValue),
  };
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

function normalizeGroundingText(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function canonicalUnit(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll('°c', '℃');
  const aliases: Record<string, string> = {
    毫米: 'mm', mm: 'mm', 厘米: 'cm', cm: 'cm', 米: 'm', m: 'm',
    毫升: 'ml', ml: 'ml', 升: 'l', l: 'l', 克: 'g', g: 'g', 千克: 'kg', kg: 'kg',
    摄氏度: '℃', '℃': '℃', 秒: 's', s: 's', 分钟: 'min', min: 'min', 小时: 'h', h: 'h',
    百分比: '%', '%': '%', 个: '个', 次: '次', 株: '株', 粒: '粒', 颗: '颗', 天: '天',
  };
  return aliases[normalized] ?? normalized;
}

function sourceContainsUnit(unit: string, source: string): boolean {
  if (normalizeGroundingText(source).includes(normalizeGroundingText(unit))) return true;
  const target = canonicalUnit(unit);
  const found = source.match(/毫米|厘米|毫升|千克|摄氏度|百分比|mm|cm|ml|kg|℃|°c|%|分钟|小时|秒|米|升|克|个|次|株|粒|颗|天/gi) ?? [];
  return found.some((item) => canonicalUnit(item) === target);
}

function phraseBigrams(value: string): string[] {
  const normalized = normalizeGroundingText(value);
  if (normalized.length < 2) return normalized ? [normalized] : [];
  return Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2));
}

function phraseIsGrounded(value: string, source: string): boolean {
  const normalizedValue = normalizeGroundingText(value);
  const normalizedSource = normalizeGroundingText(source);
  if (!normalizedValue) return true;
  if (normalizedSource.includes(normalizedValue)) return true;
  const bigrams = phraseBigrams(value);
  if (bigrams.length === 0) return false;
  const matched = bigrams.filter((item) => normalizedSource.includes(item)).length;
  return matched / bigrams.length >= 0.6;
}

const SAFETY_CRITICAL_TERMS = [
  '强酸', '强碱', '浓硫酸', '盐酸', '酒精灯', '明火', '蜡烛', '220V', '市电', '高压电',
  '有毒', '解剖', '加热器', '注射器',
] as const;

function unseenSafetyCriticalTerms(text: string, source: string): string[] {
  return SAFETY_CRITICAL_TERMS.filter((term) => text.includes(term) && !source.includes(term));
}

function ungroundedPlanItems(response: ChatResponse, facts: VisibleFacts): string[] {
  if (!response.experiment_plan) return [];
  const plan = response.experiment_plan;
  const values = [
    plan.researchQuestion,
    plan.hypothesis,
    plan.independentVariable.name,
    ...plan.independentVariable.levels,
    plan.dependentVariable.name,
    plan.dependentVariable.measurement,
    plan.dependentVariable.unit,
    ...plan.controlledVariables,
    ...plan.materials,
    ...plan.procedure,
    ...plan.safetyNotes,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return values.filter((value) => !phraseIsGrounded(value, facts.sourceText));
}

function schemaPlanMismatches(response: ChatResponse): string[] {
  if (!response.experiment_plan || !response.data_table_schema) return [];
  const plan = response.experiment_plan;
  const resultColumns = response.data_table_schema.columns.filter((column) => (
    column.key !== 'notes'
    && column.type === 'number'
    && !/^(?:day|date|time|trial|repeat|repeat_index|index|row|sample_id)$/i.test(column.key)
    && !/(?:天数|日期|时间|轮次|重复序号|序号|编号)$/.test(column.title.trim())
  ));
  const titles = resultColumns.map((column) => column.title).join('\n');
  const mismatches: string[] = [];
  for (const level of plan.independentVariable.levels) {
    if (!normalizeGroundingText(titles).includes(normalizeGroundingText(level))) mismatches.push(`缺少水平列：${level}`);
  }
  if (
    resultColumns.length > 0
    && !titles.includes(plan.dependentVariable.name)
    && !phraseIsGrounded(plan.dependentVariable.measurement, titles)
  ) {
    mismatches.push(`数值列未体现因变量：${plan.dependentVariable.name}`);
  }
  const measurementUnit = planUnit(plan);
  if (measurementUnit && !titles.toLowerCase().includes(measurementUnit.toLowerCase())) {
    mismatches.push(`数值列缺少单位：${measurementUnit}`);
  }
  if (response.data_table_schema.minRows < plan.repeatCount) {
    mismatches.push(`minRows ${response.data_table_schema.minRows} 小于重复次数 ${plan.repeatCount}`);
  }
  return mismatches;
}

function questionCount(value: string): number {
  return (value.match(/[？?]/g) ?? []).length;
}

function hasAffirmativeMatch(value: string, pattern: RegExp): boolean {
  const flags = pattern.flags.replaceAll('g', '');
  const matcher = new RegExp(pattern.source, flags);
  return value
    .split(/[。！？!?；;，,\n]/)
    .some((segment) => {
      const match = matcher.exec(segment);
      if (!match || match.index === undefined) return false;
      const prefix = segment.slice(Math.max(0, match.index - 14), match.index);
      return !/(?:不能|不可|不要|不应|不宜|尚未|还没|没有|未能|避免|禁止|不代表|并非|不是)/.test(prefix);
    });
}

function groundedEvidenceCitationCount(response: ChatResponse, facts: VisibleFacts): number {
  const unique = new Set<string>();
  for (const citation of response.analysis_progress?.evidenceCitations ?? []) {
    const normalized = normalizeGroundingText(citation);
    const numbers = [...numericTokens(citation)];
    if (!normalized || numbers.length === 0) continue;
    if (!numbers.every((token) => facts.studentNumericTokens.includes(token) && facts.dataNumericTokens.includes(token))) continue;
    const hasPosition = /(?:第?\d+\s*(?:行|列|次|天|轮)|[A-Za-z甲乙丙丁一二三四五六七八九\d]+\s*组|[^,，;；\s]{1,12}(?:条件|处理|样本))/.test(citation);
    if (hasPosition || phraseIsGrounded(citation, facts.currentStudentMessage)) unique.add(normalized);
  }
  return unique.size;
}

function unseenPossibleEquipment(text: string, source: string): string[] {
  const terms = new Set<string>();
  for (const match of text.matchAll(/(?:使用|改用|换成|增加|新增|再用|用)\s*([\p{Script=Han}A-Za-z0-9-]{2,12}?(?:刀|灯|炉|枪|针|锯|电源|插座|电机|泵|风扇|仪|计|尺))/gu)) {
    const term = match[1];
    const prefix = text.slice(Math.max(0, (match.index ?? 0) - 10), match.index ?? 0);
    if (/(?:不要|不能|不可|避免|禁止)/.test(prefix)) continue;
    if (source.includes(term) || SAFETY_CRITICAL_TERMS.some((critical) => term.includes(critical))) continue;
    terms.add(term);
  }
  return [...terms];
}

export function validateStageResponseBehavior(
  phase: number,
  response: ChatResponse,
  context: StageContractValidationContext = {},
): StageContractIssue[] {
  const issues: StageContractIssue[] = [];
  const text = responseText(response);
  const facts = buildVisibleFacts(context);

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
    if (
      /三选一|二选一|你更想.{0,30}还是|比如.{0,30}(?:、|还是).{0,30}(?:、|还是)/.test(text)
      || /(?:是|例如|比如|考虑)?[^。！？\n]{0,36}[、，][^。！？\n]{0,36}(?:还是|或者)[^。！？\n]{1,36}/.test(text)
      || /(?:A|Ａ)[、.]?[^。！？\n]{1,20}(?:B|Ｂ)[、.]?[^。！？\n]{1,20}(?:C|Ｃ)/i.test(text)
    ) {
      issues.push(issue('P1_HIDDEN_CHOICE', 'error', '阶段1不能使用隐藏式选项替学生决定方向', text));
    }
    if (questionCount(response.dialogue) > 1) {
      issues.push(issue('P1_MULTI_QUESTION_REVIEW', 'warning', '本轮出现多个问号；请人工确认它们是否服务于同一个核心教学任务', response.dialogue));
    }
    if (/自变量|因变量|拟改变.{0,6}因素|关注.{0,6}现象/.test(activeStage1Text)) {
      issues.push(issue('P1_VARIABLE_LANGUAGE', 'error', '阶段1只形成研究问题，不要求机制、变量方向或操作化字段', text));
    }
    if (response.stage1_confirmed) {
      if (!response.snapshot?.trim() || !/研究问题\s*[:：]/.test(response.snapshot)) {
        issues.push(issue('P1_CONFIRMATION_ARTIFACT_MISSING', 'error', '阶段1确认必须包含服务器生成的研究问题 snapshot'));
      }
      if (response.next_action_type !== 'confirmation') {
        issues.push(issue('P1_CONFIRMATION_ACTION_INVALID', 'error', '阶段1确认回复必须使用 confirmation'));
      }
      if (response.variables?.dependent?.trim() || (response.variables?.controlled?.length ?? 0) > 0) {
        issues.push(issue('P1_VARIABLE_OPERATIONALIZATION', 'error', '阶段1确认不能写入因变量操作化或控制变量'));
      }
      if (response.topic_direction?.factor?.trim() || response.topic_direction?.phenomenon?.trim()) {
        issues.push(issue('P1_TOPIC_DIRECTION_FORBIDDEN', 'error', '阶段1确认不再要求 factor/phenomenon；它们属于阶段2'));
      }
    }
  }

  if (phase === 2) {
    if (context.triggerType === 'STAGE_TRANSITION' && (response.experiment_plan || response.data_table_schema)) {
      issues.push(issue('P2_TRANSITION_OVERCOMPLETION', 'error', '刚进入方案设计时只推进第一个方案缺口，不能立即代写完整方案或数据表'));
    }
    if (hasAffirmativeMatch(text, /数据显示|结果表明|可以看出|证明了|支持.{0,8}假设|得出结论|最终结论/)) {
      issues.push(issue('P2_PREMATURE_RESULT', 'error', '方案设计阶段不能提前分析结果或得出结论', text));
    }
    if (response.data_table_schema) {
      if (!response.experiment_plan) {
        issues.push(issue('P2_PLAN_MISSING', 'error', '生成数据表时必须同时输出结构化 experiment_plan'));
      } else if (
        !response.experiment_plan.hypothesis?.trim() ||
        !response.experiment_plan.independentVariable.name.trim() ||
        response.experiment_plan.independentVariable.levels.length < 2 ||
        !response.experiment_plan.dependentVariable.name.trim() ||
        !response.experiment_plan.dependentVariable.measurement.trim() ||
        !Array.isArray(response.experiment_plan.controlledVariables) ||
        response.experiment_plan.materials.length === 0 ||
        response.experiment_plan.procedure.length === 0 ||
        !Number.isInteger(response.experiment_plan.repeatCount) ||
        response.experiment_plan.repeatCount < 1 ||
        !Array.isArray(response.experiment_plan.safetyNotes)
      ) {
        issues.push(issue('P2_PLAN_INCOMPLETE', 'error', 'experiment_plan 必须包含假设、变量名、至少两个水平、测量、已回答的控制/安全项、材料、步骤和重复次数'));
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
      const resultColumns = response.data_table_schema.columns.filter((column) => (
        column.type === 'number'
        && !/^(?:day|date|time|trial|repeat|repeat_index|index|row|sample_id)$/i.test(column.key)
        && !/(?:天数|日期|时间|轮次|重复序号|序号|编号)$/.test(column.title.trim())
      ));
      if (resultColumns.length === 0) {
        issues.push(issue('P2_NUMERIC_RESULT_COLUMN_MISSING', 'error', '索引列不能冒充实验结果；数据表必须包含与因变量对应的 number 数值列'));
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
    const suggestionText = [response.dialogue, ...(response.hints ?? [])]
      .join('\n')
      .replace(/(^|[\n；;：:])\s*\d+\s*[.、)]\s*/g, '$1');
    const unseenSuggestionNumbers = [...numericTokens(suggestionText)]
      .filter((token) => !facts.numericTokens.includes(token));
    if (unseenSuggestionNumbers.length > 0) {
      issues.push(issue('P2_UNGROUNDED_SUGGESTION_NUMBER', 'error', `导师引导中出现学生或前序状态未提供的候选数字：${unseenSuggestionNumbers.join('、')}`));
    }
    if (response.experiment_plan) {
      const measurementUnit = planUnit(response.experiment_plan);
      if (!measurementUnit) {
        issues.push(issue('P2_UNIT_MISSING', 'error', 'experiment_plan 必须明确因变量单位，且该单位必须来自学生确认或测量定义'));
      } else if (!sourceContainsUnit(measurementUnit, facts.sourceText)) {
        issues.push(issue('P2_UNGROUNDED_PLAN_UNIT', 'error', `实验方案使用了学生或前序状态未确认的单位：${measurementUnit}`));
      }
      const unseenPlanNumbers = [...numericTokens(JSON.stringify(response.experiment_plan))]
        .filter((token) => !facts.numericTokens.includes(token));
      if (unseenPlanNumbers.length > 0) {
        issues.push(issue(
          'P2_UNGROUNDED_PLAN_NUMBER',
          'error',
          `实验方案包含学生或前序状态未确认的数字：${unseenPlanNumbers.join('、')}`,
          JSON.stringify(response.experiment_plan),
        ));
      }
      const ungroundedItems = ungroundedPlanItems(response, facts);
      if (ungroundedItems.length > 0) {
        issues.push(issue(
          'P2_POSSIBLE_UNGROUNDED_PLAN_ITEM',
          'warning',
          `方案内容无法通过确定性文本匹配完整追溯，可能只是同义改写，需人工复核：${ungroundedItems.join('；')}`,
          JSON.stringify(response.experiment_plan),
        ));
      }
      if (response.experiment_plan.independentVariable.levels.some((level) => /^(?:较低|中等|较高|低|中|高)(?:水平|条件|实验条件)?$/.test(level.trim()))) {
        issues.push(issue('P2_GENERIC_LEVELS_FORBIDDEN', 'error', '已有具体主题时不能使用“较低/中等/较高”等通用水平名'));
      }
    }
    const schemaMismatches = schemaPlanMismatches(response);
    if (schemaMismatches.length > 0) {
      issues.push(issue('P2_SCHEMA_PLAN_MISMATCH', 'error', `数据表与方案不一致：${schemaMismatches.join('；')}`));
    }
  }

  if (phase === 3) {
    if (context.triggerType === 'STAGE_ENTER' && !response.safety_quiz) {
      issues.push(issue('P3_SAFETY_QUIZ_MISSING', 'error', '首次进入过程执行阶段必须输出 safety_quiz'));
    }
    if (hasAffirmativeMatch(text, /数据显示|结果表明|变化趋势|可以看出|得出结论|证明了/)) {
      issues.push(issue('P3_ANALYSIS_OVERREACH', 'error', '过程执行阶段不能提前分析数据或得出结论', text));
    }
    if (hasAffirmativeMatch(text, /改用.{0,20}研究|增加.{0,10}(?:组|条件)|新增.{0,10}(?:组|条件)|换一个实验/)) {
      issues.push(issue('P3_CORE_PLAN_CHANGE', 'error', '过程执行阶段不能未经审核改变核心方案', text));
    }
    const unseenNumbers = [...numericTokens(text)].filter((token) => !facts.numericTokens.includes(token));
    if (unseenNumbers.length > 0) {
      issues.push(issue('P3_UNGROUNDED_PARAMETER', 'error', `回复包含方案上下文中未出现的具体数字：${unseenNumbers.join('、')}`, text));
    }
    const unseenCriticalItems = unseenSafetyCriticalTerms(text, facts.sourceText);
    if (unseenCriticalItems.length > 0) {
      issues.push(issue('P3_UNAPPROVED_SAFETY_CRITICAL_ITEM', 'error', `回复新增了已审核方案中没有的高风险材料、设备或操作：${unseenCriticalItems.join('、')}`, text));
    }
    const possibleEquipment = unseenPossibleEquipment(text, facts.sourceText);
    if (possibleEquipment.length > 0) {
      issues.push(issue('P3_UNAPPROVED_EQUIPMENT_REVIEW', 'warning', `回复提到已审核方案中未找到的新设备或工具，风险无法由确定性规则判断：${possibleEquipment.join('、')}`, text));
    }
    if (response.safety_quiz) {
      const quizText = [response.safety_quiz.question, ...response.safety_quiz.options].join('\n');
      const quizTerms = unseenSafetyCriticalTerms(quizText, facts.businessText);
      if (quizTerms.length > 0) {
        issues.push(issue('P3_SAFETY_QUIZ_UNGROUNDED', 'error', `安全题引用了已审核风险中没有的高风险对象：${quizTerms.join('、')}`, quizText));
      }
    }
    const invalidRefs = (response.grounding_refs ?? []).filter((ref) => {
      if (facts.confirmedFactIds.includes(ref)) return false;
      const normalized = normalizeGroundingText(ref);
      return !normalized || !normalizeGroundingText(facts.sourceText).includes(normalized);
    });
    if (invalidRefs.length > 0) {
      issues.push(issue('GROUNDING_REF_INVALID', 'error', `grounding_refs 含有不存在的事实引用：${invalidRefs.join('、')}`));
    }
    if ((response.grounding_refs?.length ?? 0) === 0 && /记录|测量|操作|检查|保持|使用/.test(response.dialogue)) {
      issues.push(issue('P3_GROUNDING_REFS_MISSING', 'warning', '包含具体操作指导时应通过 grounding_refs 标明所依据的已审核事实'));
    }
    if (response.next_action_type === 'confirmation' || response.phase_complete) {
      issues.push(issue('P3_COMPLETION_SIGNAL_INVALID', 'error', '阶段3由数据表按钮推进，不使用 completion/confirmation'));
    }
  }

  if (phase === 4) {
    if (context.triggerType === 'STAGE_TRANSITION' && !facts.hasDataRows) {
      issues.push(issue('P4_TRANSITION_NOT_GROUNDED', 'error', '阶段4主动开场必须由真实 dataRows 触发，不能只靠正文提到“数据”'));
    }
    if (hasAffirmativeMatch(text, /证明了|因此可以确定|说明.{0,12}导致|必然导致|一定是因为/)) {
      issues.push(issue('P4_CAUSAL_OVERCLAIM', 'error', '阶段4不能把相关性表述成确定因果', text));
    }
    const givesDirectConclusion = hasAffirmativeMatch(text, /结论是|最终结论|由此可见|数据显示.{0,30}(?:所以|因此)/);
    if (givesDirectConclusion) {
      issues.push(issue('P4_DIRECT_CONCLUSION', 'error', '阶段4不能替学生直接给出最终结论', text));
    } else if (hasAffirmativeMatch(text, /可以(?:得到|得出)(?:的)?结论|可见(?:整体|总体)?|这表明/)) {
      issues.push(issue('P4_POSSIBLE_DIRECT_CONCLUSION', 'warning', '回复可能已经替学生给出结论，确定性关键词无法判断语境，需人工复核', text));
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
    if (response.analysis_progress?.studentEvidenceAccepted) {
      const citedDataValues = facts.studentNumericTokens.filter((token) => facts.dataNumericTokens.includes(token));
      if (groundedEvidenceCitationCount(response, facts) < 2 && new Set(citedDataValues).size < 2) {
        issues.push(issue('P4_STUDENT_EVIDENCE_TOO_THIN', 'error', '接受分析进度前，本轮学生必须引用至少两个可追溯数据位置；两个位置的数值可以相同', facts.currentStudentMessage));
      }
      const progress = response.analysis_progress;
      for (const value of [progress.observation, progress.interpretation, progress.anomalyNoted].filter((item): item is string => !!item?.trim())) {
        if (!phraseIsGrounded(value, facts.currentStudentMessage)) {
          issues.push(issue('P4_PROGRESS_PARAPHRASE_REVIEW', 'warning', 'analysis_progress 与学生原话的语义等价性无法由确定性文本规则确认，需人工复核', value));
        }
      }
    }
    const unseenNumbers = [...numericTokens(text)].filter((token) => !facts.numericTokens.includes(token));
    if (unseenNumbers.length > 0) {
      issues.push(issue('P4_UNSEEN_NUMBER', 'error', `回复包含可见数据中未出现的数字：${unseenNumbers.join('、')}`, text));
    }
    if (/随着.{0,18}(?:增加|升高|延长).{0,24}(?:增加|升高|下降|减少).{0,18}(?:所以|说明|表明)/.test(response.dialogue)) {
      issues.push(issue('P4_COMPLETE_ANALYSIS_OVERREACH', 'error', '导师不能在一轮中替学生完成完整趋势与结论', response.dialogue));
    }
    if (response.next_action_type === 'confirmation' || response.phase_complete) {
      issues.push(issue('P4_COMPLETION_SIGNAL_INVALID', 'error', '阶段4由分析面板按钮推进，不使用 completion/confirmation'));
    }
  }

  if (phase === 5) {
    if (context.triggerType === 'REPORT_BOOTSTRAP' && !response.report_sections) {
      issues.push(issue('P5_REPORT_SECTIONS_MISSING', 'error', '报告初始化必须输出 report_sections'));
    }
    if (hasAffirmativeMatch(text, /完整报告已经|已经帮你写好|已经替你|可(?:以)?直接提交/)) {
      issues.push(issue('P5_OVERHELPED_REPORT', 'error', '不能把报告框架描述成可直接提交的完整报告', text));
    }
    if (response.report_sections && Object.values(response.report_sections).some((value) => !value.trim())) {
      issues.push(issue('P5_REPORT_SECTIONS_INCOMPLETE', 'error', 'report_sections 的六个预填字段都必须非空；缺失信息应显式标注待补充'));
    }
    if (response.report_sections && hasAffirmativeMatch(response.report_sections.analysis, /结论是|证明了|由此可见|因此可以确定/)) {
      issues.push(issue('P5_ANALYSIS_CONCLUSION_LEAK', 'error', 'analysis 不能代写学生最终结论', response.report_sections.analysis));
    }
    const unseenNumbers = [...numericTokens(text)].filter((token) => !facts.numericTokens.includes(token));
    if (unseenNumbers.length > 0) {
      issues.push(issue('P5_UNSEEN_NUMBER', 'error', `报告框架包含前序摘要中未出现的数字：${unseenNumbers.join('、')}`, text));
    }
    if (context.triggerType !== 'REPORT_BOOTSTRAP' && response.next_action_type !== 'text_input') {
      issues.push(issue('P5_FOLLOWUP_ACTION_INVALID', 'error', 'P5 报告核对轮必须使用 text_input；只有 REPORT_BOOTSTRAP 结构交付轮使用 info'));
    }
    if (response.report_sections && response.artifact_provenance?.report_sections !== 'server_composed') {
      for (const [field, value] of Object.entries({
        purpose: response.report_sections.purpose,
        hypothesis: response.report_sections.hypothesis,
        materials: response.report_sections.materials,
        procedure: response.report_sections.procedure,
      })) {
        if (!/待学生补充|信息缺失|尚未提供|未提供/.test(value) && !phraseIsGrounded(value, facts.businessText)) {
          issues.push(issue('P5_FIELD_SOURCE_REVIEW', 'warning', `P5 ${field} 字段无法由确定性文本匹配确认语义等价，需人工复核`, value));
        }
      }
      const unseenMaterials = unseenSafetyCriticalTerms(
        [response.report_sections.materials, response.report_sections.procedure].join('\n'),
        facts.businessText,
      );
      if (unseenMaterials.length > 0) {
        issues.push(issue('P5_UNSEEN_SAFETY_CRITICAL_ITEM', 'error', `报告包含前序方案中不存在的高风险材料、设备或操作：${unseenMaterials.join('、')}`));
      }
      if (
        /上升|下降|增加|减少|平台|异常|相关|因果|趋势/.test(response.report_sections.analysis)
        && !phraseIsGrounded(response.report_sections.analysis, facts.businessText)
      ) {
        issues.push(issue('P5_ANALYSIS_SOURCE_REVIEW', 'warning', 'P5 analysis 与 P4 已接受内容的语义等价性无法由确定性文本规则确认，需人工复核', response.report_sections.analysis));
      }
    }
  }

  if (phase === 6) {
    if (response.next_action_type === 'confirmation' || response.phase_complete) {
      issues.push(issue('P6_COMPLETION_SIGNAL_INVALID', 'error', '阶段6最终完成只能由学生在反思面板提交'));
    }
    if (context.triggerType === 'FINAL_SUBMISSION') {
      issues.push(issue('P6_FINAL_SUBMISSION_MUST_BYPASS_LLM', 'error', '最终反思表单应直接提交，不能作为导师聊天触发'));
    }
    if (questionCount(response.dialogue) > 1) {
      issues.push(issue('P6_MULTI_QUESTION_REVIEW', 'warning', '本轮出现多个问号；请人工确认它们是否服务于同一个核心反思任务', response.dialogue));
    }
    if (/你应该|改进方案是|原因就是|下一次可以直接|再做一个.{0,20}实验|增加.{0,12}(?:材料|设备|实验)/.test(response.dialogue)) {
      issues.push(issue('P6_DIRECT_REFLECTION_OR_NEW_EXPERIMENT', 'error', '阶段6不能替学生给出原因、改进方案或新增实验', response.dialogue));
    }
  }

  return issues;
}
