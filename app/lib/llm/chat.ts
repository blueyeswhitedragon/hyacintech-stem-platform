import { ChatResponse, Message } from '@/app/models/types';
import { createLLMProvider } from './provider';
import { safeParseChatResponse } from './parser';
import { LLMMessage } from './types';

// 与 parser.ts 的 canned fallback 文案保持同步：用于判断首次解析是否失败。
const APOLOGY_DIALOGUES = [
  '抱歉，AI服务返回了空内容，请重试。',
  '抱歉，AI回复格式出现异常，请重试。',
  '抱歉，我暂时无法处理您的请求，请重新描述您的问题。',
];

/**
 * 调用 LLM 并解析为 ChatResponse 的两段式策略（被 /api/chat 与
 * /api/conversations/[id]/chat 共用）。永不抛 JSON 解析错误（由 parser 兜底），
 * 但底层 provider/网络错误会抛出，交给调用方 classifyError 处理。
 */
export async function callLLM(
  systemPrompt: string,
  userMessage: string,
  history: Message[]
): Promise<ChatResponse> {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const provider = createLLMProvider();

  // Attempt 1: with response_format (JSON mode)
  const raw1 = await provider.chat(messages, { useJsonFormat: true });
  const parsed1 = safeParseChatResponse(raw1);

  // If parse succeeded (dialogue is from the LLM, not our fallback), return it
  if (!APOLOGY_DIALOGUES.includes(parsed1.dialogue)) {
    return parsed1;
  }

  // Attempt 2: retry without response_format, with a hard JSON instruction
  console.warn('First attempt failed JSON parse, retrying without response_format');
  const retryMessages: LLMMessage[] = [
    ...messages,
    {
      role: 'system',
      content:
        '你必须只输出一个合法的JSON对象，格式为{"dialogue":"...","next_action_type":"...","options":[...],"phase_complete":false}。不要在JSON前后添加任何其他文字、解释或标点。dialogue中的所有双引号必须用反斜杠转义。',
    },
  ];

  const raw2 = await provider.chat(retryMessages, { useJsonFormat: false });
  return safeParseChatResponse(raw2);
}
