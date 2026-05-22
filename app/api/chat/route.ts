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
  const rawResponse = await provider.chat(messages);
  return safeParseChatResponse(rawResponse);
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
