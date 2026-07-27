import { PHASE_META } from '@/app/lib/dataLab/types';
import { parseJson } from '@/app/lib/dataLab/validation';
import {
  DATA_LAB_STATUS_LABELS,
  EDIT_TYPE_LABELS,
  TRAINING_ELIGIBILITY_LABELS,
  TRIGGER_TYPE_LABELS,
  TUTOR_FOCUS_LABELS,
  TUTOR_INTERACTION_META,
  gateFailureLabel,
} from '@/app/lib/dataLab/labels';
import { isSystemTriggeredTurn } from '@/app/lib/stageContract';
import type { TutorLanguageResponse } from '@/app/lib/tutorLanguage';

type HistoryTurn = { role: 'user' | 'assistant'; content: string };

export interface TrialReviewInput {
  caseId: string;
  phase: number;
  triggerType: string;
  caseStatus: string;
  topicTitle: string | null;
  historyJson: string;
  studentMessage: string;
  finalizedTurn: {
    finalOutputJson: string;
    reviewerEditMetricsJson: string;
    trainingEligibility: string;
    eligibilityReasonJson: string;
    contentSha256: string;
  } | null;
  directConfirmed?: boolean;
}

export interface TrialReviewRow {
  index: number;
  caseId: string;
  phase: number;
  triggerType: string;
  caseStatus: string;
  topicTitle: string;
  historyTurns: number;
  studentMessage: string;
  history: HistoryTurn[];
  focus: string;
  interactionType: string;
  dialogue: string;
  hints: string[];
  reviewerEditType: string;
  directConfirmed: boolean | null;
  trainingEligibility: string;
  eligibilityReasons: string[];
  contentSha256: string;
  finalOutputJson: string;
  hasFinalizedTurn: boolean;
}

export interface TrialReviewMeta {
  runId: string;
  distributionCurrent: boolean;
  metrics: Record<string, number>;
  failures: string[];
}

interface ReviewOutput {
  dialogue: string;
  interactionType: string;
  focus: string;
  hints: string[];
  finalOutputJson: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function history(value: string): HistoryTurn[] {
  return parseJson<unknown[]>(value, []).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const turn = item as Partial<HistoryTurn>;
    return (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' ? [{ role: turn.role, content: turn.content }] : [];
  });
}

function reviewOutput(value: string): ReviewOutput {
  const parsed = parseJson<Partial<TutorLanguageResponse> | null>(value, null);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.dialogue !== 'string' || typeof parsed.interactionType !== 'string' || typeof parsed.focus !== 'string') {
    return { dialogue: '', interactionType: '', focus: '', hints: [], finalOutputJson: '' };
  }
  return {
    dialogue: parsed.dialogue,
    interactionType: parsed.interactionType,
    focus: parsed.focus,
    hints: strings(parsed.hints),
    finalOutputJson: value,
  };
}

function codeAndLabel(code: string, labels: Record<string, string>) {
  const label = labels[code] ?? code;
  return { code, label, display: code ? `${code}（${label}）` : '' };
}

function phaseMeta(phase: number) {
  const label = PHASE_META[phase]?.label ?? `阶段 ${phase}`;
  return { code: `P${phase}`, label, display: `P${phase}（${label}）` };
}

export function buildTrialReviewRows(input: TrialReviewInput[]): TrialReviewRow[] {
  return [...input]
    .sort((left, right) => left.phase - right.phase || left.triggerType.localeCompare(right.triggerType) || left.caseId.localeCompare(right.caseId))
    .map((item, index) => {
      const parsedHistory = history(item.historyJson);
      const finalized = item.finalizedTurn;
      const output = finalized ? reviewOutput(finalized.finalOutputJson) : { dialogue: '', interactionType: '', focus: '', hints: [], finalOutputJson: '' };
      const reviewerEditType = finalized ? parseJson<{ type?: unknown }>(finalized.reviewerEditMetricsJson, {}).type : '';
      return {
        index: index + 1,
        caseId: item.caseId,
        phase: item.phase,
        triggerType: item.triggerType,
        caseStatus: item.caseStatus,
        topicTitle: item.topicTitle ?? '',
        historyTurns: parsedHistory.length,
        studentMessage: item.studentMessage,
        history: parsedHistory,
        focus: output.focus,
        interactionType: output.interactionType,
        dialogue: output.dialogue,
        hints: output.hints,
        reviewerEditType: typeof reviewerEditType === 'string' ? reviewerEditType : '',
        directConfirmed: finalized ? item.directConfirmed === true : null,
        trainingEligibility: finalized?.trainingEligibility ?? '',
        eligibilityReasons: finalized ? strings(parseJson<unknown>(finalized.eligibilityReasonJson, [])) : [],
        contentSha256: finalized?.contentSha256 ?? '',
        finalOutputJson: output.finalOutputJson,
        hasFinalizedTurn: Boolean(finalized),
      };
    });
}

export function trialReviewShareGpt(rows: TrialReviewRow[], meta: TrialReviewMeta): string {
  const records = rows.map((row) => {
    const trigger = codeAndLabel(row.triggerType, TRIGGER_TYPE_LABELS);
    const caseStatus = codeAndLabel(row.caseStatus, DATA_LAB_STATUS_LABELS);
    const interactionType = codeAndLabel(row.interactionType, Object.fromEntries(Object.entries(TUTOR_INTERACTION_META).map(([code, value]) => [code, value.label])));
    const focus = codeAndLabel(row.focus, TUTOR_FOCUS_LABELS);
    const reviewerEditType = codeAndLabel(row.reviewerEditType, EDIT_TYPE_LABELS);
    const trainingEligibility = codeAndLabel(row.trainingEligibility, TRAINING_ELIGIBILITY_LABELS);
    const conversations: Array<{ from: 'system' | 'human' | 'gpt'; value: string }> = row.history.map((turn) => ({ from: turn.role === 'user' ? 'human' : 'gpt', value: turn.content }));
    if (isSystemTriggeredTurn(row.triggerType)) {
      conversations.push({ from: 'system', value: `${trigger.display}：平台状态变化触发本回合；这不是学生消息。` });
    } else {
      conversations.push({ from: 'human', value: row.studentMessage });
    }
    if (row.finalOutputJson) conversations.push({ from: 'gpt', value: row.finalOutputJson });
    return {
      id: `trial36-review-${row.caseId}`,
      phase: row.phase,
      scenario: row.topicTitle || '未命名话题',
      conversations,
      meta: {
        schemaVersion: 4,
        sourceKind: 'trial_36_review',
        trialReview: {
          index: row.index,
          caseId: row.caseId,
          batch: {
            runId: meta.runId,
            distributionCurrent: meta.distributionCurrent,
            metrics: meta.metrics,
            failures: meta.failures.map((code) => ({ code, label: gateFailureLabel(code) })),
          },
          phase: phaseMeta(row.phase),
          triggerType: trigger,
          caseStatus,
          topicTitle: row.topicTitle,
          historyTurns: row.historyTurns,
          studentMessage: row.studentMessage,
          finalized: row.hasFinalizedTurn,
          tutorOutput: {
            dialogue: row.dialogue,
            interactionType,
            focus,
            hints: row.hints,
          },
          reviewerEditType,
          directConfirmed: row.directConfirmed,
          trainingEligibility,
          eligibilityReasons: row.eligibilityReasons,
          contentSha256: row.contentSha256,
        },
      },
    };
  });
  return `${JSON.stringify(records, null, 2)}\n`;
}
