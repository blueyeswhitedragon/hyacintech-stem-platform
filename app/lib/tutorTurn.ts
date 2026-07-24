import { v4 as uuidv4 } from 'uuid';
import { db } from '@/app/lib/db';
import type { ConversationForUser } from '@/app/lib/conversation';
import type { RuntimeModelIdentity } from '@/app/lib/modelRegistry';
import type { ChatResponse, Message } from '@/app/models/types';
import type { StageData } from '@/app/models/stageData';
import type { StageTriggerType } from '@/app/lib/stageContract';
import {
  buildTutorLanguagePrompt,
  buildTutorVisibleState,
  callTutorLanguageWithTrace,
  TUTOR_LANGUAGE_CONTRACT_VERSION,
  TUTOR_SEMANTIC_VALIDATOR_VERSION,
  TUTOR_LANGUAGE_PROMPT_VERSIONS,
  type TutorLanguagePromptVersion,
  toCompatibleChatResponse,
} from '@/app/lib/tutorLanguage';
import {
  applyDeterministicExtractionFallbacks,
  callStudentFactExtractor,
  EXTRACTOR_PROMPT_VERSION,
  EXTRACTOR_VERSION,
  mergeExtractedFacts,
} from '@/app/lib/stateExtractor';
import {
  attachServerOwnedArtifacts,
  tutorFocusPlan,
  updateServerAnalysis,
  visibleDataRows,
} from '@/app/lib/serverTutorState';
import { STAGE_CONTRACT_VERSION } from '@/app/lib/stageContract';
import { finalizeStageData } from '@/app/lib/stageState';
import { evaluateStage2Readiness } from '@/app/lib/stage2Readiness';

export function resolveChatContractBranch(conversationContract: string, modelContract: string): 'TUTOR_LANGUAGE_V1' | 'LEGACY_STAGE_CONTRACT' {
  if (conversationContract === TUTOR_LANGUAGE_CONTRACT_VERSION && modelContract === TUTOR_LANGUAGE_CONTRACT_VERSION) return 'TUTOR_LANGUAGE_V1';
  if (conversationContract !== TUTOR_LANGUAGE_CONTRACT_VERSION && modelContract !== TUTOR_LANGUAGE_CONTRACT_VERSION) return 'LEGACY_STAGE_CONTRACT';
  throw new Error(conversationContract === TUTOR_LANGUAGE_CONTRACT_VERSION
    ? '新会话必须使用 tutor-language-v1 模型合同'
    : '历史会话不能切换到新的 Tutor 合同，请继续使用已固定模型');
}

export interface NewTutorTurnResult {
  response: ChatResponse;
  stageData: StageData;
  userMessage: Message;
  assistantMessage: Message;
  systemPrompt: string;
  systemPromptTemplate: string;
  generationParams: Record<string, unknown>;
  contractCheck: Record<string, unknown>;
}

export interface NewTutorSystemTurnResult {
  response: ChatResponse;
  stageData: StageData;
  systemPrompt: string;
  systemPromptTemplate: string;
  generationParams: Record<string, unknown>;
  contractCheck: Record<string, unknown>;
}

function triggerForTurn(stage: number, conv: ConversationForUser): StageTriggerType {
  if (stage === 3 && !conv.safetyQuizCompleted) return 'STAGE_ENTER';
  if (stage === 5 && !conv.stageData.stage5?.sections) return 'REPORT_BOOTSTRAP';
  if (stage === 6) return 'OPTIONAL_COACHING';
  return 'USER_MESSAGE';
}

function pinnedPromptVersion(identity: RuntimeModelIdentity): TutorLanguagePromptVersion {
  if (!TUTOR_LANGUAGE_PROMPT_VERSIONS.includes(identity.promptPolicyVersion as TutorLanguagePromptVersion)) {
    throw new Error(`会话固定的 Prompt 版本不受支持：${identity.promptPolicyVersion}`);
  }
  return identity.promptPolicyVersion as TutorLanguagePromptVersion;
}

function visibleFacts(stage: number, stageData: StageData, conv: ConversationForUser) {
  if (stage === 4) {
    return {
      研究方案: stageData.stage2?.experimentPlan,
      数据记录: visibleDataRows(stageData),
      已接受分析次数: stageData.stage4?.analysisCount ?? 0,
    };
  }
  return buildTutorVisibleState(stage, stageData, {
    作业限定方向: conv.topicDirection,
  });
}

async function recordExtraction(input: {
  conversationId: string;
  userMessageId: string;
  stage: number;
  sourceMessages: string[];
  result?: Awaited<ReturnType<typeof callStudentFactExtractor>>;
  failureContext?: Record<string, unknown>;
  error?: unknown;
}) {
  await db.stateExtractionTrace.create({
    data: {
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      stage: input.stage,
      extractorVersion: EXTRACTOR_VERSION,
      providerSnapshot: input.result?.provider ?? process.env.EXTRACTOR_LLM_PROVIDER ?? '',
      externalModelSnapshot: input.result?.model ?? process.env.EXTRACTOR_LLM_MODEL ?? '',
      modelFamily: input.result?.modelFamily ?? '',
      promptVersion: EXTRACTOR_PROMPT_VERSION,
      promptSha256: input.result?.promptSha256 ?? '',
      sourceMessagesJson: JSON.stringify(input.sourceMessages),
      rawOutput: input.result?.rawOutput ?? '',
      validatedFactsJson: JSON.stringify(input.result?.accepted ?? []),
      rejectedFactsJson: JSON.stringify(input.result?.rejected ?? []),
      generationParamsJson: JSON.stringify(input.result?.generationParams ?? input.failureContext ?? {}),
      status: input.error ? 'FAILED' : 'SUCCEEDED',
      failureReason: input.error instanceof Error ? input.error.message : input.error ? String(input.error) : '',
    },
  });
}

export async function runNewTutorTurn(input: {
  conversationId: string;
  message: string;
  conv: ConversationForUser;
  modelIdentity: RuntimeModelIdentity;
}): Promise<NewTutorTurnResult> {
  const stage = input.conv.currentStage;
  const triggerType = triggerForTurn(stage, input.conv);
  const promptVersion = pinnedPromptVersion(input.modelIdentity);
  const userMessage: Message = { id: uuidv4(), role: 'user', content: input.message, status: 'sent' };
  const sources = [input.message];
  let stageData = input.conv.stageData;
  let extractionSummary: Record<string, unknown> = { skipped: ![1, 2].includes(stage) };

  if ([1, 2].includes(stage)) {
    const expectedFocus = tutorFocusPlan(stage, stageData, { triggerType }).allowedFocusIds[0];
    const readinessBefore = stage === 2 ? evaluateStage2Readiness(stageData) : undefined;
    try {
      const extraction = await callStudentFactExtractor({
        stage,
        studentMessages: sources,
        expectedFocusId: expectedFocus,
        existingFacts: stageData.extractedFacts,
      });
      const merged = mergeExtractedFacts(stage, stageData, extraction.accepted, {
        currentStudentMessage: input.message,
        messageId: userMessage.id,
        expectedFocusId: expectedFocus,
      });
      stageData = merged.stageData;
      const readinessAfter = stage === 2 ? evaluateStage2Readiness(stageData) : undefined;
      const extractionResult = {
        ...extraction,
        generationParams: {
          ...extraction.generationParams,
          completedFieldsBefore: readinessBefore?.completedFields,
          completedFieldsAfter: readinessAfter?.completedFields,
          serverCompositionVersion: stageData.stage2?.planDraft ? readinessAfter?.policyVersion : undefined,
        },
      };
      extractionSummary = {
        version: EXTRACTOR_VERSION,
        accepted: extractionResult.accepted.length,
        rejected: extractionResult.rejected.length,
        modelFamily: extractionResult.modelFamily,
        expectedFocus,
        deterministicFallbacks: extractionResult.deterministicFallbacks,
        completedFieldsBefore: readinessBefore?.completedFields,
        completedFieldsAfter: readinessAfter?.completedFields,
      };
      await recordExtraction({
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        stage,
        sourceMessages: sources,
        result: extractionResult,
      });
    } catch (error) {
      const deterministic = applyDeterministicExtractionFallbacks(stage, [], input.message, { expectedFocusId: expectedFocus });
      if (deterministic.accepted.length > 0) {
        stageData = mergeExtractedFacts(stage, stageData, deterministic.accepted, {
          currentStudentMessage: input.message,
          messageId: userMessage.id,
          expectedFocusId: expectedFocus,
        }).stageData;
      }
      const readinessAfter = stage === 2 ? evaluateStage2Readiness(stageData) : undefined;
      extractionSummary = {
        version: EXTRACTOR_VERSION,
        failed: true,
        reason: error instanceof Error ? error.message : String(error),
        expectedFocus,
        deterministicFallbacks: deterministic.fallbacks,
        completedFieldsBefore: readinessBefore?.completedFields,
        completedFieldsAfter: readinessAfter?.completedFields,
      };
      await recordExtraction({
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        stage,
        sourceMessages: sources,
        failureContext: extractionSummary,
        error,
      });
    }
  }

  let analysisAccepted = false;
  if (stage === 4) {
    const analysis = updateServerAnalysis(stageData, input.message);
    stageData = analysis.stageData;
    analysisAccepted = analysis.accepted;
  }

  const server = attachServerOwnedArtifacts({
    stage,
    stageData,
    triggerType,
    safetyQuizCompleted: input.conv.safetyQuizCompleted,
  });
  stageData = server.stageData;
  stageData = {
    ...stageData,
    roundCounts: {
      ...(stageData.roundCounts ?? {}),
      [stage]: (stageData.roundCounts?.[stage] ?? 0) + 1,
    },
  };
  const serverArtifactTypes = Object.keys(server.envelope.artifacts ?? {});
  stageData = finalizeStageData(input.conv.stageData, stageData, {
    mutation: `TUTOR_${triggerType}`,
    promptPolicyVersion: promptVersion,
    serverArtifactTypes,
  });
  const focus = tutorFocusPlan(stage, stageData, { triggerType, analysisAccepted });
  const stage2Readiness = stage === 2 ? evaluateStage2Readiness(stageData) : undefined;
  const tutorInput = {
    phase: stage,
    triggerType,
    currentStudentMessage: input.message,
    priorStudentMessages: input.conv.messages.filter((item) => item.role === 'user').map((item) => item.content),
    tutorHistory: input.conv.messages.filter((item) => item.role === 'assistant' && !item.messageType).map((item) => item.content),
    visibleFacts: visibleFacts(stage, stageData, input.conv),
    allowedFocusIds: focus.allowedFocusIds,
    focusDescriptions: focus.focusDescriptions,
    completedFocusIds: stage2Readiness?.completedFields,
    planReady: stage2Readiness?.complete,
  };
  const tutor = await callTutorLanguageWithTrace(tutorInput, {
    provider: input.modelIdentity.provider,
    model: input.modelIdentity.externalModelId,
  }, promptVersion);
  const response = toCompatibleChatResponse(tutor.response, server.envelope);
  const assistantMessage: Message = {
    id: uuidv4(),
    role: 'assistant',
    content: response.dialogue,
    hints: response.hints,
    actionType: response.next_action_type,
    phaseComplete: response.phase_complete,
  };
  const systemPromptTemplate = buildTutorLanguagePrompt({
    phase: stage,
    triggerType,
    visibleFacts: {},
    allowedFocusIds: focus.allowedFocusIds,
    focusDescriptions: focus.focusDescriptions,
  }, promptVersion);
  return {
    response,
    stageData,
    userMessage,
    assistantMessage,
    systemPrompt: buildTutorLanguagePrompt(tutorInput, promptVersion),
    systemPromptTemplate,
    generationParams: tutor.generationParams,
    contractCheck: {
      ok: true,
      contractVersion: TUTOR_LANGUAGE_CONTRACT_VERSION,
      stageContractVersion: STAGE_CONTRACT_VERSION,
      promptPolicyVersion: promptVersion,
      extractorVersion: EXTRACTOR_VERSION,
      extractorPromptVersion: EXTRACTOR_PROMPT_VERSION,
      allowedFocusIds: focus.allowedFocusIds,
      chosenFocus: tutor.response.focus,
      interactionType: tutor.response.interactionType,
      completedFocusIds: stage2Readiness?.completedFields,
      planReady: stage2Readiness?.complete,
      validatorPolicyVersion: TUTOR_SEMANTIC_VALIDATOR_VERSION,
      attempts: tutor.attempts,
      extractor: extractionSummary,
      stateRevision: stageData.contractMeta?.revision,
      stateHash: stageData.contractMeta?.stateHash,
      serverArtifacts: serverArtifactTypes,
    },
  };
}

export async function runNewTutorSystemTurn(input: {
  stage: number;
  triggerType: Extract<StageTriggerType, 'STAGE_ENTER' | 'STAGE_TRANSITION' | 'REPORT_BOOTSTRAP'>;
  stageData: StageData;
  messages: Message[];
  modelIdentity: RuntimeModelIdentity;
  priorSummary?: string;
  safetyQuizCompleted?: boolean;
}): Promise<NewTutorSystemTurnResult> {
  const promptVersion = pinnedPromptVersion(input.modelIdentity);
  const server = attachServerOwnedArtifacts({
    stage: input.stage,
    stageData: input.stageData,
    triggerType: input.triggerType,
    safetyQuizCompleted: input.safetyQuizCompleted,
  });
  const stageData = finalizeStageData(input.stageData, server.stageData, {
    mutation: `TUTOR_${input.triggerType}`,
    promptPolicyVersion: promptVersion,
    serverArtifactTypes: Object.keys(server.envelope.artifacts ?? {}),
  });
  const focus = tutorFocusPlan(input.stage, stageData, { triggerType: input.triggerType });
  const stage2Readiness = input.stage === 2 ? evaluateStage2Readiness(stageData) : undefined;
  const tutorInput = {
    phase: input.stage,
    triggerType: input.triggerType,
    currentStudentMessage: '',
    priorStudentMessages: input.messages.filter((item) => item.role === 'user').map((item) => item.content),
    tutorHistory: input.messages.filter((item) => item.role === 'assistant' && !item.messageType).map((item) => item.content),
    visibleFacts: input.stage === 4
      ? {
          研究方案: stageData.stage2?.experimentPlan,
          数据记录: visibleDataRows(stageData),
          已接受分析次数: stageData.stage4?.analysisCount ?? 0,
        }
      : buildTutorVisibleState(input.stage, stageData, { 前序摘要: input.priorSummary }),
    allowedFocusIds: focus.allowedFocusIds,
    focusDescriptions: focus.focusDescriptions,
    completedFocusIds: stage2Readiness?.completedFields,
    planReady: stage2Readiness?.complete,
  };
  const tutor = await callTutorLanguageWithTrace(tutorInput, {
    provider: input.modelIdentity.provider,
    model: input.modelIdentity.externalModelId,
  }, promptVersion);
  return {
    response: toCompatibleChatResponse(tutor.response, server.envelope),
    stageData,
    systemPrompt: buildTutorLanguagePrompt(tutorInput, promptVersion),
    systemPromptTemplate: buildTutorLanguagePrompt({
      phase: input.stage,
      triggerType: input.triggerType,
      visibleFacts: {},
      allowedFocusIds: focus.allowedFocusIds,
      focusDescriptions: focus.focusDescriptions,
    }, promptVersion),
    generationParams: tutor.generationParams,
    contractCheck: {
      ok: true,
      contractVersion: TUTOR_LANGUAGE_CONTRACT_VERSION,
      stageContractVersion: STAGE_CONTRACT_VERSION,
      promptPolicyVersion: promptVersion,
      extractorVersion: EXTRACTOR_VERSION,
      extractorPromptVersion: EXTRACTOR_PROMPT_VERSION,
      allowedFocusIds: focus.allowedFocusIds,
      chosenFocus: tutor.response.focus,
      interactionType: tutor.response.interactionType,
      completedFocusIds: stage2Readiness?.completedFields,
      planReady: stage2Readiness?.complete,
      validatorPolicyVersion: TUTOR_SEMANTIC_VALIDATOR_VERSION,
      attempts: tutor.attempts,
      systemTransition: true,
      stateRevision: stageData.contractMeta?.revision,
      stateHash: stageData.contractMeta?.stateHash,
      serverArtifacts: Object.keys(server.envelope.artifacts ?? {}),
    },
  };
}
