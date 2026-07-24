import type { Message } from '@/app/models/types';

export type PhaseConfirmationAction = 'CONFIRM_AND_ADVANCE' | 'ADVANCE';

export function phaseConfirmationAction(
  stage: number,
  actionType?: Message['actionType'],
  phaseComplete?: boolean,
): PhaseConfirmationAction | null {
  if (stage !== 1 || actionType !== 'confirmation') return null;
  return phaseComplete === true ? 'ADVANCE' : 'CONFIRM_AND_ADVANCE';
}

export function shouldOfferPhaseConfirmation(
  stage: number,
  actionType?: Message['actionType'],
  phaseComplete?: boolean,
): boolean {
  return phaseConfirmationAction(stage, actionType, phaseComplete) !== null;
}

export function confirmationDocumentBody(content: string): string {
  return content
    .replace(/^\s*《探究问题确认书》\s*/, '')
    .replace(/^\s*研究问题\s*[:：]\s*/, '')
    .trim();
}
