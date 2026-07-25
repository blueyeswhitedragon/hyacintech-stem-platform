import type {
  Stage2CoreField,
  Stage2ExperimentPlan,
  Stage2PlanProvenance,
  Stage2Readiness,
  Stage2SectionId,
  StageData,
} from '@/app/models/stageData';

export const STAGE2_READINESS_POLICY_VERSION = 'stage2-readiness-v2' as const;

export const STAGE2_CORE_FIELD_LABELS: Record<Stage2CoreField, string> = {
  independent_variable: '唯一变量',
  levels: '变量水平',
  dependent_variable: '观测指标',
  measurement_tool: '测量工具',
  measurement_timing: '读数时间',
  recorded_fields: '记录数据',
  procedure: '操作步骤',
  controls: '控制条件',
  repeats: '独立重复',
  hypothesis: '结果趋势',
};

export const STAGE2_SECTIONS: Array<{
  id: Stage2SectionId;
  title: string;
  description: string;
  fields: Stage2CoreField[];
}> = [
  {
    id: 'variable_design',
    title: '环节一：明确变量设计',
    description: '确定唯一要改变的变量、观测指标和至少两个可比较水平。',
    fields: ['independent_variable', 'levels', 'dependent_variable'],
  },
  {
    id: 'data_recording',
    title: '环节二：思考数据记录',
    description: '明确测量工具、读数时间和原始数据记录内容。',
    fields: ['measurement_tool', 'measurement_timing', 'recorded_fields'],
  },
  {
    id: 'experiment_process',
    title: '环节三：规划实验过程',
    description: '列出操作步骤、控制条件和每组独立重复次数。',
    fields: ['procedure', 'controls', 'repeats'],
  },
  {
    id: 'expected_result',
    title: '环节四：推测实验结果',
    description: '基于已有知识预测自变量变化时观测指标的趋势。',
    fields: ['hypothesis'],
  },
];

const CORE_FIELDS = STAGE2_SECTIONS.flatMap((section) => section.fields);

function fact(stageData: StageData, field: string): unknown {
  return stageData.extractedFacts?.[field]?.value;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
}

export function normalizeExperimentLevel(value: string): string {
  const compact = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[。.!！]+$/g, '')
    .replace(/摄氏度|°c/g, '℃')
    .replace(/小时/g, 'h')
    .replace(/分钟/g, 'min')
    .replace(/厘米/g, 'cm')
    .replace(/毫米/g, 'mm')
    .replace(/毫升/g, 'ml')
    .replace(/千克/g, 'kg')
    .replace(/克/g, 'g');
  const numeric = compact.match(/^([+-]?\d+(?:\.\d+)?)(.*)$/);
  return numeric ? `${Number(numeric[1])}${numeric[2]}` : compact;
}

export function distinctExperimentLevels(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = normalizeExperimentLevel(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function inferMeasurementTool(value: string): string {
  return value.match(
    /(?:游标卡尺|刻度尺|直尺|软尺|卷尺|温度计|秒表|计时器|电子秤|天平|量筒|量杯|pH\s*试纸|pH\s*计|传感器|显微镜|相机|手机)/i,
  )?.[0]?.replace(/\s+/g, '') ?? '';
}

export function inferMeasurementTiming(value: string): string {
  return value.match(
    /(?:第\s*\d+\s*(?:天|小时|分钟|周)|\d+\s*(?:天|小时|分钟|周)后|每天(?:固定|同一)?时间|每天同一时间|每隔\s*\d+\s*(?:小时|分钟|天)|实验(?:开始|结束)时|开始前|结束后)/,
  )?.[0]?.replace(/\s+/g, '') ?? '';
}

function researchQuestion(stageData: StageData): string {
  return stageData.stage1?.researchQuestion?.trim()
    || stageData.stage1?.themeMapping?.researchQuestion?.trim()
    || text(fact(stageData, 'stage1.researchQuestion'));
}

function confirmedPlan(stageData: StageData): Stage2ExperimentPlan | undefined {
  const stage2 = stageData.stage2;
  return stage2?.experimentPlan && stage2.confirmedPlanHash === stage2.draftHash
    ? stage2.experimentPlan
    : undefined;
}

function completeReadiness(policyVersion: Stage2Readiness['policyVersion']): Stage2Readiness {
  const sections = STAGE2_SECTIONS.map((section) => section.id);
  return {
    policyVersion,
    complete: true,
    completedFields: [...CORE_FIELDS],
    missingFields: [],
    completedSections: sections,
    missingSections: [],
    nextFocusId: 'plan_confirmation',
  };
}

export function evaluateStage2Readiness(stageData: StageData): Stage2Readiness {
  const frozenPlan = confirmedPlan(stageData);
  if (frozenPlan && frozenPlan.contractVersion !== 'stage2-plan-v2') {
    return completeReadiness('stage2-readiness-v1');
  }

  const plan = frozenPlan?.contractVersion === 'stage2-plan-v2' ? frozenPlan : undefined;
  const levels = distinctExperimentLevels(
    strings(fact(stageData, 'stage2.independentVariable.levels')).length > 0
      ? strings(fact(stageData, 'stage2.independentVariable.levels'))
      : plan?.independentVariable.levels ?? [],
  );
  const independentName = text(fact(stageData, 'stage2.independentVariable.name')) || text(plan?.independentVariable.name);
  const dependentName = text(fact(stageData, 'stage2.dependentVariable.name')) || text(plan?.dependentVariable.name);
  const measurement = text(fact(stageData, 'stage2.dependentVariable.measurement')) || text(plan?.dependentVariable.measurement);
  const tool = text(fact(stageData, 'stage2.measurement.tool')) || text(plan?.dataRecording?.tool) || inferMeasurementTool(measurement);
  const timing = text(fact(stageData, 'stage2.measurement.timing')) || text(plan?.dataRecording?.timing) || inferMeasurementTiming(measurement);
  const recordedFields = strings(fact(stageData, 'stage2.recordedFields')).length > 0
    ? strings(fact(stageData, 'stage2.recordedFields'))
    : plan?.dataRecording?.recordedFields?.length
      ? plan.dataRecording.recordedFields
      : dependentName
        ? [dependentName]
        : [];
  const procedure = strings(fact(stageData, 'stage2.procedure')).length > 0
    ? strings(fact(stageData, 'stage2.procedure'))
    : plan?.procedure ?? [];
  const repeatCount = fact(stageData, 'stage2.repeatCount') ?? plan?.repeatCount;
  const hypothesis = text(fact(stageData, 'stage2.hypothesis')) || text(plan?.hypothesis);
  const completed = new Set<Stage2CoreField>();

  if (independentName) completed.add('independent_variable');
  if (levels.length >= 2) completed.add('levels');
  if (dependentName) completed.add('dependent_variable');
  if (tool) completed.add('measurement_tool');
  if (timing) completed.add('measurement_timing');
  if (recordedFields.length > 0) completed.add('recorded_fields');
  if (procedure.length > 0) completed.add('procedure');
  if (Object.hasOwn(stageData.extractedFacts ?? {}, 'stage2.controlledVariables') || Boolean(plan)) completed.add('controls');
  if (typeof repeatCount === 'number' && Number.isFinite(repeatCount) && repeatCount >= 1) completed.add('repeats');
  if (hypothesis) completed.add('hypothesis');

  const completedFields = CORE_FIELDS.filter((field) => completed.has(field));
  const missingFields = CORE_FIELDS.filter((field) => !completed.has(field));
  const completedSections = STAGE2_SECTIONS
    .filter((section) => section.fields.every((field) => completed.has(field)))
    .map((section) => section.id);
  const missingSections = STAGE2_SECTIONS
    .filter((section) => !section.fields.every((field) => completed.has(field)))
    .map((section) => section.id);

  return {
    policyVersion: STAGE2_READINESS_POLICY_VERSION,
    complete: missingFields.length === 0,
    completedFields,
    missingFields,
    completedSections,
    missingSections,
    nextFocusId: missingSections[0] ?? 'plan_confirmation',
  };
}

function studentOrComposedMaterials(
  stageData: StageData,
  composed: string[],
): { values: string[]; source: 'student_fact' | 'server_composed' } {
  const values = strings(fact(stageData, 'stage2.materials'));
  return values.length > 0 ? { values, source: 'student_fact' } : { values: composed, source: 'server_composed' };
}

function positiveInteger(value: unknown, maximum = 200): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= maximum ? number : undefined;
}

export function composeStage2Plan(stageData: StageData): {
  plan: Stage2ExperimentPlan;
  provenance: Stage2PlanProvenance;
} | null {
  const frozenPlan = confirmedPlan(stageData);
  if (frozenPlan) {
    return {
      plan: frozenPlan,
      provenance: stageData.stage2?.planProvenance ?? {},
    };
  }

  const readiness = evaluateStage2Readiness(stageData);
  if (!readiness.complete) return null;

  const question = researchQuestion(stageData);
  const hypothesis = text(fact(stageData, 'stage2.hypothesis'));
  const independentName = text(fact(stageData, 'stage2.independentVariable.name'));
  const levels = distinctExperimentLevels(strings(fact(stageData, 'stage2.independentVariable.levels')));
  const dependentName = text(fact(stageData, 'stage2.dependentVariable.name'));
  const rawMeasurement = text(fact(stageData, 'stage2.dependentVariable.measurement'));
  const tool = text(fact(stageData, 'stage2.measurement.tool')) || inferMeasurementTool(rawMeasurement);
  const timing = text(fact(stageData, 'stage2.measurement.timing')) || inferMeasurementTiming(rawMeasurement);
  const recordedFields = strings(fact(stageData, 'stage2.recordedFields')).length > 0
    ? strings(fact(stageData, 'stage2.recordedFields'))
    : [dependentName];
  const measurement = rawMeasurement || `${timing}使用${tool}记录${recordedFields.join('、')}`;
  const unit = text(fact(stageData, 'stage2.dependentVariable.unit')) || undefined;
  const controls = strings(fact(stageData, 'stage2.controlledVariables'));
  const procedure = strings(fact(stageData, 'stage2.procedure'));
  const repeatCount = positiveInteger(fact(stageData, 'stage2.repeatCount'), 20);
  const sampleSizePerLevel = positiveInteger(fact(stageData, 'stage2.sampleSizePerLevel'));
  if (!question || !hypothesis || !independentName || levels.length < 2 || !dependentName || !tool || !timing || procedure.length === 0 || !repeatCount) {
    return null;
  }

  const materials = studentOrComposedMaterials(stageData, [
    `用于设置${independentName}各水平的材料或装置`,
    `用于${measurement}的测量工具`,
    '数量足够且条件一致的实验对象',
  ]);
  const explicitSafety = strings(fact(stageData, 'stage2.safetyNotes'));
  const safetyNotes = explicitSafety.length > 0
    ? explicitSafety
    : ['保持实验区域整洁；材料或装置出现异常时立即停止，并告知教师。'];

  const student = (sourceFields: string[]) => ({ source: 'student_fact' as const, sourceFields });
  const provenance: Stage2PlanProvenance = {
    researchQuestion: student(['stage1.researchQuestion']),
    hypothesis: student(['stage2.hypothesis']),
    independentVariable: student(['stage2.independentVariable.name']),
    levels: student(['stage2.independentVariable.levels']),
    dependentVariable: student(['stage2.dependentVariable.name']),
    measurement: student([
      'stage2.dependentVariable.measurement',
      'stage2.measurement.tool',
      'stage2.measurement.timing',
      'stage2.dependentVariable.unit',
    ]),
    dataRecording: student(['stage2.measurement.tool', 'stage2.measurement.timing', 'stage2.recordedFields']),
    controlledVariables: student(['stage2.controlledVariables']),
    materials: {
      source: materials.source,
      sourceFields: materials.source === 'student_fact'
        ? ['stage2.materials']
        : ['stage2.independentVariable.name', 'stage2.dependentVariable.measurement'],
    },
    procedure: student(['stage2.procedure']),
    sampleSizePerLevel: sampleSizePerLevel ? student(['stage2.sampleSizePerLevel']) : undefined,
    repeatCount: student(['stage2.repeatCount']),
    safetyNotes: {
      source: explicitSafety.length > 0 ? 'student_fact' : 'server_baseline',
      sourceFields: explicitSafety.length > 0 ? ['stage2.safetyNotes'] : [],
    },
  };

  return {
    plan: {
      contractVersion: 'stage2-plan-v2',
      researchQuestion: question,
      hypothesis,
      independentVariable: { name: independentName, levels },
      dependentVariable: { name: dependentName, measurement, unit },
      dataRecording: { tool, timing, recordedFields },
      controlledVariables: controls,
      materials: materials.values,
      procedure,
      sampleSizePerLevel,
      repeatCount,
      safetyNotes,
    },
    provenance,
  };
}
