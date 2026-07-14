import { validateStageResponseBehavior, type StageTriggerType } from '@/app/lib/stageContract';
import { attachDeterministicArtifacts } from '@/app/lib/stageArtifacts';
import type { ChatResponse, Message } from '@/app/models/types';
import { validateChatContract } from './chatContract';
import { LLMError } from './errors';
import { parseChatResponseStrict } from './parser';
import { createLLMProvider } from './provider';
import type { LLMCompletion, LLMMessage, LLMRuntimeOverride } from './types';

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

interface AttemptDiagnostic {
  attempt: number;
  failureCode: string;
  raw: string;
  parsed: ChatResponse | null;
  finishReason: string | null;
  reasoningChars: number;
  usage: LLMCompletion['usage'];
  request: LLMCompletion['request'];
  issues: CombinedContractIssue[];
  warnings: CombinedContractIssue[];
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

function parseVisibleContext(value?: string): unknown {
  if (!value?.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function completionFailureCode(completion: LLMCompletion, parsed: ChatResponse | null): string | null {
  if (completion.finishReason === 'length') return 'OUTPUT_TRUNCATED';
  if (completion.finishReason === 'content_filter') return 'CONTENT_FILTERED';
  if (completion.finishReason === 'insufficient_system_resource') return 'INSUFFICIENT_SYSTEM_RESOURCE';
  if (!completion.content.trim()) return 'EMPTY_CONTENT';
  if (!parsed) return 'INVALID_JSON';
  return null;
}

function repairInstruction(failureCode: string, issues: CombinedContractIssue[], stage?: number): string {
  const issueSummary = issues.map((item) => `${item.code}: ${item.message}`).join('；');
  return [
    '【结构化响应重试】',
    `上一次生成未通过，失败类型：${failureCode}${issueSummary ? `；${issueSummary}` : ''}。`,
    '请重新回答用户最后一条消息。必须在最终 content 中只输出一个完整、合法的 JSON 对象，不要输出 Markdown 代码块或任何前后缀文字。',
    '不要只在思考过程中构造答案；dialogue 内部的双引号必须正确转义。',
    stage === 2
      ? '若输出最终方案，必须输出完整 experiment_plan 并使用 confirmation；数据表由平台根据方案确定性生成。方案尚未完整时使用 text_input，且不得声称表格已经生成。'
      : '',
  ].filter(Boolean).join('\n');
}

function buildMessages(
  systemPrompt: string,
  userMessage: string,
  history: Message[],
  repair?: string,
): LLMMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...history.map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    })),
    { role: 'user', content: repair ? `${userMessage}\n\n${repair}` : userMessage },
  ];
}

function publicAttemptMetadata(attempt: AttemptDiagnostic) {
  return {
    attempt: attempt.attempt,
    failureCode: attempt.failureCode,
    finishReason: attempt.finishReason,
    contentChars: attempt.raw.length,
    reasoningChars: attempt.reasoningChars,
    usage: attempt.usage,
    request: attempt.request,
    issues: attempt.issues,
    warnings: attempt.warnings,
  };
}

/**
 * Shared structured chat entry point. Thinking stays enabled on every retry.
 * A whitespace-only DeepSeek JSON-mode response retries without the API
 * response_format flag, but still must pass the same strict JSON parser.
 */
export async function callLLM(
  systemPrompt: string,
  userMessage: string,
  history: Message[],
  contract?: LLMRuntimeContract,
  runtimeModel?: LLMRuntimeOverride,
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
  runtimeModel?: LLMRuntimeOverride,
): Promise<LLMCallTrace> {
  // Assistant history never becomes grounding truth. Parse the already-JSON
  // business context before wrapping it so dataRows remain machine-readable.
  const groundedContract = contract
    ? {
        ...contract,
        visibleContext: JSON.stringify({
          businessContext: parseVisibleContext(contract.visibleContext),
          currentStudentMessage: userMessage,
          priorStudentMessages: history
            .filter((message) => message.role === 'user')
            .map((message) => message.content),
        }),
      }
    : undefined;
  const provider = createLLMProvider(runtimeModel);
  const artifactContext = parseVisibleContext(contract?.visibleContext);
  const attempts: AttemptDiagnostic[] = [];
  let repair: string | undefined;
  let useJsonFormat = true;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const messages = buildMessages(systemPrompt, userMessage, history, repair);
    let completion: LLMCompletion;
    try {
      completion = await provider.complete(messages, { useJsonFormat });
    } catch (error) {
      console.warn(`LLM transport attempt ${attempt}/3 failed:`, error instanceof Error ? error.message : String(error));
      if (attempt < 3) {
        repair = '【传输重试】请继续遵守原始要求，只在最终 content 中输出一个完整合法的 JSON 对象。';
        continue;
      }
      throw error;
    }
    const parsedRaw = parseChatResponseStrict(completion.content);
    const parsed = parsedRaw
      ? attachDeterministicArtifacts(contract?.stage, parsedRaw, artifactContext, contract?.triggerType)
      : null;
    const transportFailure = completionFailureCode(completion, parsed);
    const checked = parsed ? validateRuntimeContract(parsed, groundedContract) : null;
    const failureCode = transportFailure ?? (checked?.ok ? null : 'CONTRACT_VIOLATION');

    if (!failureCode && checked) {
      if (checked.repairs.length > 0) {
        console.warn('LLM response contract repaired:', checked.repairs.map((item) => item.code).join(','));
      }
      const previousAttempts = attempts.map(publicAttemptMetadata);
      return {
        response: checked.response,
        trace: {
          generationParams: {
            responseFormat: completion.request.jsonFormat ? 'json_object' : 'strict_prompt_json',
            successfulAttempt: attempt,
            maxTokens: completion.request.maxTokens,
            timeoutMs: completion.request.timeoutMs,
            thinking: completion.request.thinking,
            reasoningEffort: completion.request.reasoningEffort,
            finishReason: completion.finishReason,
            reasoningChars: completion.reasoningChars,
            usage: completion.usage,
          },
          contractCheck: {
            ok: true,
            stage: contract?.stage ?? null,
            triggerType: contract?.triggerType ?? 'USER_MESSAGE',
            previousAttempts,
            issues: checked.issues,
            warnings: checked.warnings,
            repairs: checked.repairs,
          },
        },
      };
    }

    const diagnostic: AttemptDiagnostic = {
      attempt,
      failureCode: failureCode ?? 'UNKNOWN_FAILURE',
      raw: completion.content.slice(0, 20_000),
      parsed,
      finishReason: completion.finishReason,
      reasoningChars: completion.reasoningChars,
      usage: completion.usage,
      request: completion.request,
      issues: checked?.issues ?? [],
      warnings: checked?.warnings ?? [],
    };
    attempts.push(diagnostic);
    const issueCodes = diagnostic.issues.map((item) => item.code).join(',');
    console.warn(
      `LLM attempt ${attempt}/3 rejected: ${diagnostic.failureCode}${issueCodes ? ` (${issueCodes})` : ''}; `
      + `finish=${completion.finishReason ?? 'unknown'}, contentChars=${completion.content.length}, `
      + `reasoningChars=${completion.reasoningChars}`,
    );
    // DeepSeek documents that JSON mode can occasionally finish with only
    // whitespace. Keep thinking enabled, but remove response_format on the
    // next attempt and continue to require strict JSON parsing ourselves.
    if (diagnostic.failureCode === 'EMPTY_CONTENT') useJsonFormat = false;
    repair = repairInstruction(diagnostic.failureCode, diagnostic.issues, contract?.stage);
  }

  const last = attempts.at(-1);
  console.error('LLM structured response exhausted retries:', last?.failureCode ?? 'UNKNOWN_FAILURE');
  throw new LLMError(
    'parse_error',
    contract?.stage === 2
      ? 'AI未能生成完整的方案与数据表，请重新发送上一条消息。'
      : 'AI回复格式或内容校验失败，请重试。',
    502,
    {
      failureCode: last?.failureCode ?? 'UNKNOWN_FAILURE',
      attempts,
    },
  );
}
