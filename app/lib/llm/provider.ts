import {
  type ChatOptions,
  type ConfigValidation,
  type LLMCompletion,
  type LLMMessage,
  type LLMProvider,
  type LLMProviderConfig,
  type LLMRuntimeOverride,
} from './types';
import { LLMError } from './errors';
import { resolveProviderApiBase } from './endpoints';

class OpenAICompatibleProvider implements LLMProvider {
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async complete(messages: LLMMessage[], options?: ChatOptions): Promise<LLMCompletion> {
    const useJsonFormat = options?.useJsonFormat !== false; // default true
    const url = `${this.config.baseURL}/chat/completions`;
    const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 2000;
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs ?? 30_000;
    const thinking = this.config.provider === 'deepseek'
      ? options?.thinking ?? this.config.thinking ?? 'enabled'
      : null;
    const reasoningEffort = thinking === 'enabled'
      ? options?.reasoningEffort ?? this.config.reasoningEffort ?? 'high'
      : null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          ...(thinking === 'enabled'
            ? {}
            : { temperature: this.config.temperature ?? 0.3 }),
          max_tokens: maxTokens,
          ...(useJsonFormat ? { response_format: { type: 'json_object' } } : {}),
          ...(thinking ? { thinking: { type: thinking } } : {}),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`LLM API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json() as {
        choices?: Array<{
          finish_reason?: unknown;
          message?: { content?: unknown; reasoning_content?: unknown };
        }>;
        usage?: {
          prompt_tokens?: unknown;
          completion_tokens?: unknown;
          total_tokens?: unknown;
          completion_tokens_details?: { reasoning_tokens?: unknown };
        };
      };
      const choice = data.choices?.[0];
      if (!choice?.message) {
        throw new Error('LLM API returned no completion choice');
      }
      const content = typeof choice.message.content === 'string' ? choice.message.content : '';
      const reasoning = typeof choice.message.reasoning_content === 'string' ? choice.message.reasoning_content : '';
      const numberOrUndefined = (value: unknown): number | undefined => (
        typeof value === 'number' && Number.isFinite(value) ? value : undefined
      );
      return {
        content,
        finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
        reasoningChars: reasoning.length,
        usage: {
          promptTokens: numberOrUndefined(data.usage?.prompt_tokens),
          completionTokens: numberOrUndefined(data.usage?.completion_tokens),
          reasoningTokens: numberOrUndefined(data.usage?.completion_tokens_details?.reasoning_tokens),
          totalTokens: numberOrUndefined(data.usage?.total_tokens),
        },
        request: {
          jsonFormat: useJsonFormat,
          maxTokens,
          timeoutMs,
          thinking,
          reasoningEffort,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<string> {
    return (await this.complete(messages, options)).content;
  }
}

export function createConfiguredLLMProvider(config: LLMProviderConfig): LLMProvider {
  if (!config.apiKey?.trim()) throw new LLMError('bad_config', '运行组合缺少有效访问密钥', 500);
  if (!config.baseURL?.trim()) throw new LLMError('bad_config', '运行组合缺少 Base URL', 500);
  if (!config.model?.trim()) throw new LLMError('bad_config', '运行组合缺少远程 model ID', 500);
  return new OpenAICompatibleProvider({
    ...config,
    baseURL: config.baseURL.trim().replace(/\/+$/, ''),
  });
}

// ---- Placeholder key detection ----

const PLACEHOLDER_PATTERNS = [
  /^sk-your-/i,
  /^your-api-key/i,
  /^sk-xxx/i,
  /^sk-placeholder/i,
  /^change-me/i,
  /^put-your/i,
];

function isPlaceholderKey(key: string): boolean {
  if (!key || key.trim().length < 10) return true;
  return PLACEHOLDER_PATTERNS.some((p) => p.test(key.trim()));
}

// ---- Provider detection ----

/**
 * Validate configuration without throwing. Used by health check and createLLMProvider.
 */
export function validateConfig(): ConfigValidation {
  const issues: string[] = [];

  const openaiKey = process.env.OPENAI_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  if (openaiKey && isPlaceholderKey(openaiKey)) {
    issues.push('OPENAI_API_KEY 为占位符值，已忽略。请设置为真实密钥。');
  }
  if (deepseekKey && isPlaceholderKey(deepseekKey)) {
    issues.push('DEEPSEEK_API_KEY 为占位符值，已忽略。请设置为真实密钥。');
  }

  const hasOpenAI = Boolean(openaiKey && !isPlaceholderKey(openaiKey));
  const hasDeepSeek = Boolean(deepseekKey && !isPlaceholderKey(deepseekKey));
  const configuredProvider = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (configuredProvider && configuredProvider !== 'openai' && configuredProvider !== 'deepseek') {
    issues.push('LLM_PROVIDER 只支持 openai 或 deepseek。');
    return { valid: false, provider: null, model: null, issues };
  }

  if (!configuredProvider && hasOpenAI && hasDeepSeek) {
    issues.push('同时检测到 OPENAI_API_KEY 与 DEEPSEEK_API_KEY，请显式设置 LLM_PROVIDER。');
    return { valid: false, provider: null, model: null, issues };
  }

  const providerType = configuredProvider ?? (hasOpenAI ? 'openai' : hasDeepSeek ? 'deepseek' : null);

  if (!providerType) {
    issues.push('未检测到有效的 API Key。请在 .env 中设置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY。');
    return { valid: false, provider: null, model: null, issues };
  }

  if (providerType === 'openai' && !hasOpenAI) {
    issues.push('LLM_PROVIDER=openai，但未配置有效的 OPENAI_API_KEY。');
    return { valid: false, provider: providerType, model: null, issues };
  }
  if (providerType === 'deepseek' && !hasDeepSeek) {
    issues.push('LLM_PROVIDER=deepseek，但未配置有效的 DEEPSEEK_API_KEY。');
    return { valid: false, provider: providerType, model: null, issues };
  }

  const configuredModel = process.env.LLM_MODEL?.trim();
  if (process.env.LLM_MODEL !== undefined && !configuredModel) {
    issues.push('LLM_MODEL 不能为空。');
    return { valid: false, provider: providerType, model: null, issues };
  }
  const model = configuredModel ?? (providerType === 'deepseek' ? 'deepseek-v4-pro' : 'gpt-4o');

  return { valid: true, provider: providerType, model, issues: issues.length > 0 ? issues : [] };
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function roleSetting(role: LLMRuntimeOverride['role'], suffix: string): string | undefined {
  return role ? process.env[`${role}_${suffix}`] : undefined;
}

export function createLLMProvider(override?: LLMRuntimeOverride): LLMProvider {
  const config = validateConfig();

  if (!config.valid) {
    throw new LLMError('bad_config', config.issues.join(' '), 500);
  }

  const providerType = override?.provider ?? process.env.LLM_PROVIDER ?? config.provider!;
  const model = override?.model ?? config.model!;
  const deepseekDefaults: Record<string, number> = {
    TUTOR: 16_000,
    STUDENT: 10_000,
    EVALUATOR: 20_000,
  };
  const maxTokens = positiveInteger(roleSetting(override?.role, 'LLM_MAX_TOKENS'))
    ?? positiveInteger(process.env.LLM_MAX_TOKENS)
    ?? (providerType === 'deepseek' ? deepseekDefaults[override?.role ?? 'TUTOR'] : 2000);
  const timeoutMs = positiveInteger(roleSetting(override?.role, 'LLM_TIMEOUT_MS'))
    ?? positiveInteger(process.env.LLM_TIMEOUT_MS)
    ?? (providerType === 'deepseek' && override?.role === 'EVALUATOR' ? 300_000 : 180_000);
  const thinking = providerType === 'deepseek'
    ? (roleSetting(override?.role, 'LLM_THINKING') ?? process.env.LLM_THINKING ?? 'enabled')
    : 'disabled';
  const normalizedThinking = thinking === 'disabled' ? 'disabled' : 'enabled';
  const reasoningEffort = (roleSetting(override?.role, 'LLM_REASONING_EFFORT')
    ?? process.env.LLM_REASONING_EFFORT) === 'max' ? 'max' : 'high';

  if (providerType === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || isPlaceholderKey(apiKey)) throw new LLMError('bad_config', '所选部署缺少有效 OPENAI_API_KEY', 500);
    return new OpenAICompatibleProvider({
      apiKey,
      baseURL: resolveProviderApiBase('openai'),
      model,
      provider: 'openai',
      maxTokens,
      timeoutMs,
    });
  }

  if (providerType === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || isPlaceholderKey(apiKey)) throw new LLMError('bad_config', '所选部署缺少有效 DEEPSEEK_API_KEY', 500);
    return new OpenAICompatibleProvider({
      apiKey,
      baseURL: resolveProviderApiBase('deepseek'),
      model,
      provider: 'deepseek',
      maxTokens,
      timeoutMs,
      thinking: normalizedThinking,
      reasoningEffort,
    });
  }

  throw new LLMError('bad_config', 'No LLM provider configured. Set OPENAI_API_KEY or DEEPSEEK_API_KEY.', 500);
}
