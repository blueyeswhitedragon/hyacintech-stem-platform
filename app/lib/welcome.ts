import { v4 as uuidv4 } from 'uuid';
import type { Message } from '@/app/models/types';

/** 会话/体验创建时种入的静态阶段1开场白（客户端与服务端共用，无 server-only）。 */
export function initialWelcomeMessage(): Message {
  return {
    id: uuidv4(),
    role: 'assistant',
    content:
      '欢迎来到「选题定向」阶段！我是你的科学探究导师。先告诉我：你最近对什么现象、问题或事物感到好奇？我们一起把它变成一个可以研究的科学问题。',
    actionType: 'text_input',
    phaseComplete: false,
  };
}
