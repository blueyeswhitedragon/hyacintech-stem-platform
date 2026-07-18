export interface LabelMeta {
  label: string;
  help?: string;
  unit?: string;
}

export const DATA_LAB_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  READY: '待生成',
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  IN_REVIEW: '初审中',
  AWAITING_CONFIRMATION: '待定稿',
  SUBMITTED: '已提交',
  RETURNED: '已退回',
  REGEN_REQUESTED: '等待重新生成',
  NEEDS_REGEN: '需要重新生成',
  NEEDS_CRITIC: '等待补齐交叉检查',
  BLOCKED: '被自动检查阻断',
  FINALIZED: '已定稿',
  APPROVED: '已批准',
  SUPERSEDED: '已被新版替代',
  REJECTED: '已拒绝',
  CASE_REJECTED: '案例已淘汰',
  NOMINATED: '待审核候选',
  FROZEN: '已冻结',
  ACTIVE: '进行中',
  PAUSED: '已暂停',
  ARCHIVED: '已归档',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  IMPORTED: '已导入',
  FAILED: '失败',
  RUNNING: '外部训练中',
  SUCCEEDED: '外部训练已完成',
  PARTIAL_FAILED: '部分失败',
  ELIGIBLE: '具备部署资格',
  TRAINED: '已完成训练',
  EVALUATED: '已完成评测',
  DEPLOYED: '已部署',
  RETIRED: '已停用',
  NOT_EVALUATED: '尚未评测',
  PASS: '通过',
  FAIL: '未通过',
  NEW: '待进一步判断',
  SHORTLISTED: '首轮入选',
  COMPILED: '已生成话题卡',
  INVALID: '无效',
};

export const TUTOR_SPLIT_LABELS: Record<string, string> = {
  TRAIN: '正式训练集',
  PILOT: '试运行集',
  EVAL: '独立评测集',
};

export const TRIGGER_TYPE_LABELS: Record<string, string> = {
  USER_MESSAGE: '学生发言触发',
  SYSTEM_TRIGGER: '平台状态触发',
};

export const REVIEW_POLICY_LABELS: Record<string, string> = {
  HUMAN_ANNOTATOR_REQUIRED: '必须由标注员初审',
  AI_DIRECT_TO_REVIEWER: '管理员授权 AI 初审后直送定稿人',
};

export const SUBMISSION_MODE_LABELS: Record<string, string> = {
  HUMAN: '标注员独立完成',
  AI_ASSISTED_HUMAN_SUBMIT: 'AI 辅助，标注员实质确认',
  AI_DIRECT_ADMIN_AUTHORIZED: '管理员授权 AI 初审直送',
};

export const TRAINING_ELIGIBILITY_LABELS: Record<string, string> = {
  SFT_ALLOWED: '可进入监督微调训练集',
  MONITORING_ONLY: '仅用于监测，不进入训练',
  BLOCKED: '不具备训练资格',
};

export const EDIT_TYPE_LABELS: Record<string, string> = {
  NO_CHANGE: '直接确认',
  LIGHT_EDIT: '轻量修改',
  MATERIAL_CORRECTION: '实质修改',
  UNKNOWN: '修改情况待确认',
};

export const REVIEW_DECISION_LABELS: Record<string, string> = {
  SELECT_A: '采用候选 A',
  SELECT_B: '采用候选 B',
  MERGE: '合并候选 A/B',
  EDIT: '人工编辑',
  CONFIRM: '通过并定稿',
  RETURN_TUTOR: '退回标注员修订导师回复',
  RETURN_CASE: '提交管理员处理学生案例',
  REGENERATE: '重新生成候选',
  REGRESSION: '转为回归测试案例',
  NEGATIVE: '转为负样本',
  REJECT: '拒绝，不进入训练',
};

export const TUTOR_CASE_ISSUE_LABELS = {
  UNNATURAL_STUDENT_MESSAGE: '学生表达不自然或过于模板化',
  KNOWLEDGE_STATE_CONTRADICTION: '学生已知和未知信息相互矛盾',
  DATA_PROMPT_MISMATCH: '学生问题与可见数据不匹配',
  PHASE_MISMATCH: '学生问题与当前阶段不匹配',
  INVALID_SCENARIO: '情景本身不合理或无法公平测试导师能力',
  LOW_DISCRIMINATION_VALUE: '案例区分导师能力的价值较低',
  OTHER: '其他案例质量问题',
} as const;

export const TOPIC_ACTIVITY_MODE_LABELS: Record<string, string> = {
  SCIENTIFIC_INQUIRY: '科学探究',
  ENGINEERING_DESIGN: '工程设计',
  HYBRID: '探究与工程混合',
};

export const TOPIC_CONTEXT_MODULE_LABELS: Record<string, string> = {
  LIFE_HEALTH: '生命健康',
  ENERGY_ENVIRONMENT: '能源环境',
  INTELLIGENT_INFORMATION: '智能信息',
  AEROSPACE: '航空航天',
  DEEP_EARTH_OCEAN: '深地深海',
};

export const TOPIC_DISCIPLINE_LABELS: Record<string, string> = {
  biology: '生物学',
  biology_ecology: '生命与生态',
  chemistry: '化学',
  physics: '物理学',
  earth_science: '地球科学',
  mathematics: '数学',
  information_technology: '信息科技',
  engineering: '工程技术',
  high_concept_interdisciplinary: '跨学科综合',
};

export const TOPIC_METRIC_KIND_LABELS: Record<string, string> = {
  COUNT: '数量',
  PERCENTAGE: '百分比',
  TIME: '时间',
  DISTANCE: '长度或距离',
  MASS: '质量',
  TEMPERATURE: '温度',
  OTHER: '其他可测指标',
};

export const TOPIC_RESOURCE_TYPE_LABELS: Record<string, string> = {
  UNCLASSIFIED: '尚未分类',
  STUDENT_INQUIRY_RESOURCE: '学生探究资源',
  STUDENT_ENGINEERING_RESOURCE: '学生工程项目资源',
  HYBRID_RESOURCE: '探究与工程混合资源',
  TEACHER_RESOURCE: '教师教学材料',
  SCIENCE_POPULARIZATION: '科普材料',
  INSUFFICIENT_SOURCE: '信息不足，暂不能使用',
};

export const TOPIC_SOURCE_STATUS_LABELS: Record<string, string> = {
  NEW: '待进一步判断',
  SHORTLISTED: '首轮入选',
  REJECTED: '首轮排除',
  COMPILED: '已有话题卡',
};

export const TUTOR_WARNING_CODE_LABELS: Record<string, string> = {
  CONTRACT_INVALID: '导师回复结构不完整',
  INTERNAL_LABEL_LEAK: '包含学生不应看到的内部标签',
  INTERNAL_SCHEMA_KEY: '包含内部数据字段名',
  HIDDEN_HINT_MENU: '提示形成了隐藏答案菜单',
  DIALOGUE_ANSWER_MENU: '正文可能直接给出了多个答案选项',
  DIALOGUE_HINT_DUPLICATE: '正文与补充提示重复',
  SYSTEM_TRIGGER_AS_STUDENT: '把平台触发误写成学生发言',
  P4_INTERNAL_KEY: '数据分析阶段引用了内部列名',
  MULTIPLE_QUESTION_MARKS: '正文包含多个问句',
  DIALOGUE_TOO_LONG: '导师正文偏长',
  GENERIC_PRAISE: '包含模板化表扬',
  grounding: '事实依据问题',
  pedagogy: '教学推进问题',
  safety: '安全边界问题',
  leakage: '内部信息泄漏',
  contract: '回复结构问题',
};

export const GATE_METRIC_META: Record<string, LabelMeta> = {
  total: { label: '已定稿案例数', unit: '条' },
  hardOrLeakErrors: { label: '硬错误或内部信息泄漏', help: '需为 0', unit: '处' },
  lightEditRate: { label: '无需大改比例', help: '试验集需不低于 75%', unit: '%' },
  directConfirmRate: { label: '直接确认率', help: '试验集需不低于 85%', unit: '%' },
  exactDuplicates: { label: '完全重复案例', help: '需为 0', unit: '条' },
  nearDuplicateRate: { label: '近重复率', help: '需低于 10%', unit: '%' },
  templateRepeatRate: { label: '模板化表达重复率', help: '需低于 10%', unit: '%' },
  materialCorrections: { label: '需要实质改写的案例', unit: '条' },
  totalWarnings: { label: '自动检测信号', unit: '条' },
  structuredClosureRate: { label: '信号结构化处理率', help: '需为 100%', unit: '%' },
  multiAxisClosureRate: { label: '多维复核完成率', unit: '%' },
  fixedWarnings: { label: '已通过编辑修复', unit: '条' },
  acceptableWarnings: { label: '人工确认可接受', unit: '条' },
  notApplicableWarnings: { label: '不适用于最终稿', unit: '条' },
  falsePositiveWarnings: { label: '自动检查误报', unit: '条' },
  validWarnings: { label: '人工确认成立', unit: '条' },
  partiallyValidWarnings: { label: '人工确认部分成立', unit: '条' },
  presentInFinalWarnings: { label: '最终稿仍存在的信号', unit: '条' },
  removedByEditWarnings: { label: '已由编辑去除的信号', unit: '条' },
  unselectedCandidateWarnings: { label: '仅存在于未采用候选', unit: '条' },
  blockingWarnings: { label: '严重阻断信号', unit: '条' },
  minorWarnings: { label: '轻微信号', unit: '条' },
  negligibleWarnings: { label: '影响可忽略的信号', unit: '条' },
  criticWarnings: { label: '交叉检查信号', unit: '条' },
  criticFalsePositiveRate: { label: '交叉检查误报率', help: '样本充分时需不高于 25%', unit: '%' },
};

export const GATE_FAILURE_LABELS: Record<string, string> = {
  HARD_OR_INTERNAL_LEAK_ERRORS: '仍有硬错误或内部信息泄漏',
  LIGHT_EDIT_RATE_BELOW_75_PERCENT: '无需大改比例低于 75%（超过 25% 的案例在定稿时被大幅重写，说明模型生成质量不足）',
  DIRECT_CONFIRM_RATE_BELOW_85_PERCENT: '直接确认率低于 85%（超过 15% 的案例在定稿时被退回过，需要返工后重新提交）',
  EXACT_DUPLICATES_PRESENT: '存在完全重复案例',
  NEAR_DUPLICATE_RATE_AT_OR_ABOVE_10_PERCENT: '近重复率达到或超过 10%',
  TEMPLATE_REPEAT_RATE_AT_OR_ABOVE_10_PERCENT: '模板化表达重复率达到或超过 10%',
  TRIAL_REQUIRES_36_CASES: '需要完成并定稿 36 条试验案例（创建案例 → 生成双候选 → 初审 → 定稿，全流程走完后统计）',
  SMOKE_REQUIRES_SIX_FINALIZED_CASES: '需要完成并定稿 6 条冒烟案例',
  SMOKE_REQUIRES_FOUR_LIGHT_OR_NO_EDIT: '至少 4 条冒烟案例应无需大改',
  SMOKE_REQUIRES_ALL_DIRECT_CONFIRM: '6 条冒烟案例均需一次通过定稿',
  SMOKE_MATERIAL_CORRECTIONS_ABOVE_TWO: '冒烟案例中实质改写超过 2 条',
  CALIBRATION_REQUIRES_TWELVE_FINALIZED_CASES: '需要完成并定稿 12 条校准案例',
  CALIBRATION_LIGHT_EDIT_RATE_BELOW_75_PERCENT: '校准案例无需大改比例低于 75%',
  CALIBRATION_DIRECT_CONFIRM_RATE_BELOW_90_PERCENT: '校准案例直接确认率低于 90%',
  CALIBRATION_MATERIAL_CORRECTIONS_ABOVE_THREE: '校准案例中实质改写超过 3 条',
  CALIBRATION_WARNING_CLOSURES_NOT_STRUCTURED: '自动检测信号尚未全部完成结构化复核',
  CALIBRATION_CRITIC_FALSE_POSITIVE_RATE_TOO_HIGH: '交叉检查误报过多',
};

export const HARD_CHECK_ERROR_LABELS: Record<string, string> = {
  PRIVATE_SPEC_LEAK: '学生消息泄漏了内部约束',
};

export function hardCheckErrorLabel(error: string): string {
  const separator = error.indexOf(':');
  const code = separator >= 0 ? error.slice(0, separator) : error;
  const detail = separator >= 0 ? error.slice(separator + 1).trim() : '';
  const label = HARD_CHECK_ERROR_LABELS[code] ?? '案例未通过自动硬检查';
  return detail ? `${label}：“${detail}”` : label;
}

export const EVALUATION_SCOPE_LABELS: Record<string, string> = {
  full: '完整门禁评测',
  FULL: '完整门禁评测',
  regression: '回归评测',
  REGRESSION: '回归评测',
  unknown: '范围待确认',
};

export const EXPORT_KIND_META: Record<string, LabelMeta> = {
  training: { label: '监督微调训练集', help: '交给外部算力平台用于 SFT 训练' },
  preference: { label: '偏好对数据', help: '包含采用稿与未采用稿，用于偏好训练' },
  manifest: { label: '交付校验清单', help: '包含文件哈希与条目统计，供双方核对' },
  clean: { label: '完整审定数据', help: '用于存档与审计' },
  gold: { label: '旧流程高置信数据', help: '兼容历史版本导出' },
  silver: { label: '旧流程复核数据', help: '兼容历史版本导出' },
};

export const DEPLOYMENT_OBSERVATION_META: Record<string, LabelMeta> = {
  sessions: { label: '观察会话数', unit: '次' },
  criticalErrors: { label: '严重错误数', help: '任意严重错误都会阻断晋级', unit: '次' },
  structureFailureRate: { label: '当前结构解析失败率', help: '填写 0 到 1 之间的小数', unit: '0~1 小数' },
  baselineStructureFailureRate: { label: '基线结构解析失败率', help: '用于判断是否较原生产模型恶化', unit: '0~1 小数' },
  teacherRejectRate: { label: '当前教师拒绝率', help: '填写 0 到 1 之间的小数', unit: '0~1 小数' },
  baselineTeacherRejectRate: { label: '基线教师拒绝率', help: '原生产模型同期指标', unit: '0~1 小数' },
  earlyTerminationRate: { label: '当前学生提前退出率', help: '填写 0 到 1 之间的小数', unit: '0~1 小数' },
  baselineEarlyTerminationRate: { label: '基线学生提前退出率', help: '原生产模型同期指标', unit: '0~1 小数' },
};

export const TUTOR_INTERACTION_META = {
  open_question: { label: '开放提问', help: '让学生自己提出想法或判断，不预设固定答案。' },
  clarification: { label: '澄清追问', help: '澄清含糊概念、缺失条件或不明确表达。' },
  explanation: { label: '概念说明', help: '解释必要的概念、原则或学生当前的误解。' },
  checkpoint: { label: '确认检查点', help: '确认已经形成的方向、决定或阶段状态，不继续展开新任务。' },
  information: { label: '必要信息', help: '提供安全要求、操作边界或必要事实，主要目的不是提问。' },
} as const;

export const TUTOR_FOCUS_LABELS: Record<string, string> = {
  research_question: '聚焦研究问题',
  direction_confirmation: '确认研究方向',
  independent_variable: '明确主动改变的条件',
  controls: '明确控制条件',
  measurement: '明确测量或记录方式',
  repeats: '确定重复次数',
  safety: '处理安全和异常',
  cite_evidence: '引用具体数据证据',
  interpret_evidence: '解释数据与结论',
};

export const TUTOR_WARNING_RESOLUTION_LABELS = {
  FIXED: '最终草稿已修复', ACCEPTABLE: '已核实，可接受', NOT_APPLICABLE: '不适用于最终草稿', FALSE_POSITIVE: '自动检查误报',
} as const;
export const TUTOR_WARNING_VALIDITY_LABELS = { VALID: '判断成立', PARTIALLY_VALID: '部分成立', FALSE_POSITIVE: '自动检查误报' } as const;
export const TUTOR_WARNING_DETECTOR_VERDICT_LABELS = { CORRECT: '机器分类正确', PARTIAL: '部分成立或表述不完整', MISCLASSIFIED: '确有问题，但机器分错类别', FALSE_POSITIVE: '没有这个问题（误报）' } as const;
export const TUTOR_WARNING_CORRECTED_CATEGORY_LABELS = { ANSWER_MENU: '答案菜单或直接提供选项', OVER_ADVANCEMENT: '过度推进到下一任务', COGNITIVE_LOAD: '单轮认知负担过高', RHETORICAL_QUESTION: '反问或同一问题的递进', EXAMPLE_TOO_DIRECT: '示例过于直接', SAFETY_OVERREACTION: '安全提醒与风险不成比例', STAGE_MISMATCH: '阶段或教学焦点不匹配', EVIDENCE_INTERPRETATION: '证据解释方向不当', OTHER: '其他人工分类' } as const;
export const TUTOR_WARNING_FINAL_RELATION_LABELS = { PRESENT_IN_FINAL: '仍出现在最终草稿', REMOVED_BY_EDIT: '已由编辑去除', ONLY_UNSELECTED_CANDIDATE: '只存在于未采用候选' } as const;
export const TUTOR_WARNING_SEVERITY_LABELS = { BLOCKING: '严重；若仍在最终稿应阻断', MINOR: '存在但较轻，不阻断', NEGLIGIBLE: '几乎无实际影响' } as const;

export function dataLabStatusLabel(value: string | null | undefined): string {
  if (!value) return '尚未开始';
  return DATA_LAB_STATUS_LABELS[value] ?? '状态待确认';
}

export function dataLabValueLabel(value: string | null | undefined): string {
  if (!value) return '未填写';
  const dictionaries = [
    DATA_LAB_STATUS_LABELS, TUTOR_SPLIT_LABELS, TRIGGER_TYPE_LABELS, REVIEW_POLICY_LABELS,
    SUBMISSION_MODE_LABELS, TRAINING_ELIGIBILITY_LABELS, EDIT_TYPE_LABELS, REVIEW_DECISION_LABELS,
    TOPIC_ACTIVITY_MODE_LABELS, TOPIC_CONTEXT_MODULE_LABELS, TOPIC_DISCIPLINE_LABELS,
    TOPIC_METRIC_KIND_LABELS, TOPIC_RESOURCE_TYPE_LABELS, TOPIC_SOURCE_STATUS_LABELS,
    EVALUATION_SCOPE_LABELS,
  ];
  for (const dictionary of dictionaries) if (dictionary[value]) return dictionary[value];
  return '待确认';
}

export function warningCodeLabel(value: string): string {
  return TUTOR_WARNING_CODE_LABELS[value] ?? '其他自动检测信号';
}

export function gateFailureLabel(value: string): string {
  if (GATE_FAILURE_LABELS[value]) return GATE_FAILURE_LABELS[value];
  const [code, detail, count] = value.split(':');
  if (code === 'FULL_REQUIRES_AT_LEAST_15_APPROVED_TOPIC_CARDS') return `至少需要 15 张已批准话题卡，当前 ${detail ?? 0} 张`;
  if (code === 'FULL_REQUIRES_ALL_V2_TOPIC_CARDS') return `正式集要求全部使用新版话题卡，当前 ${detail ?? '未达标'}`;
  if (code === 'FULL_REQUIRES_3_TOPIC_CARDS_PER_SUBJECT') return `${dataLabValueLabel(detail)}至少需要 3 张话题卡，当前 ${count ?? 0} 张`;
  if (code === 'FULL_REQUIRES_3_TOPIC_CARDS_PER_CONTEXT_MODULE') return `${dataLabValueLabel(detail)}至少需要 3 张话题卡，当前 ${count ?? 0} 张`;
  if (code === 'FULL_REQUIRES_ENGINEERING_OR_HYBRID_PER_CONTEXT_MODULE') return `${dataLabValueLabel(detail)}至少需要 1 张工程或混合型话题卡`;
  if (code === 'FULL_REQUIRES_6_ENGINEERING_OR_HYBRID_TOPIC_CARDS') return `至少需要 6 张工程或混合型话题卡，当前 ${detail ?? 0} 张`;
  if (code === 'FULL_DUPLICATE_PROJECT_FAMILY') return `同一课程项目被重复选入（${count ?? 2} 张）`;
  return '尚有一项质量门禁未达标';
}

export function formatGateMetric(key: string, value: number): string {
  const meta = GATE_METRIC_META[key] ?? { label: '其他质量指标' };
  const percentage = meta.unit === '%';
  const formatted = percentage ? `${(value * 100).toFixed(1)}%` : Number.isInteger(value) ? String(value) : value.toFixed(3);
  return `${meta.label}：${formatted}${!percentage && meta.unit ? ` ${meta.unit}` : ''}${meta.help ? `（${meta.help}）` : ''}`;
}
