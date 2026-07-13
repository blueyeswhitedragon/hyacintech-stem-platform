import { ChatResponse, Message } from '@/app/models/types';
import { createLLMProvider } from './provider';
import { safeParseChatResponse } from './parser';
import { LLMMessage } from './types';
import { validateChatContract } from './chatContract';
import { LLMError } from './errors';
import { validateStageResponseBehavior, type StageTriggerType } from '@/app/lib/stageContract';

// 与 parser.ts 的 canned fallback 文案保持同步：用于判断首次解析是否失败。
const APOLOGY_DIALOGUES = [
  '抱歉，AI服务返回了空内容，请重试。',
  '抱歉，AI回复格式出现异常，请重试。',
  '抱歉，我暂时无法处理您的请求，请重新描述您的问题。',
];

export interface LLMRuntimeContract {
  stage: number;
  hasStage2Schema?: boolean;
  triggerType?: StageTriggerType;
  /** 只包含本轮模型可见的真实业务数据，用于检查凭空引用。 */
  visibleContext?: string;
}

interface CombinedContractIssue {
  code: string;
  message: string;
  severity?: 'warning' | 'error';
  evidence?: string;
}

function validateRuntimeContract(response: ChatResponse, contract?: LLMRuntimeContract) {
  if (!contract) return { response, issues: [] as CombinedContractIssue[], warnings: [] as CombinedContractIssue[], repairs: [], ok: true };
  const structural = validateChatContract(response, {
    stage: contract.stage,
    hasStage2Schema: contract.hasStage2Schema,
    canonicalize: true,
  });
  const behavior = validateStageResponseBehavior(contract.stage, structural.response, {
    triggerType: contract.triggerType,
    visibleContext: contract.visibleContext,
  });
  const behaviorErrors = behavior.filter((item) => item.severity === 'error');
  return {
    response: structural.response,
    issues: [...structural.issues, ...behaviorErrors] as CombinedContractIssue[],
    warnings: behavior.filter((item) => item.severity === 'warning'),
    repairs: structural.repairs,
    ok: structural.ok && behaviorErrors.length === 0,
  };
}

/**
 * 调用 LLM 并解析为 ChatResponse 的两段式策略（被 /api/chat 与
 * /api/conversations/[id]/chat 共用）。永不抛 JSON 解析错误（由 parser 兜底），
 * 但底层 provider/网络错误会抛出，交给调用方 classifyError 处理。
 */
export async function callLLM(
  systemPrompt: string,
  userMessage: string,
  history: Message[],
  contract?: LLMRuntimeContract,
  runtimeModel?: { provider: string; model: string }
): Promise<ChatResponse> {
  return (await callLLMWithTrace(systemPrompt, userMessage, history, contract, runtimeModel)).response;
}

export interface LLMCallTrace {
  response: ChatResponse;
  trace: {
    generationParams: Record<string, unknown>;
    contractCheck: Record<string, unknown>;
  };
}

/** Same behavior as callLLM, plus non-secret evidence needed by GenerationTrace. */
export async function callLLMWithTrace(
  systemPrompt: string,
  userMessage: string,
  history: Message[],
  contract?: LLMRuntimeContract,
  runtimeModel?: { provider: string; model: string }
): Promise<LLMCallTrace> {
  // Behavioral grounding may use facts supplied in the current student turn
  // and earlier student turns. Assistant history is deliberately excluded so
  // a prior model hallucination cannot become an accepted source of truth.
  const groundedContract = contract
    ? {
        ...contract,
        visibleContext: JSON.stringify({
          businessContext: contract.visibleContext ?? null,
          currentStudentMessage: userMessage,
          priorStudentMessages: history
            .filter((message) => message.role === 'user')
            .map((message) => message.content),
        }),
      }
    : undefined;
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const provider = createLLMProvider(runtimeModel);

  // Attempt 1: with response_format (JSON mode)
  const raw1 = await provider.chat(messages, { useJsonFormat: true });
  const parsed1 = safeParseChatResponse(raw1);
  const checked1 = validateRuntimeContract(parsed1, groundedContract);

  // JSON/语义契约都通过才返回。schema 已存在但 action 错误属于可确定修复，不额外调用模型。
  if (!APOLOGY_DIALOGUES.includes(parsed1.dialogue) && checked1.ok) {
    if (checked1.repairs.length > 0) {
      console.warn('LLM response contract repaired:', checked1.repairs.map((item) => item.code).join(','));
    }
    return {
      response: checked1.response,
      trace: {
        generationParams: {
          temperature: 0.3,
          maxTokens: process.env.LLM_MAX_TOKENS
            ? Number(process.env.LLM_MAX_TOKENS)
            : 2000,
          responseFormat: 'json_object',
          successfulAttempt: 1,
        },
        contractCheck: {
          ok: true,
          stage: contract?.stage ?? null,
          triggerType: contract?.triggerType ?? 'USER_MESSAGE',
          issues: checked1.issues,
          warnings: checked1.warnings ?? [],
          repairs: checked1.repairs,
        },
      },
    };
  }

  // Attempt 2: JSON 解析失败或跨字段契约不一致时，只重试一次。
  const issueSummary = checked1.issues.map((item) => `${item.code}: ${item.message}`).join('；');
  console.warn('First LLM attempt failed response contract, retrying:', issueSummary || 'JSON_PARSE_FAILED');
  const retryMessages: LLMMessage[] = [
    ...messages,
    {
      role: 'system',
      content:
        `上一次回复未通过结构化响应校验：${issueSummary || '未返回合法 JSON'}。请重新回答用户最后一条消息。你必须只输出一个合法的JSON对象，不要在JSON前后添加任何其他文字。dialogue中的双引号必须转义。` +
        (contract?.stage === 2
          ? ' 若你说数据表已经生成或使用 confirmation，必须同时输出非空 data_table_schema；输出 data_table_schema 时 next_action_type 必须为 confirmation。若方案尚未成型，请使用 text_input，且不要声称表格已经生成。'
          : ''),
    },
  ];

  const raw2 = await provider.chat(retryMessages, { useJsonFormat: false });
  const parsed2 = safeParseChatResponse(raw2);
  const checked2 = validateRuntimeContract(parsed2, groundedContract);
  if (APOLOGY_DIALOGUES.includes(parsed2.dialogue) || !checked2.ok) {
    const codes = checked2.issues.map((item) => item.code).join(',') || 'JSON_PARSE_FAILED';
    console.error('Second LLM attempt failed response contract:', codes);
    throw new LLMError(
      'parse_error',
      contract?.stage === 2
        ? 'AI未能生成完整的数据表，请重新发送上一条消息。'
        : 'AI回复格式异常，请重试。',
      502
    );
  }
  if (checked2.repairs.length > 0) {
    console.warn('Retried LLM response contract repaired:', checked2.repairs.map((item) => item.code).join(','));
  }
  return {
    response: checked2.response,
    trace: {
      generationParams: {
        temperature: 0.3,
        maxTokens: process.env.LLM_MAX_TOKENS
          ? Number(process.env.LLM_MAX_TOKENS)
          : 2000,
        responseFormat: 'plain_retry',
        successfulAttempt: 2,
      },
      contractCheck: {
        ok: true,
        stage: contract?.stage ?? null,
        triggerType: contract?.triggerType ?? 'USER_MESSAGE',
        firstAttemptIssues: checked1.issues,
        issues: checked2.issues,
        warnings: checked2.warnings ?? [],
        repairs: checked2.repairs,
      },
    },
  };
}
