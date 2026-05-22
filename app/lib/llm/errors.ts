import { ErrorCode, ClassifiedError } from './types';

const MESSAGES: Record<ErrorCode, string> = {
  network_error: '网络连接失败，无法访问AI服务。请检查网络连接或API地址配置。',
  timeout: 'AI响应超时，请重试。若持续超时请检查网络或切换模型。',
  bad_api_key: 'API Key 无效，请检查 .env.local 中的密钥是否正确。',
  insufficient_balance: 'API 账户余额不足，请充值后重试。',
  forbidden: '访问被拒绝，请检查API权限或网络代理设置。',
  invalid_model: '模型不存在，请检查 LLM_MODEL 环境变量配置。',
  context_overflow: '对话上下文超过模型限制，请刷新页面重新开始。',
  content_filtered: '内容被AI安全策略拦截，请修改表述后重试。',
  rate_limited: '请求过于频繁，请等待几秒后重试。',
  server_overloaded: 'AI服务繁忙，请稍后再试。',
  server_error: 'AI服务器错误，请稍后再试。',
  bad_config: 'LLM服务未配置。请在 .env.local 中设置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY。',
  parse_error: 'AI回复格式异常，请重试。',
  safety_violation: '内容包含安全风险，请修改后重试。',
  unknown_error: '请求失败，请重试。',
};

export function getMessage(code: ErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.unknown_error;
}

/**
 * Classify a raw error (from fetch or provider) into a structured ClassifiedError.
 */
export function classifyError(raw: unknown): ClassifiedError {
  // 1. Already classified — pass through
  if (raw instanceof LLMError) {
    return { error: raw.code, detail: raw.message, status: raw.httpStatus };
  }

  // 2. fetch network-level errors
  if (raw instanceof TypeError) {
    const msg = raw.message.toLowerCase();
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) {
      return { error: 'network_error', detail: MESSAGES.network_error, status: 502 };
    }
    return { error: 'network_error', detail: MESSAGES.network_error, status: 502 };
  }

  // 3. AbortError / timeout
  if (raw instanceof DOMException && raw.name === 'AbortError') {
    return { error: 'timeout', detail: MESSAGES.timeout, status: 504 };
  }

  // 4. Generic Error with message
  if (raw instanceof Error) {
    return classifyByMessage(raw.message);
  }

  // 5. Fallback
  return { error: 'unknown_error', detail: MESSAGES.unknown_error, status: 500 };
}

function classifyByMessage(message: string): ClassifiedError {
  const lower = message.toLowerCase();

  // LLM API error format: "LLM API error {status}: {body}"
  const apiMatch = message.match(/LLM API error (\d+):\s*(.*)/);
  if (apiMatch) {
    const status = parseInt(apiMatch[1], 10);
    const body = (apiMatch[2] || '').toLowerCase();

    return classifyHttpError(status, body);
  }

  // Config errors from provider factory
  if (lower.includes('no api key') || lower.includes('not set') || lower.includes('placeholder')) {
    return { error: 'bad_config', detail: MESSAGES.bad_config, status: 500 };
  }

  // Timeout
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { error: 'timeout', detail: MESSAGES.timeout, status: 504 };
  }

  return { error: 'unknown_error', detail: MESSAGES.unknown_error, status: 500 };
}

function classifyHttpError(status: number, body: string): ClassifiedError {
  // 401 — bad key
  if (status === 401 || body.includes('invalid api key') || body.includes('unauthorized') || body.includes('authentication')) {
    return { error: 'bad_api_key', detail: MESSAGES.bad_api_key, status: 401 };
  }

  // 402 — balance
  if (status === 402 || body.includes('insufficient balance') || body.includes('insufficient_quota') || body.includes('quota exceeded') || body.includes('billing') || body.includes('not enough quota')) {
    return { error: 'insufficient_balance', detail: MESSAGES.insufficient_balance, status: 402 };
  }

  // 403 — forbidden
  if (status === 403 || body.includes('forbidden') || body.includes('access denied') || body.includes('country') || body.includes('region')) {
    return { error: 'forbidden', detail: MESSAGES.forbidden, status: 403 };
  }

  // 404 — model not found
  if (status === 404 || body.includes('model not found') || body.includes('does not exist') || body.includes('invalid model')) {
    // Try to extract model name
    const modelMatch = body.match(/model[:\s]+([^\s,]+)/i);
    const modelHint = modelMatch ? `（模型: ${modelMatch[1]}）` : '';
    return { error: 'invalid_model', detail: MESSAGES.invalid_model + modelHint, status: 404 };
  }

  // 429 — rate limit
  if (status === 429 || body.includes('rate limit') || body.includes('too many requests')) {
    return { error: 'rate_limited', detail: MESSAGES.rate_limited, status: 429 };
  }

  // 400 — potentially context overflow or content filter
  if (status === 400) {
    if (body.includes('context') || body.includes('too long') || body.includes('max token') || body.includes('length')) {
      return { error: 'context_overflow', detail: MESSAGES.context_overflow, status: 400 };
    }
    if (body.includes('content filter') || body.includes('safety') || body.includes('moderation') || body.includes('flagged')) {
      return { error: 'content_filtered', detail: MESSAGES.content_filtered, status: 400 };
    }
  }

  // 503 — overloaded
  if (status === 503 || body.includes('overload') || body.includes('busy') || body.includes('capacity')) {
    return { error: 'server_overloaded', detail: MESSAGES.server_overloaded, status: 503 };
  }

  // 5xx generic
  if (status >= 500) {
    return { error: 'server_error', detail: `AI服务器错误（状态码: ${status}），请稍后再试。`, status };
  }

  // Unknown HTTP error
  return { error: 'unknown_error', detail: MESSAGES.unknown_error, status };
}

/**
 * Structured error for use inside the provider layer.
 */
export class LLMError extends Error {
  code: ErrorCode;
  httpStatus: number;

  constructor(code: ErrorCode, detail: string, httpStatus: number) {
    super(detail);
    this.name = 'LLMError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
