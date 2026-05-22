import { LLMMessage, LLMProvider, LLMProviderConfig, ConfigValidation } from './types';
import { LLMError } from './errors';

class OpenAICompatibleProvider implements LLMProvider {
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    const url = `${this.config.baseURL}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

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
          temperature: this.config.temperature ?? 0.3,
          max_tokens: this.config.maxTokens ?? 2000,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`LLM API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } finally {
      clearTimeout(timer);
    }
  }
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

function detectProvider(): 'openai' | 'deepseek' | null {
  const openaiKey = process.env.OPENAI_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  const hasOpenAI = openaiKey && !isPlaceholderKey(openaiKey);
  const hasDeepSeek = deepseekKey && !isPlaceholderKey(deepseekKey);

  if (hasOpenAI) return 'openai';
  if (hasDeepSeek) return 'deepseek';
  return null;
}

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

  const providerType = process.env.LLM_PROVIDER ?? detectProvider();

  if (!providerType) {
    issues.push('未检测到有效的 API Key。请在 .env.local 中设置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY。');
    return { valid: false, provider: null, model: null, issues };
  }

  const model = process.env.LLM_MODEL ?? (providerType === 'deepseek' ? 'deepseek-chat' : 'gpt-4o');

  return { valid: true, provider: providerType, model, issues: issues.length > 0 ? issues : [] };
}

export function createLLMProvider(): LLMProvider {
  const config = validateConfig();

  if (!config.valid) {
    throw new LLMError('bad_config', config.issues.join(' '), 500);
  }

  const providerType = process.env.LLM_PROVIDER ?? config.provider!;

  if (providerType === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY!;
    return new OpenAICompatibleProvider({
      apiKey,
      baseURL: process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1',
      model: config.model!,
    });
  }

  if (providerType === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY!;
    return new OpenAICompatibleProvider({
      apiKey,
      baseURL: process.env.DEEPSEEK_API_BASE ?? 'https://api.deepseek.com/v1',
      model: config.model!,
    });
  }

  throw new LLMError('bad_config', 'No LLM provider configured. Set OPENAI_API_KEY or DEEPSEEK_API_KEY.', 500);
}
