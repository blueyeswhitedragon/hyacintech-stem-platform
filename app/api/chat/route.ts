import { NextResponse } from 'next/server';
import { checkBlacklistedKeywords, getPromptForPhase } from '../../prompts';
import { PhaseEnum, ChatRequest, ChatResponse, Message } from '../../models/types';
import { createLLMProvider } from '../../lib/llm/provider';
import { safeParseChatResponse } from '../../lib/llm/parser';
import { classifyError } from '../../lib/llm/errors';
import { LLMMessage } from '../../lib/llm/types';

async function callLLM(
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
  if (parsed1.dialogue !== '抱歉，AI服务返回了空内容，请重试。' &&
      parsed1.dialogue !== '抱歉，AI回复格式出现异常，请重试。' &&
      parsed1.dialogue !== '抱歉，我暂时无法处理您的请求，请重新描述您的问题。') {
    return parsed1;
  }

  // Attempt 2: retry without response_format, with a hard JSON instruction
  console.warn('First attempt failed JSON parse, retrying without response_format');
  const retryMessages = [
    ...messages,
    {
      role: 'system' as const,
      content: '你必须只输出一个合法的JSON对象，格式为{"dialogue":"...","next_action_type":"...","options":[...],"phase_complete":false}。不要在JSON前后添加任何其他文字、解释或标点。dialogue中的所有双引号必须用反斜杠转义。',
    },
  ];

  const raw2 = await provider.chat(retryMessages, { useJsonFormat: false });
  return safeParseChatResponse(raw2);
}

export async function POST(request: Request) {
  try {
    const requestData: ChatRequest = await request.json();
    const { message, phase, history } = requestData;

    // Safety check: blacklist keywords
    const blacklistedKeyword = checkBlacklistedKeywords(message);
    if (blacklistedKeyword) {
      return NextResponse.json(
        {
          error: 'safety_violation',
          keyword: blacklistedKeyword,
          message: `您的请求包含可能存在安全风险的内容（${blacklistedKeyword}），请调整后重试。为了确保实验安全，我们建议使用更安全的替代方案。`,
        },
        { status: 400 }
      );
    }

    // Get phase-specific prompt with safety constraints
    const systemPrompt = getPromptForPhase(phase as PhaseEnum);

    // Call real LLM
    const response = await callLLM(systemPrompt, message, history);

    return NextResponse.json(response);
  } catch (err) {
    console.error('处理聊天请求时出错:', err);

    const { error, detail, status } = classifyError(err);
    return NextResponse.json({ error, message: detail }, { status });
  }
}
