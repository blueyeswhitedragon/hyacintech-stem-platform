import type {
  Stage2CoreField,
  Stage2ExperimentPlan,
  Stage2PlanProvenance,
  Stage2Readiness,
  StageData,
} from '@/app/models/stageData';

export const STAGE2_READINESS_POLICY_VERSION = 'stage2-readiness-v1' as const;

export const STAGE2_CORE_FIELD_LABELS: Record<Stage2CoreField, string> = {
  hypothesis: '研究假设',
  independent_variable: '自变量',
  levels: '实验水平',
  dependent_variable: '观察结果',
  measurement: '测量方式',
  controls: '控制条件',
  repeats: '重复次数',
};

const CORE_FIELDS: Stage2CoreField[] = [
  'hypothesis',
  'independent_variable',
  'levels',
  'dependent_variable',
  'measurement',
  'controls',
  'repeats',
];

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

function researchQuestion(stageData: StageData): string {
  return stageData.stage1?.researchQuestion?.trim()
    || stageData.stage1?.themeMapping?.researchQuestion?.trim()
    || text(fact(stageData, 'stage1.researchQuestion'));
}

function confirmedLegacyPlan(stageData: StageData): Stage2ExperimentPlan | undefined {
  const stage2 = stageData.stage2;
  return stage2?.experimentPlan && stage2.confirmedPlanHash === stage2.draftHash
    ? stage2.experimentPlan
    : undefined;
}

export function evaluateStage2Readiness(stageData: StageData): Stage2Readiness {
  const legacyPlan = confirmedLegacyPlan(stageData);
  const levels = strings(fact(stageData, 'stage2.independentVariable.levels'));
  const repeatCount = fact(stageData, 'stage2.repeatCount');
  const completed = new Set<Stage2CoreField>();

  if (text(fact(stageData, 'stage2.hypothesis')) || text(legacyPlan?.hypothesis)) completed.add('hypothesis');
  if (text(fact(stageData, 'stage2.independentVariable.name')) || text(legacyPlan?.independentVariable.name)) completed.add('independent_variable');
  if (levels.length >= 2 || (legacyPlan?.independentVariable.levels.length ?? 0) >= 2) completed.add('levels');
  if (text(fact(stageData, 'stage2.dependentVariable.name')) || text(legacyPlan?.dependentVariable.name)) completed.add('dependent_variable');
  if (text(fact(stageData, 'stage2.dependentVariable.measurement')) || text(legacyPlan?.dependentVariable.measurement)) completed.add('measurement');
  if (Object.hasOwn(stageData.extractedFacts ?? {}, 'stage2.controlledVariables') || Boolean(legacyPlan)) completed.add('controls');
  if ((typeof repeatCount === 'number' && Number.isFinite(repeatCount) && repeatCount >= 1) || (legacyPlan?.repeatCount ?? 0) >= 1) completed.add('repeats');

  const completedFields = CORE_FIELDS.filter((field) => completed.has(field));
  const missingFields = CORE_FIELDS.filter((field) => !completed.has(field));
  return {
    policyVersion: STAGE2_READINESS_POLICY_VERSION,
    complete: missingFields.length === 0,
    completedFields,
    missingFields,
    nextFocusId: missingFields[0] ?? 'plan_confirmation',
  };
}

function studentOrComposedList(
  stageData: StageData,
  field: 'stage2.materials' | 'stage2.procedure',
  composed: string[],
): { values: string[]; source: 'student_fact' | 'server_composed' } {
  const values = strings(fact(stageData, field));
  return values.length > 0 ? { values, source: 'student_fact' } : { values: composed, source: 'server_composed' };
}

export function composeStage2Plan(stageData: StageData): {
  plan: Stage2ExperimentPlan;
  provenance: Stage2PlanProvenance;
} | null {
  const readiness = evaluateStage2Readiness(stageData);
  if (!readiness.complete) return null;

  const legacyPlan = confirmedLegacyPlan(stageData);
  if (legacyPlan) return {
    plan: legacyPlan,
    provenance: stageData.stage2?.planProvenance ?? {},
  };

  const question = researchQuestion(stageData);
  const hypothesis = text(fact(stageData, 'stage2.hypothesis'));
  const independentName = text(fact(stageData, 'stage2.independentVariable.name'));
  const levels = strings(fact(stageData, 'stage2.independentVariable.levels'));
  const dependentName = text(fact(stageData, 'stage2.dependentVariable.name'));
  const measurement = text(fact(stageData, 'stage2.dependentVariable.measurement'));
  const unit = text(fact(stageData, 'stage2.dependentVariable.unit')) || undefined;
  const controls = strings(fact(stageData, 'stage2.controlledVariables'));
  const repeatCount = Math.max(1, Math.min(20, Math.round(Number(fact(stageData, 'stage2.repeatCount')))));
  if (!question || !hypothesis || !independentName || levels.length < 2 || !dependentName || !measurement) return null;

  const materials = studentOrComposedList(stageData, 'stage2.materials', [
    `用于设置${independentName}各水平的材料或装置`,
    `用于${measurement}的测量工具`,
    '数量足够且条件一致的实验对象',
  ]);
  const controlStep = controls.length > 0
    ? `各组保持${controls.join('、')}一致，只改变${independentName}`
    : `各组使用相同操作条件，只改变${independentName}`;
  const procedure = studentOrComposedList(stageData, 'stage2.procedure', [
    `按${levels.join('、')}设置${independentName}的不同实验组`,
    controlStep,
    `每个水平安排${repeatCount}次重复实验`,
    `${measurement}，并如实记录${dependentName}`,
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
    measurement: student(['stage2.dependentVariable.measurement', 'stage2.dependentVariable.unit']),
    controlledVariables: student(['stage2.controlledVariables']),
    materials: { source: materials.source, sourceFields: materials.source === 'student_fact' ? ['stage2.materials'] : ['stage2.independentVariable.name', 'stage2.dependentVariable.measurement'] },
    procedure: { source: procedure.source, sourceFields: procedure.source === 'student_fact' ? ['stage2.procedure'] : ['stage2.independentVariable.name', 'stage2.independentVariable.levels', 'stage2.controlledVariables', 'stage2.repeatCount', 'stage2.dependentVariable.measurement'] },
    repeatCount: student(['stage2.repeatCount']),
    safetyNotes: { source: explicitSafety.length > 0 ? 'student_fact' : 'server_baseline', sourceFields: explicitSafety.length > 0 ? ['stage2.safetyNotes'] : [] },
  };

  return {
    plan: {
      researchQuestion: question,
      hypothesis,
      independentVariable: { name: independentName, levels },
      dependentVariable: { name: dependentName, measurement, unit },
      controlledVariables: controls,
      materials: materials.values,
      procedure: procedure.values,
      repeatCount,
      safetyNotes,
    },
    provenance,
  };
}
