import { createHash } from 'crypto';
import type { Stage1Data, Stage2ExperimentPlan, StageData } from '@/app/models/stageData';
import {
  STAGE_CONTRACT_VERSION,
  STUDENT_FACT_EXTRACTOR_VERSION,
} from '@/app/lib/contractVersions';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function stableStageJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function contractHash(namespace: string, value: unknown): string {
  return createHash('sha256').update(`${namespace}\n${stableStageJson(value)}`).digest('hex');
}

export function normalizeResearchQuestion(value: string): string {
  return value.trim().replace(/\s+/g, '').replace(/[?？。！!]$/g, '');
}

export function researchQuestionHash(question: string): string {
  return contractHash('stage-contract-v3/research-question/v1', normalizeResearchQuestion(question));
}

export function stage2DraftHash(plan: Stage2ExperimentPlan): string {
  return contractHash('stage-contract-v3/stage2-plan/v1', plan);
}

function statePayload(stageData: StageData): Omit<StageData, 'contractMeta'> {
  const payload = { ...stageData };
  delete payload.contractMeta;
  return payload;
}

export function stageStateHash(stageData: StageData): string {
  return contractHash('stage-contract-v3/state/v1', statePayload(stageData));
}

/** Remove server-only answer keys before stage data crosses a student-facing boundary. */
export function studentVisibleStageData(stageData: StageData): StageData {
  const quiz = stageData.stage3?.safetyQuiz;
  if (!quiz || quiz.correct === undefined) return stageData;
  return {
    ...stageData,
    stage3: {
      ...stageData.stage3!,
      safetyQuiz: {
        question: quiz.question,
        options: quiz.options,
        selected: quiz.selected,
        passed: quiz.passed,
      },
    },
  };
}

export function finalizeStageData(
  previous: StageData,
  next: StageData,
  input: {
    mutation: string;
    promptPolicyVersion?: string;
    serverArtifactTypes?: string[];
  },
): StageData {
  const payload = statePayload(next);
  const changed = stableStageJson(statePayload(previous)) !== stableStageJson(payload);
  const previousRevision = previous.contractMeta?.revision ?? 0;
  const revision = changed || !previous.contractMeta ? previousRevision + 1 : previousRevision;
  const result: StageData = {
    ...payload,
    contractMeta: {
      stageContractVersion: STAGE_CONTRACT_VERSION,
      extractorVersion: STUDENT_FACT_EXTRACTOR_VERSION,
      revision,
      stateHash: stageStateHash(payload),
      lastMutation: input.mutation,
      promptPolicyVersion: input.promptPolicyVersion ?? previous.contractMeta?.promptPolicyVersion,
      serverArtifactTypes: input.serverArtifactTypes ?? previous.contractMeta?.serverArtifactTypes,
    },
  };
  return result;
}

export function canonicalResearchQuestion(stageData: StageData): string {
  return stageData.stage1?.researchQuestion?.trim()
    || stageData.stage1?.themeMapping?.researchQuestion?.trim()
    || String(stageData.extractedFacts?.['stage1.researchQuestion']?.value ?? '').trim();
}

function legacyStage1(stageData: StageData): Stage1Data | undefined {
  const question = canonicalResearchQuestion(stageData);
  if (!question) return stageData.stage1;
  const existing = stageData.stage1;
  const ledgerConfirmed = stageData.extractedFacts?.['stage1.confirmed']?.value === true;
  const questionHash = researchQuestionHash(question);
  const confirmationHashMatches = existing?.confirmedQuestionHash === undefined
    || existing.confirmedQuestionHash === questionHash;
  const confirmed = (existing?.confirmed === true || ledgerConfirmed) && confirmationHashMatches;
  const sourceQuote = existing?.confirmationSource?.sourceQuote
    || stageData.extractedFacts?.['stage1.confirmed']?.sourceQuote
    || (confirmed ? '历史会话已确认' : '');
  const snapshot = confirmed
    ? ['《探究问题确认书》', `研究问题：${question}`].join('\n')
    : existing?.snapshot ?? '';
  return {
    confirmed,
    snapshot,
    researchQuestion: question,
    confirmedQuestionHash: confirmed ? questionHash : undefined,
    confirmationSource: confirmed ? {
      type: existing?.confirmationSource?.type ?? 'legacy_recovery',
      sourceQuote,
      messageId: existing?.confirmationSource?.messageId,
    } : undefined,
    themeMapping: existing?.themeMapping,
    factorDirection: existing?.factorDirection,
    phenomenonDirection: existing?.phenomenonDirection,
    variables: existing?.variables,
  };
}

/** Hydrate recoverable old JSON without mutating the database during a read. */
export function recoverStageDataV3(input: StageData): { stageData: StageData; recovered: boolean } {
  let stageData: StageData = { ...input };
  const nextStage1 = legacyStage1(stageData);
  if (nextStage1) stageData = { ...stageData, stage1: nextStage1 };

  const previousStage2 = stageData.stage2;
  if (previousStage2?.experimentPlan) {
    const hash = stage2DraftHash(previousStage2.experimentPlan);
    stageData = {
      ...stageData,
      stage2: {
        ...previousStage2,
        planDraft: previousStage2.planDraft ?? previousStage2.experimentPlan,
        draftHash: previousStage2.draftHash ?? hash,
        confirmedPlanHash: previousStage2.confirmedPlanHash
          ?? (previousStage2.factsConfirmed || previousStage2.schema?.columns?.length ? hash : undefined),
        confirmationSource: previousStage2.confirmationSource
          ?? (previousStage2.factsConfirmed || previousStage2.schema?.columns?.length
            ? { type: 'legacy_recovery', confirmedAt: 'legacy' }
            : undefined),
      },
    };
  }

  const payloadChanged = stableStageJson(statePayload(input)) !== stableStageJson(statePayload(stageData));
  const metaStale = input.contractMeta?.stageContractVersion !== STAGE_CONTRACT_VERSION
    || input.contractMeta?.extractorVersion !== STUDENT_FACT_EXTRACTOR_VERSION
    || input.contractMeta?.stateHash !== stageStateHash(stageData);
  if (payloadChanged || metaStale) {
    stageData = finalizeStageData(input, stageData, { mutation: 'LEGACY_RECOVERY' });
  }
  return { stageData, recovered: payloadChanged || metaStale };
}
