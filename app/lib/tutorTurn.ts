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
  toCompatibleChatResponse,
} from '@/app/lib/tutorLanguage';
import {
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
  advanceTo?: number;
  userMessage: Message;
  assistantMessage: Message;
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

function studentMessages(history: Message[], current: string): string[] {
  return [...history.filter((item) => item.role === 'user').map((item) => item.content), current];
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
      generationParamsJson: JSON.stringify(input.result?.generationParams ?? {}),
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
  const userMessage: Message = { id: uuidv4(), role: 'user', content: input.message, status: 'sent' };
  const sources = studentMessages(input.conv.messages, input.message);
  let stageData = input.conv.stageData;
  let advanceTo: number | undefined;
  let extractionSummary: Record<string, unknown> = { skipped: ![1, 2].includes(stage) };

  if ([1, 2].includes(stage)) {
    try {
      const extraction = await callStudentFactExtractor({ stage, studentMessages: sources });
      const merged = mergeExtractedFacts(stage, stageData, extraction.accepted);
      stageData = merged.stageData;
      advanceTo = merged.advanceTo;
      extractionSummary = {
        version: EXTRACTOR_VERSION,
        accepted: extraction.accepted.length,
        rejected: extraction.rejected.length,
        modelFamily: extraction.modelFamily,
      };
      await recordExtraction({
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        stage,
        sourceMessages: sources,
        result: extraction,
      });
    } catch (error) {
      extractionSummary = { version: EXTRACTOR_VERSION, failed: true, reason: error instanceof Error ? error.message : String(error) };
      await recordExtraction({
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        stage,
        sourceMessages: sources,
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
  const focus = tutorFocusPlan(stage, stageData, { triggerType, analysisAccepted });
  const tutorInput = {
    phase: stage,
    triggerType,
    currentStudentMessage: input.message,
    priorStudentMessages: input.conv.messages.filter((item) => item.role === 'user').map((item) => item.content),
    tutorHistory: input.conv.messages.filter((item) => item.role === 'assistant' && !item.messageType).map((item) => item.content),
    visibleFacts: visibleFacts(stage, stageData, input.conv),
    allowedFocusIds: focus.allowedFocusIds,
    focusDescriptions: focus.focusDescriptions,
  };
  const tutor = await callTutorLanguageWithTrace(tutorInput, {
    provider: input.modelIdentity.provider,
    model: input.modelIdentity.externalModelId,
  });
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
  });
  return {
    response,
    stageData,
    advanceTo,
    userMessage,
    assistantMessage,
    systemPrompt: buildTutorLanguagePrompt(tutorInput),
    systemPromptTemplate,
    generationParams: tutor.generationParams,
    contractCheck: {
      ok: true,
      contractVersion: TUTOR_LANGUAGE_CONTRACT_VERSION,
      focus: tutor.response.focus,
      attempts: tutor.attempts,
      extractor: extractionSummary,
      serverArtifacts: Object.keys(server.envelope.artifacts ?? {}),
    },
  };
}
