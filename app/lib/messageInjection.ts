import type { Message } from '@/app/models/types';

/** Add one server/system-originated message by stable id without duplicating it. */
export function injectMessageOnce(messages: Message[], injected?: Message | null): Message[] {
  if (!injected || messages.some((message) => message.id === injected.id)) return messages;
  return [...messages, injected];
}
