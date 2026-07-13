import type { ChatResponse, Message } from '@/app/models/types';
import type { StageData } from '@/app/models/stageData';

export interface Stage4TransitionResult {
  stageData: StageData;
  transitionMessage: Message;
}

export function buildAssistantTransitionMessage(response: ChatResponse, assistantMessageId: string): Message {
  return {
    id: assistantMessageId,
    role: 'assistant',
    content: response.dialogue,
    options: response.options,
    hints: response.hints,
    actionType: response.next_action_type,
    phaseComplete: false,
    messageType: 'stage_transition',
    status: 'sent',
  };
}

/** Pure construction shared by DB-backed and guest 3→4 transitions. */
export function buildStage4TransitionResult(
  previous: StageData,
  response: ChatResponse,
  assistantMessageId: string,
): Stage4TransitionResult {
  return {
    stageData: {
      ...previous,
      stage3: previous.stage3
        ? {
            ...previous.stage3,
            submitted: true,
            approved: previous.stage3.approved ?? null,
          }
        : undefined,
      stage4: previous.stage4 ?? { analysisCount: 0 },
    },
    transitionMessage: buildAssistantTransitionMessage(response, assistantMessageId),
  };
}
