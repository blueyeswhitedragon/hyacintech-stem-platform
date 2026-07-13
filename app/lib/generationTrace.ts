import type { ChatResponse, Message } from '@/app/models/types';
import type { StageData } from '@/app/models/stageData';
import { db } from '@/app/lib/db';
import { sha256 } from '@/app/lib/dataLab/validation';
import type { RuntimeModelIdentity } from '@/app/lib/modelRegistry';

export interface GenerationTraceInput {
  conversationId: string;
  studentAssignmentId: string;
  currentStage: number;
  nextStage: number;
  updatedMessages: Message[];
  stageData: StageData;
  stageDataChanged: boolean;
  userMessageId: string;
  assistantMessageId: string;
  userMessage: string;
  systemPrompt: string;
  response: ChatResponse;
  modelVersionId: string;
  modelIdentity: RuntimeModelIdentity;
  styleFamily: string;
  stylePolicyVersion: string;
  generationParams: Record<string, unknown>;
  contractCheck: Record<string, unknown>;
}

export function buildGenerationTraceData(input: GenerationTraceInput) {
  const responseJson = JSON.stringify(input.response);
  return {
    conversationId: input.conversationId,
    assistantMessageId: input.assistantMessageId,
    userMessageId: input.userMessageId,
    stage: input.currentStage,
    modelVersionId: input.modelVersionId,
    modelTagSnapshot: input.modelIdentity.tag,
    providerSnapshot: input.modelIdentity.provider,
    externalModelSnapshot: input.modelIdentity.externalModelId,
    promptVersion: input.modelIdentity.promptPolicyVersion,
    promptSha256: sha256(input.systemPrompt),
    styleFamily: input.styleFamily,
    stylePolicyVersion: input.stylePolicyVersion,
    requestMessageSha256: sha256(input.userMessage),
    responseJson,
    responseSha256: sha256(responseJson),
    generationParamsJson: JSON.stringify(input.generationParams),
    contractVersion: input.modelIdentity.contractVersion,
    contractCheckJson: JSON.stringify(input.contractCheck),
  };
}

/** Messages, structured stage data, stage advance, and trace commit atomically. */
export async function persistGenerationTurn(input: GenerationTraceInput) {
  const traceData = buildGenerationTraceData(input);
  const stageChanged = input.nextStage !== input.currentStage;

  return db.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        messages: JSON.stringify(input.updatedMessages),
        ...(input.stageDataChanged
          ? { stageData: JSON.stringify(input.stageData) }
          : {}),
      },
    });
    if (stageChanged) {
      await tx.studentAssignment.update({
        where: { id: input.studentAssignmentId },
        data: { currentStage: input.nextStage },
      });
    }
    return tx.generationTrace.create({ data: traceData });
  });
}
