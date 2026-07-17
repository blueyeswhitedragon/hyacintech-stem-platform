import type { ChatResponse, Message } from '@/app/models/types';
import type { StageData } from '@/app/models/stageData';
import { db } from '@/app/lib/db';
import { sha256 } from '@/app/lib/dataLab/validation';
import type { RuntimeModelIdentity } from '@/app/lib/modelRegistry';
import type { StageTriggerType } from '@/app/lib/stageContract';
import { getPromptForPhase } from '@/app/prompts';
import { PhaseEnum } from '@/app/models/types';

export interface GenerationTraceInput {
  conversationId: string;
  studentAssignmentId: string;
  currentStage: number;
  nextStage: number;
  /** 轨迹归属阶段；系统过渡 3→4 的回复归入阶段4。 */
  traceStage?: number;
  triggerType?: StageTriggerType;
  updatedMessages: Message[];
  stageData: StageData;
  stageDataChanged: boolean;
  userMessageId: string;
  assistantMessageId: string;
  userMessage: string;
  systemPrompt: string;
  /** 不含学生数据的版本化模板；新合同应显式提供。 */
  systemPromptTemplate?: string;
  /** Exact rendered prompt; callers must supply it only after explicit consent. */
  trainingSystemPromptSnapshot?: string;
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
  // Store the versioned template and style/trigger contract, not the fully
  // rendered prompt containing student rows, reports or teacher feedback.
  const tracePromptTemplate = input.systemPromptTemplate ?? getPromptForPhase((input.traceStage ?? input.currentStage) as PhaseEnum, {
    styleFamily: input.styleFamily as import('@/app/lib/stylePolicy').StyleFamily,
    stylePolicyVersion: input.stylePolicyVersion,
    triggerType: input.triggerType,
  });
  return {
    conversationId: input.conversationId,
    assistantMessageId: input.assistantMessageId,
    userMessageId: input.userMessageId,
    triggerType: input.triggerType ?? 'USER_MESSAGE',
    stage: input.traceStage ?? input.currentStage,
    modelVersionId: input.modelVersionId,
    modelTagSnapshot: input.modelIdentity.tag,
    providerSnapshot: input.modelIdentity.provider,
    externalModelSnapshot: input.modelIdentity.externalModelId,
    promptVersion: input.modelIdentity.promptPolicyVersion,
    promptSha256: sha256(input.systemPrompt),
    systemPromptSnapshot: tracePromptTemplate,
    trainingSystemPromptSnapshot: input.trainingSystemPromptSnapshot ?? '',
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
      const advanced = await tx.studentAssignment.updateMany({
        where: { id: input.studentAssignmentId, currentStage: input.currentStage },
        data: { currentStage: input.nextStage },
      });
      if (advanced.count !== 1) {
        throw new Error('阶段已变化，请刷新后重试');
      }
    }
    return tx.generationTrace.create({ data: traceData });
  });
}
