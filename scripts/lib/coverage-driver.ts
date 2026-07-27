/**
 * 结构覆盖驱动：为 expectedCoverageCells() 的每一格产出一个可执行的 Tutor 回合输入。
 *
 * 存在的理由：部署门禁按 (phase, triggerType, focus) 判定覆盖，缺一格就是 INSUFFICIENT。
 * 采集脚本必须真的走完这 16 格，而不是只跑 persona + P4 + P5。
 * 这里只组装状态与可见事实，不调用模型，便于单测。
 */
import type { StageData, Stage2ExperimentPlan, Stage2Column } from '../../app/models/stageData';
import { buildDataTableSchema, composeReportSections } from '../../app/lib/stageArtifacts';
import { composeStage2Plan, evaluateStage2Readiness } from '../../app/lib/stage2Readiness';
import { stage2DraftHash } from '../../app/lib/stageState';
import { updateServerAnalysis, visibleDataRows } from '../../app/lib/serverTutorState';
import { buildTutorVisibleState } from '../../app/lib/tutorLanguage';
import {
  EVAL_CASE_COUNTS,
  expectedCoverageCells,
  focusDescriptions,
  type CoverageCell,
} from '../../app/lib/dataLab/bootstrap/caseCompiler';

const QUESTION = '光照时长对豆苗高度的影响';
const LEVELS = ['0小时', '8小时', '12小时', '24小时'];

const PLAN: Stage2ExperimentPlan = {
  researchQuestion: QUESTION,
  hypothesis: '我认为每天光照时间越多，豆苗高度越高。',
  independentVariable: { name: '每天光照时长', levels: LEVELS },
  dependentVariable: { name: '豆苗高度', measurement: '用刻度尺从土壤表面量到茎尖，每天固定时间测量', unit: '厘米' },
  controlledVariables: ['豆苗数量', '水和营养液量', '水位', '温度', '测量时间'],
  materials: ['豆苗', '水培容器', '营养液', '刻度尺', '遮光材料'],
  procedure: ['设置0、8、12、24小时四个光照条件', '各组保持其他条件一致', '每天固定时间测量豆苗高度并记录', '每个水平安排10次重复并计算平均值'],
  repeatCount: 10,
  safetyNotes: ['保持台面整洁，培养液或装置异常时停止操作并告知教师。'],
};

const SCHEMA_COLUMNS: Stage2Column[] = buildDataTableSchema(PLAN).columns;

const DATA_ROWS: Record<string, unknown>[] = [
  [6.2, 14.8, 18.2, 16.1], [6.5, 15.1, 18.5, 15.8], [6.1, 14.9, 18.1, 16.4],
  [6.3, 15.2, 18.7, 16.0], [6.4, 14.7, 18.4, 15.9], [6.0, 15.0, 18.3, 16.2],
].map((values, index) => {
  const row: Record<string, unknown> = { trial: index + 1, notes: '' };
  SCHEMA_COLUMNS.filter((column) => column.key !== 'trial' && column.key !== 'notes')
    .forEach((column, columnIndex) => { row[column.key] = values[columnIndex] ?? values[values.length - 1]; });
  return row;
});

function withFacts(state: StageData, entries: Array<[string, unknown, string]>): StageData {
  const extractedFacts = { ...(state.extractedFacts ?? {}) };
  for (const [key, value, sourceQuote] of entries) extractedFacts[key] = { value, sourceQuote };
  return { ...state, extractedFacts };
}

const STAGE2_FACTS: Array<[string, unknown, string]> = [
  ['stage2.independentVariable.name', PLAN.independentVariable.name, '我准备改变每天光照时长。'],
  ['stage2.independentVariable.levels', LEVELS, '我准备比较0小时、8小时、12小时和24小时。'],
  ['stage2.dependentVariable.name', PLAN.dependentVariable.name, '我要观察豆苗高度。'],
  ['stage2.dependentVariable.measurement', PLAN.dependentVariable.measurement, '用刻度尺从土壤表面量到茎尖，每天固定时间测量，单位用厘米。'],
  ['stage2.dependentVariable.unit', '厘米', '用刻度尺从土壤表面量到茎尖，每天固定时间测量，单位用厘米。'],
  ['stage2.controlledVariables', PLAN.controlledVariables, '豆苗数量、水和营养液量、水位、温度、测量时间都保持一致。'],
  ['stage2.procedure', PLAN.procedure, '先设置四个光照条件，各组其他条件一致，每天固定时间量高度并记录。'],
  ['stage2.repeatCount', PLAN.repeatCount, '每个水平做10次重复，最后取平均值。'],
  ['stage2.hypothesis', PLAN.hypothesis, PLAN.hypothesis ?? ''],
];

function stage1Open(): StageData {
  return { extractedFacts: {} };
}

function stage1Questioned(): StageData {
  return withFacts(stage1Open(), [['stage1.researchQuestion', QUESTION, QUESTION]]);
}

function stage1Confirmed(): StageData {
  const state = withFacts(stage1Questioned(), [['stage1.confirmed', true, '我确认按这个问题做。']]);
  return {
    ...state,
    stage1: {
      confirmed: true,
      snapshot: `《探究问题确认书》\n研究问题：${QUESTION}`,
      researchQuestion: QUESTION,
      confirmedQuestionHash: 'coverage-confirmed-question',
    },
  };
}

/** 阶段二部分完成：只注入前 count 条方案事实，用于覆盖不同的 P2 focus。 */
function stage2Partial(count: number): StageData {
  return withFacts(stage1Confirmed(), STAGE2_FACTS.slice(0, count));
}

function stage2Ready(): StageData {
  const state = stage2Partial(STAGE2_FACTS.length);
  const composed = composeStage2Plan(state);
  if (!composed) throw new Error('覆盖驱动无法组装阶段二方案');
  return {
    ...state,
    stage2: {
      submitted: false,
      approved: null,
      planDraft: composed.plan,
      readiness: evaluateStage2Readiness(state),
      planProvenance: composed.provenance,
      draftHash: stage2DraftHash(composed.plan),
      schema: buildDataTableSchema(composed.plan),
    },
  };
}

function stage2Frozen(): StageData {
  const state = stage2Ready();
  const draftHash = state.stage2?.draftHash ?? stage2DraftHash(PLAN);
  return {
    ...state,
    stage2: {
      ...(state.stage2 ?? { submitted: false, approved: null, schema: buildDataTableSchema(PLAN) }),
      planDraft: PLAN,
      experimentPlan: PLAN,
      confirmedPlanHash: draftHash,
      draftHash,
      schema: buildDataTableSchema(PLAN),
    },
  };
}

function stage3Entered(): StageData {
  return {
    ...stage2Frozen(),
    stage3: {
      rows: [],
      safetyQuiz: { question: '出现异常时应该怎样做？', options: ['停止并告知教师', '继续完成', '自行增强材料'], passed: false },
    },
  };
}

function stage3Submitted(): StageData {
  const base = stage3Entered();
  return {
    ...base,
    stage3: { rows: DATA_ROWS.map((row) => ({ ...row })), safetyQuiz: { ...base.stage3!.safetyQuiz!, passed: true }, submitted: true },
  };
}

function citation(rowIndex: number, highKey: string, lowKey: string): string {
  const row = DATA_ROWS[rowIndex];
  const high = SCHEMA_COLUMNS.find((column) => column.key === highKey);
  const low = SCHEMA_COLUMNS.find((column) => column.key === lowKey);
  return `第${rowIndex + 1}行中，${low?.title}是${row[lowKey]}，${high?.title}是${row[highKey]}，前者比后者低。`;
}

const MEASURED_KEYS = SCHEMA_COLUMNS
  .filter((column) => column.key !== 'trial' && column.key !== 'notes')
  .map((column) => column.key);

function stage4Accepted(): { state: StageData; message: string } {
  const message = citation(0, MEASURED_KEYS[2] ?? MEASURED_KEYS[0], MEASURED_KEYS[0]);
  const result = updateServerAnalysis(stage3Submitted(), message);
  return { state: result.stageData, message };
}

function stage5Bootstrapped(): StageData {
  const state = stage4Accepted().state;
  const sections = composeReportSections({ stageData: state });
  return {
    ...state,
    stage5: {
      submitted: false,
      approved: null,
      sections: {
        ...(sections ?? { purpose: '', hypothesis: '', materials: '', procedure: '', dataSummary: '', analysis: '' }),
        conclusion: '',
        limitationsDiscussion: '',
        reflection: '',
      },
    },
  };
}

function stage6Entered(): StageData {
  const state = stage5Bootstrapped();
  return {
    ...state,
    stage5: {
      ...state.stage5!,
      submitted: true,
      approved: true,
      teacherScore: 8,
      teacherFeedback: '数据记录完整，结论还可以再贴近数据。',
    },
    stage6: { studentResponse: '', responseToTeacherFeedback: '', learningReflection: '', finalReadonly: false },
  };
}

export interface CoverageTurnPlan extends CoverageCell {
  /** 该格的稳定标识，用于场景/回合 id。 */
  key: string;
  studentMessage: string;
  allowedFocusIds: string[];
  focusDescriptions: Record<string, string>;
  visibleFacts: unknown;
  priorStudentMessages: string[];
  tutorHistory: string[];
  completedFocusIds?: string[];
  planReady?: boolean;
}

const STAGE4_ACCEPTED = stage4Accepted();

/** 每一格的学生输入与阶段状态。系统触发格的学生消息必须为空串。 */
const CELL_INPUTS: Record<string, { state: () => StageData; studentMessage: string; extraVisible?: Record<string, unknown> }> = {
  '1|USER_MESSAGE|research_question': { state: stage1Open, studentMessage: '我最近发现不同光照时间下，豆苗长得好像不一样，想研究这个。' },
  '1|USER_MESSAGE|direction_confirmation': { state: stage1Questioned, studentMessage: `我想研究的问题是${QUESTION}，这样说准确吗？` },
  '2|STAGE_TRANSITION|variable_design': { state: stage1Confirmed, studentMessage: '' },
  '2|USER_MESSAGE|variable_design': { state: () => stage2Partial(0), studentMessage: '我准备改变每天光照时长，看看豆苗长多高。' },
  '2|USER_MESSAGE|data_recording': { state: () => stage2Partial(3), studentMessage: '我打算量一量豆苗的高度，用尺子就行。' },
  '2|USER_MESSAGE|experiment_process': { state: () => stage2Partial(6), studentMessage: '我把四盆豆苗放在不同光照下，然后每天看一看。' },
  '2|USER_MESSAGE|expected_result': { state: () => stage2Partial(8), studentMessage: '步骤和重复次数我都写好了，接下来还要补什么？' },
  '2|USER_MESSAGE|plan_confirmation': { state: stage2Ready, studentMessage: '方案我看过了，可以确认吗？' },
  '3|STAGE_ENTER|safety_checkpoint': { state: stage3Entered, studentMessage: '' },
  '3|USER_MESSAGE|safety_checkpoint': { state: stage3Entered, studentMessage: '我觉得出现异常时应该先停止操作并告诉老师。' },
  '4|STAGE_TRANSITION|cite_evidence': { state: stage3Submitted, studentMessage: '' },
  '4|USER_MESSAGE|cite_evidence': { state: stage3Submitted, studentMessage: '数据我都记完了，接下来怎么分析？' },
  '4|USER_MESSAGE|interpret_evidence': { state: () => STAGE4_ACCEPTED.state, studentMessage: STAGE4_ACCEPTED.message },
  '5|REPORT_BOOTSTRAP|report_handoff': { state: stage5Bootstrapped, studentMessage: '' },
  '5|USER_MESSAGE|report_gap': { state: stage5Bootstrapped, studentMessage: '报告我看了一遍，感觉结论那里还差点东西。' },
  '6|USER_MESSAGE|reflection_coaching': { state: stage6Entered, studentMessage: '老师说结论要更贴近数据，我该怎么改进下一次？' },
};

export function coverageCellKey(cell: CoverageCell): string {
  return `${cell.phase}|${cell.triggerType}|${cell.focus}`;
}

/**
 * 为门禁期望的每一格产出一个 Tutor 回合计划。
 * 缺少输入定义时立刻抛错，避免采集出一份注定被门禁退回的 transcript。
 */
export function planCoverageTurns(counts: Record<number, number> = EVAL_CASE_COUNTS): CoverageTurnPlan[] {
  return expectedCoverageCells(counts).map((cell) => {
    const key = coverageCellKey(cell);
    const input = CELL_INPUTS[key];
    if (!input) throw new Error(`结构覆盖格缺少学生输入定义：${key}`);
    const isSystemTrigger = cell.triggerType !== 'USER_MESSAGE';
    if (isSystemTrigger && input.studentMessage !== '') throw new Error(`系统触发格的学生消息必须为空：${key}`);
    if (!isSystemTrigger && !input.studentMessage) throw new Error(`学生触发格必须提供学生消息：${key}`);
    const state = input.state();
    const readiness = cell.phase === 2 ? evaluateStage2Readiness(state) : undefined;
    const visibleFacts = cell.phase === 4
      ? { 研究方案: state.stage2?.experimentPlan, 数据记录: visibleDataRows(state), 已接受分析次数: state.stage4?.analysisCount ?? 0 }
      : buildTutorVisibleState(cell.phase, state, input.extraVisible ?? {});
    return {
      ...cell,
      key,
      studentMessage: input.studentMessage,
      allowedFocusIds: [cell.focus],
      focusDescriptions: focusDescriptions([cell.focus]),
      visibleFacts,
      priorStudentMessages: [],
      tutorHistory: [],
      completedFocusIds: readiness?.completedFields,
      planReady: readiness?.complete,
    };
  });
}

/** 采集/判定两侧都用它自检：返回缺失的格。 */
export function missingCoverageCells(
  observed: Array<{ phase: number; triggerType: string; focus: string }>,
  counts: Record<number, number> = EVAL_CASE_COUNTS,
): CoverageCell[] {
  const seen = new Set(observed.map((item) => coverageCellKey(item)));
  return expectedCoverageCells(counts).filter((cell) => !seen.has(coverageCellKey(cell)));
}

