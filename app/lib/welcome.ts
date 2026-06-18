import { v4 as uuidv4 } from 'uuid';
import type { Message } from '@/app/models/types';

export interface WelcomeOptions {
  /** 作业标题，有则明确提及 */
  assignmentTitle?: string;
  /** 作业限定的研究方向，有则在欢迎语中引导 */
  topicDirection?: string;
}

/** 会话/体验创建时种入的静态阶段1开场白（客户端与服务端共用，无 server-only）。 */
export function initialWelcomeMessage(opts?: WelcomeOptions): Message {
  let content: string;

  if (opts?.assignmentTitle) {
    content = `欢迎来到「选题定向」阶段！我是你的科学探究导师。\n\n本次探究作业的主题是「${opts.assignmentTitle}」${opts.topicDirection ? `，研究方向为「${opts.topicDirection}」` : ''}。\n\n请你围绕这个主题思考：你对该主题下的哪些具体现象或问题感到好奇？你想探究什么？我们一起把这个主题变成一个可以研究的科学问题。`;
  } else {
    content = '欢迎来到「选题定向」阶段！我是你的科学探究导师。先告诉我：你最近对什么现象、问题或事物感到好奇？我们一起把它变成一个可以研究的科学问题。';
  }

  return {
    id: uuidv4(),
    role: 'assistant',
    content,
    actionType: 'text_input',
    phaseComplete: false,
  };
}
