import type { Stage2Column, Stage2ExperimentPlan, StageData } from '@/app/models/stageData';
import type { ChatResponse, ExperimentPlan, ReportSections } from '@/app/models/types';
import type { StageTriggerType } from '@/app/lib/stageContract';

type AnyPlan = ExperimentPlan | Stage2ExperimentPlan;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!asRecord(row))
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export function inferMeasurementUnit(measurement: string): string | undefined {
  const declared = measurement.match(/单位\s*[:：]?\s*([A-Za-z%°℃/]+|毫米|厘米|米|毫升|升|秒|分钟|小时|克|千克|牛顿|粒|个|株)/i)?.[1];
  if (declared) return declared;
  return measurement.match(/(?:mg\/L|个\/min|mm|cm|mL|ml|NTU|℃|°C|%|kg|g|s)(?![A-Za-z])/i)?.[0];
}

export function planUnit(plan: AnyPlan): string | undefined {
  return plan.dependentVariable.unit?.trim() || inferMeasurementUnit(plan.dependentVariable.measurement);
}

function resultKey(index: number): string {
  return index < 26 ? `result_${String.fromCharCode(97 + index)}` : `result_${index + 1}`;
}

/** Build the chart-compatible wide table from an already confirmed plan. */
export function buildDataTableSchema(plan: AnyPlan): NonNullable<ChatResponse['data_table_schema']> {
  const unit = planUnit(plan);
  const resultColumns: Stage2Column[] = plan.independentVariable.levels.map((level, index) => ({
    key: resultKey(index),
    title: `${level}：${plan.dependentVariable.name}${unit ? `（${unit}）` : ''}`,
    type: 'number',
    required: true,
  }));
  return {
    columns: [
      { key: 'trial', title: '重复序号', type: 'number', required: true },
      ...resultColumns,
      { key: 'notes', title: '客观异常备注', type: 'text', required: false },
    ],
    minRows: Math.max(3, plan.repeatCount),
    maxRows: 200,
  };
}

interface ReportSource {
  plan?: AnyPlan;
  stageData?: StageData;
  rows: Record<string, unknown>[];
  schema?: { columns: Stage2Column[] };
  acceptedAnalysis: string[];
  researchQuestion?: string;
  hypothesis?: string;
}

function reportSource(value: unknown): ReportSource {
  const root = asRecord(value) ?? {};
  const stageData = asRecord(root.stageData) as StageData | undefined;
  const tutorVisible = asRecord(root.tutorVisible) ?? root;
  const approvedPlan = asRecord(tutorVisible.approvedPlan) as AnyPlan | undefined;
  const stagePlan = stageData?.stage2?.experimentPlan;
  const plan = stagePlan ?? approvedPlan;
  const rows = stageData?.stage3?.rows ?? asRows(tutorVisible.dataRows);
  const schema = stageData?.stage2?.schema ?? asRecord(tutorVisible.dataSchema) as ReportSource['schema'];
  const acceptedAnalysis = stageData?.stage4?.evidenceRounds?.flatMap((round) => [
    round.observation,
    ...round.citations,
    round.anomaly ? `异常记录：${round.anomaly}` : '',
    round.interpretation ? `学生解释：${round.interpretation}` : '',
  ]).filter(Boolean) ?? stringArray(tutorVisible.acceptedAnalysis);
  return {
    plan,
    stageData,
    rows,
    schema,
    acceptedAnalysis,
    researchQuestion: plan?.researchQuestion
      ?? stageData?.stage1?.themeMapping?.researchQuestion,
    hypothesis: plan?.hypothesis,
  };
}

function renderRows(source: ReportSource): string {
  if (source.rows.length === 0) return '待学生补充：尚无已提交的实验数据。';
  const columns = source.schema?.columns ?? Object.keys(source.rows[0]).map((key) => ({
    key,
    title: key,
    type: key === 'notes' ? 'text' as const : 'number' as const,
    required: key !== 'notes',
  }));
  const lines = source.rows.map((row, index) => {
    const values = columns.flatMap((column) => {
      const raw = row[column.key];
      if (raw === null || raw === undefined || raw === '') return [];
      return [`${column.title}=${String(raw)}`];
    });
    return `第${index + 1}行：${values.join('；')}`;
  });
  return `共${source.rows.length}行真实记录。${lines.join('；')}`;
}

export function composeReportSections(value: unknown): ReportSections | null {
  const source = reportSource(value);
  if (!source.plan && !source.stageData) return null;
  const plan = source.plan;
  return {
    purpose: source.researchQuestion ? `探究${source.researchQuestion.replace(/[？?]$/, '')}` : '待学生补充：研究问题尚未结构化保存。',
    hypothesis: source.hypothesis || '待学生补充：研究假设尚未结构化保存。',
    materials: plan?.materials.length ? plan.materials.join('、') : '待学生补充：材料尚未结构化保存。',
    procedure: plan?.procedure.length
      ? plan.procedure.map((step, index) => `${index + 1}. ${step}`).join('\n')
      : '待学生补充：步骤尚未结构化保存。',
    dataSummary: renderRows(source),
    analysis: source.acceptedAnalysis.length
      ? source.acceptedAnalysis.join('；')
      : '待学生补充：尚无已接受的数据分析。',
  };
}

/** Attach only artifacts that the server can reproduce deterministically. */
export function attachDeterministicArtifacts(
  stage: number | undefined,
  response: ChatResponse,
  visibleContext: unknown,
  triggerType?: StageTriggerType,
): ChatResponse {
  if (stage === 2 && response.experiment_plan) {
    return {
      ...response,
      next_action_type: 'confirmation',
      data_table_schema: buildDataTableSchema(response.experiment_plan),
      artifact_provenance: {
        ...response.artifact_provenance,
        data_table_schema: 'server_composed',
      },
    };
  }
  if (stage === 5 && triggerType === 'REPORT_BOOTSTRAP') {
    const sections = composeReportSections(visibleContext);
    if (sections) {
      return {
        ...response,
        report_sections: sections,
        artifact_provenance: {
          ...response.artifact_provenance,
          report_sections: 'server_composed',
        },
      };
    }
  }
  return response;
}
