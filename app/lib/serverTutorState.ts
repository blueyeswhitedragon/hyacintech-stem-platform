import type { ChatResponse, SafetyQuiz } from '@/app/models/types';
import type { Stage2RiskAnnotation, Stage4RoundRejection, StageData } from '@/app/models/stageData';
import type { ValidatedAnalysisClaim } from '@/app/lib/analysisClaimExtractor';
import { composeReportSections } from '@/app/lib/stageArtifacts';
import type { TutorServerEnvelope } from '@/app/lib/tutorLanguage';
import { contractHash } from '@/app/lib/stageState';
import { evaluateStage2Readiness } from '@/app/lib/stage2Readiness';

export interface TutorFocusPlan {
  allowedFocusIds: string[];
  focusDescriptions: Record<string, string>;
}

function fact(stageData: StageData, field: string): unknown {
  return stageData.extractedFacts?.[field]?.value;
}

export function tutorFocusPlan(stage: number, stageData: StageData, input: { triggerType?: string; analysisAccepted?: boolean } = {}): TutorFocusPlan {
  const descriptions: Record<string, string> = {};
  const add = (id: string, description: string) => {
    descriptions[id] = description;
    return id;
  };
  if (stage === 1) {
    if (stageData.stage1?.confirmed) {
      const id = add('direction_confirmation', '确认书已经生成；只请学生核对并使用页面按钮进入方案设计，不再提出新问题或提前讨论变量、水平、测量和控制条件');
      return { allowedFocusIds: [id], focusDescriptions: descriptions };
    }
    const ids: string[] = [];
    if (!fact(stageData, 'stage1.researchQuestion')) ids.push(add('research_question', '帮助学生用自己的话形成一个清楚、可探究的核心问题；不追问机制、变量、水平、测量或实验细节'));
    if (ids.length === 0) ids.push(add('direction_confirmation', '只请学生核对当前研究问题是否准确；不得询问机制、变量方向、水平、测量、材料或步骤'));
    return { allowedFocusIds: [...new Set(ids)], focusDescriptions: descriptions };
  }
  if (stage === 2) {
    const readiness = evaluateStage2Readiness(stageData);
    const focusDescriptions: Record<string, string> = {
      variable_design: '环节一：帮助学生明确唯一自变量、至少两个不同且可比较的水平，以及一个观测指标。一次回复中已经说清的内容全部接收，不逐项重复追问',
      data_recording: '环节二：帮助学生明确测量工具、读数时间点和要记录的原始数据，并让记录表结构能够由这些信息确定',
      experiment_process: '环节三：帮助学生列出具体操作步骤、保持不变的条件和独立重复轮数。严格区分每组样本数与独立重复次数',
      expected_result: '环节四：最后请学生基于已有知识预测自变量变化时观测指标可能呈现的趋势，不替学生虚构结果或数值',
      plan_confirmation: '科学核心已完整；只请学生核对服务器组装的方案预览并使用页面按钮确认，不再提出新问题',
    };
    const id = readiness.nextFocusId;
    add(id, focusDescriptions[id]);
    return { allowedFocusIds: [id], focusDescriptions: descriptions };
  }
  if (stage === 3) {
    const id = input.triggerType === 'STAGE_ENTER'
      ? add('safety_checkpoint', '自然引导学生完成平台给出的确定性安全题')
      : add('execution_support', '围绕真实记录、异常和安全执行提供简短辅导');
    return { allowedFocusIds: [id], focusDescriptions: descriptions };
  }
  if (stage === 4) {
    const id = input.analysisAccepted
      ? add('interpret_evidence', '回应学生刚刚引用的真实数据，邀请其解释但不代写结论')
      : add('cite_evidence', '请学生引用表中真实数值完成一个具体比较');
    return { allowedFocusIds: [id], focusDescriptions: descriptions };
  }
  if (stage === 5) {
    const id = input.triggerType === 'REPORT_BOOTSTRAP'
      ? add('report_handoff', '说明平台已依据前序状态生成可核对框架，并指出仍需学生完成的内容')
      : add('report_gap', '只核对一个缺失或不一致处，不代写最终结论');
    return { allowedFocusIds: [id], focusDescriptions: descriptions };
  }
  const hasTeacherEvaluation = typeof stageData.stage5?.teacherScore === 'number'
    || Boolean(stageData.stage5?.teacherFeedback?.trim());
  const evaluationSource = hasTeacherEvaluation
    ? '只围绕已注入的教师评分与反馈'
    : '体验模式没有教师反馈，只围绕已注入的 AI 参考评价并明确其来源';
  return {
    allowedFocusIds: [add(
      'reflection_coaching',
      `${evaluationSource}或本次探究的学习收获，按学生当前问题一次只辅导一个反思任务。P4 已完成，现有分析只作为背景；不得要求重新引用单元格、重做数据比较或返回数据分析阶段`,
    )],
    focusDescriptions: descriptions,
  };
}

export function deterministicRisks(stageData: StageData): Stage2RiskAnnotation[] {
  const plan = stageData.stage2?.experimentPlan ?? stageData.stage2?.planDraft;
  if (!plan) return [];
  const text = [...plan.materials, ...plan.procedure, ...plan.safetyNotes].join('');
  const risks: Stage2RiskAnnotation[] = [];
  if (/加热|热水|火|灯/.test(text)) risks.push({ description: '涉及热源或光源时需由教师确认低温、低压和防烫措施。', severity: 'medium' });
  if (/玻璃|剪|刀/.test(text)) risks.push({ description: '易碎或尖锐器材需在教师指导下使用。', severity: 'medium' });
  if (/溶液|药品|粉末/.test(text)) risks.push({ description: '实验材料不得入口，接触后应洗手并保持通风。', severity: 'low' });
  if (risks.length === 0) risks.push({ description: '保持台面整洁，材料不得入口，异常时立即停止并告知教师。', severity: 'low' });
  return risks;
}

export function deterministicSafetyQuiz(stageData: StageData): SafetyQuiz & { correct: number } {
  const risks = deterministicRisks(stageData);
  const main = risks[0]?.description ?? '异常时立即停止并告知教师';
  return {
    question: `实验中出现异常情况时，哪种做法最符合本方案的安全要求？（提示：${main}）`,
    options: ['立即停止操作并告知教师', '继续完成本轮再处理', '自行更换更强的材料'],
    correct: 0,
  };
}

export function normalizedCellValue(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

export function isIndexColumn(key: string, title: string): boolean {
  return /^(?:trial|repeat|repeat_index|index|row_index)$/i.test(key)
    || /(?:重复|试验|实验)?序号|编号/.test(title);
}

export function containsCellValue(message: string, value: string): boolean {
  if (!value) return false;
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return message.includes(value);
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9.])${escaped}([^0-9.]|$)`).test(message);
}

/**
 * 「这句话有没有在做比较」的确定性兜底判定。
 *
 * 覆盖比较句式而不是枚举形容词：裸「比」只在构成比字比较句（比…高/低/多/少…）时才算，
 * 因此「比较认真」「比如」不再误命中；「大于/更强/超过/一样」这类此前漏判的写法全部纳入。
 * 语义判断本身不该由正则承担，这里只是兜底——正例/反例清单固定在 scripts/test-stage4-evidence.ts。
 */
export function expressesComparison(message: string): boolean {
  const text = message ?? '';
  if (!text) return false;
  // 比字比较句：「比」后 8 字内出现比较形容词。排除「比如」「比方说」「好比／打比方」，
  // 但「圆形比方形高」必须命中——不能因为它以「比方」开头就整句作废。
  if (/(?<![好打])比(?!如|方说)[^，。！？；、,.!?;\s]{0,8}(?:多|少|高|低|大|小|快|慢|强|弱|重|轻|长|短|好|差|久|远|近|深|浅)/.test(text)) return true;
  return /相比|对比|相较|比起|高于|低于|大于|小于|多于|少于|优于|劣于|快于|慢于|超过|不如|不及|领先|落后|等于|一样|持平|翻倍|倍|增加|减少|增大|减小|变大|变小|上升|下降|提高|降低|最多|最少|最高|最低|最大|最小|相同|不同|差异|差距|更[多少高低大小快慢强弱重轻长短好差]/.test(text);
}

function chineseRowNumber(index: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (index < 10) return digits[index];
  if (index === 10) return '十';
  if (index < 20) return `十${digits[index - 10]}`;
  if (index === 20) return '二十';
  return String(index);
}

export interface AnalysisCellEvidence {
  rowIndex: number;
  columnKey: string;
  columnName: string;
  citedValue: string;
  fingerprint: string;
}

/** 单元格证据指纹的唯一配方：确定性抽取与主张抽取器必须算出同一个值，否则去重会失效。 */
export function evidenceCellFingerprint(rowIndex: number, columnKey: string, citedValue: string): string {
  return contractHash('stage-contract-v3/evidence-cell/v1', { rowIndex, columnKey, citedValue });
}

export function columnAliases(key: string, title: string): string[] {
  return [...new Set([
    key,
    title,
    ...title.split(/[：:（(）)、/\s]+/).map((item) => item.trim()).filter((item) => item.length >= 2),
  ])];
}

function mentionsRow(studentMessage: string, oneBased: number): boolean {
  const rowNumber = `(?:${oneBased}|${chineseRowNumber(oneBased)})`;
  return new RegExp(
    `(?:第\\s*${rowNumber}\\s*(?:行|次(?:记录)?|轮)|重复\\s*${rowNumber}(?:\\s*(?:次|轮))?)`,
  ).test(studentMessage);
}

function evidenceCells(stageData: StageData, studentMessage: string): AnalysisCellEvidence[] {
  const rows = stageData.stage3?.rows ?? [];
  const columns = (stageData.stage2?.schema.columns ?? []).filter((column) => !isIndexColumn(column.key, column.title));
  const candidates = rows.flatMap((row, rowIndex) => columns.flatMap((column) => {
    const citedValue = normalizedCellValue(row[column.key]);
    if (!citedValue || !containsCellValue(studentMessage, citedValue)) return [];
    return [{ rowIndex, column, citedValue, row }];
  }));
  const valueFrequency = new Map<string, number>();
  for (const candidate of candidates) valueFrequency.set(candidate.citedValue, (valueFrequency.get(candidate.citedValue) ?? 0) + 1);

  // 逐格行约束：学生点名了哪几行，同一个取值就只归属那几行，不再因为列别名命中而记满整表。
  // 只对「能在被点名行里找到」的取值生效；点名行里没有的取值仍走原有歧义判定，避免制造新的死点。
  const mentionedRows = new Set(rows.map((_, rowIndex) => rowIndex).filter((rowIndex) => mentionsRow(studentMessage, rowIndex + 1)));
  const anchoredValues = new Set(
    candidates.filter((candidate) => mentionedRows.has(candidate.rowIndex)).map((candidate) => candidate.citedValue),
  );

  return candidates.flatMap(({ rowIndex, column, citedValue, row }) => {
    const rowMentioned = mentionedRows.has(rowIndex);
    if (anchoredValues.has(citedValue) && !rowMentioned) return [];
    const columnMentioned = columnAliases(column.key, column.title).some((alias) => studentMessage.includes(alias));
    const rowLabelMentioned = Object.entries(row).some(([key, value]) => (
      key !== column.key
      && !isIndexColumn(key, stageData.stage2?.schema.columns.find((item) => item.key === key)?.title ?? key)
      && normalizedCellValue(value).length > 0
      && normalizedCellValue(value).length <= 30
      && studentMessage.includes(normalizedCellValue(value))
    ));
    if ((valueFrequency.get(citedValue) ?? 0) > 1 && !rowMentioned && !columnMentioned && !rowLabelMentioned) return [];
    return [{
      rowIndex,
      columnKey: column.key,
      columnName: column.title,
      citedValue,
      fingerprint: evidenceCellFingerprint(rowIndex, column.key, citedValue),
    }];
  });
}

/**
 * 逐轮判定第四阶段的分析证据。纯函数。
 *
 * 第三参是经服务器核验后的模型主张（`validateAnalysisClaim` 的输出）：
 * - 引用：主张里还剩下至少一条通过核验的引用时以它为准（逐格精确，不吃列别名全表命中）；
 *   缺省或全被驳回时回落到确定性解析。
 * - 比较：两路取或。模型只可能把「这句话算不算比较」判得更宽，不可能让门禁比原先更严，
 *   因此不会追溯性地卡住按旧规则本可推进的学生。
 * 「引用的值必须真实存在于学生自己提交的行里」始终由服务器算，不因为有模型主张而放松。
 */
export function updateServerAnalysis(
  stageData: StageData,
  studentMessage: string,
  claim?: ValidatedAnalysisClaim | null,
): {
  stageData: StageData;
  accepted: boolean;
  duplicate: boolean;
  matchedValues: string[];
  rejection: Stage4RoundRejection | null;
  /** 分歧观测用：本轮的引用最终采信了哪一路，以及两路各自的判定。 */
  signals: {
    evidenceSource: 'extractor' | 'deterministic';
    deterministicEvidenceCount: number;
    deterministicComparison: boolean;
    claimEvidenceCount: number | null;
    claimComparison: boolean | null;
  };
} {
  const deterministicEvidence = evidenceCells(stageData, studentMessage);
  const claimCitations = claim?.citations ?? [];
  const useClaim = claimCitations.length > 0;
  const evidence = useClaim ? claimCitations : deterministicEvidence;
  const matchedValues = [...new Set(evidence.map((item) => item.citedValue))];
  const deterministicComparison = expressesComparison(studentMessage);
  const comparison = deterministicComparison || claim?.comparison === true;
  const signals = {
    evidenceSource: (useClaim ? 'extractor' : 'deterministic') as 'extractor' | 'deterministic',
    deterministicEvidenceCount: deterministicEvidence.length,
    deterministicComparison,
    claimEvidenceCount: claim ? claim.citations.length : null,
    claimComparison: claim ? claim.comparison : null,
  };
  const roundFingerprint = contractHash(
    'stage-contract-v3/evidence-round/v1',
    evidence.map((item) => item.fingerprint).sort(),
  );
  const previous = stageData.stage4 ?? { analysisCount: 0 };
  // 去重改为单调增量：本轮至少要包含一个此前从未计入过的单元格指纹。
  // 取值种类少的表（初中最常见）用整集合指纹会在第二轮必然撞车，那不是重复，是同一批数据的另一个切面。
  const seenCellFingerprints = new Set(
    (previous.evidenceRounds ?? []).flatMap((round) => (round.evidence ?? []).map((item) => item.fingerprint)),
  );
  const newEvidence = evidence.filter((item) => !seenCellFingerprints.has(item.fingerprint));
  const duplicate = evidence.length > 0 && newEvidence.length === 0;
  const accepted = evidence.length >= 2 && comparison && !duplicate;
  const rejection: Stage4RoundRejection | null = accepted
    ? null
    : evidence.length === 0
      ? 'NO_EVIDENCE'
      : evidence.length === 1
        ? 'SINGLE_EVIDENCE'
        : !comparison
          ? 'NO_COMPARISON'
          : 'NO_NEW_EVIDENCE';
  const lastRound = {
    accepted,
    ...(rejection ? { rejection } : {}),
    evidenceCount: evidence.length,
    newEvidenceCount: newEvidence.length,
    hasComparison: comparison,
    matchedValues,
  };
  if (!accepted) {
    return {
      accepted,
      duplicate,
      matchedValues,
      rejection,
      signals,
      stageData: { ...stageData, stage4: { ...previous, lastRound } },
    };
  }
  return {
    accepted,
    duplicate,
    matchedValues,
    rejection,
    signals,
    stageData: {
      ...stageData,
      stage4: {
        ...previous,
        analysisCount: previous.analysisCount + 1,
        lastRound,
        observations: [...(previous.observations ?? []), studentMessage],
        evidenceCitations: [...(previous.evidenceCitations ?? []), ...matchedValues],
        evidenceRounds: [...(previous.evidenceRounds ?? []), {
          observation: studentMessage,
          citations: evidence.map((item) => `第${item.rowIndex + 1}行「${item.columnName}」=${item.citedValue}`),
          matchedValues,
          evidence,
          roundFingerprint,
        }],
      },
    },
  };
}

export function attachServerOwnedArtifacts(input: {
  stage: number;
  stageData: StageData;
  triggerType: string;
  safetyQuizCompleted?: boolean;
}): { stageData: StageData; envelope: TutorServerEnvelope } {
  let stageData = input.stageData;
  const artifacts: TutorServerEnvelope['artifacts'] = {};
  let nextActionType: ChatResponse['next_action_type'] | undefined;
  let phaseComplete = false;

  if (input.stage === 1 && stageData.stage1?.confirmed) {
    artifacts.stage1_confirmed = true;
    artifacts.snapshot = stageData.stage1.snapshot;
    artifacts.theme_mapping = stageData.stage1.themeMapping;
    nextActionType = 'confirmation';
    phaseComplete = true;
  }

  if (input.stage === 2 && stageData.stage2?.planDraft && stageData.stage2.draftHash) {
    const plan = stageData.stage2.planDraft;
    artifacts.experiment_plan = plan;
    artifacts.stage2_plan_preview = { plan, draftHash: stageData.stage2.draftHash };
    artifacts.artifact_provenance = { experiment_plan: 'server_composed' };
    nextActionType = 'confirmation';
    phaseComplete = false;
  }

  if (input.stage === 3 && !input.safetyQuizCompleted && input.triggerType === 'STAGE_ENTER') {
    const quiz = deterministicSafetyQuiz(stageData);
    stageData = {
      ...stageData,
      stage3: {
        ...(stageData.stage3 ?? { rows: [] }),
        safetyQuiz: {
          question: quiz.question,
          options: quiz.options,
          passed: stageData.stage3?.safetyQuiz?.passed ?? false,
        },
      },
    };
    artifacts.safety_quiz = { question: quiz.question, options: quiz.options };
    nextActionType = 'info';
  }

  if (input.stage === 5 && input.triggerType === 'REPORT_BOOTSTRAP') {
    const sections = composeReportSections({ stageData });
    if (sections) {
      stageData = {
        ...stageData,
        stage5: {
          submitted: stageData.stage5?.submitted ?? false,
          approved: stageData.stage5?.approved ?? null,
          teacherFeedback: stageData.stage5?.teacherFeedback,
          sections: {
            ...sections,
            conclusion: stageData.stage5?.sections?.conclusion ?? '',
            limitationsDiscussion: stageData.stage5?.sections?.limitationsDiscussion ?? stageData.stage5?.sections?.reflection ?? '',
            reflection: stageData.stage5?.sections?.limitationsDiscussion ?? stageData.stage5?.sections?.reflection ?? '',
          },
        },
      };
      artifacts.report_sections = sections;
      artifacts.artifact_provenance = { ...(artifacts.artifact_provenance ?? {}), report_sections: 'server_composed' };
      nextActionType = 'info';
    }
  }

  return { stageData, envelope: { nextActionType, phaseComplete, artifacts } };
}

export function visibleDataRows(stageData: StageData): Array<Record<string, unknown>> {
  const rows = stageData.stage3?.rows ?? [];
  const columns = stageData.stage2?.schema.columns ?? [];
  return rows.map((row, index) => Object.fromEntries([
    ['行号', index + 1],
    ...columns.map((column) => [column.title, row[column.key]] as const),
  ]));
}
