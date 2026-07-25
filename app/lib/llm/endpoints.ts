export type SupportedLLMProvider = 'openai' | 'deepseek';

export const DEFAULT_LLM_API_BASES: Record<SupportedLLMProvider, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
};

export function normalizeApiBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function resolveProviderApiBase(
  provider: SupportedLLMProvider,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = provider === 'openai' ? env.OPENAI_API_BASE : env.DEEPSEEK_API_BASE;
  return normalizeApiBase(configured || DEFAULT_LLM_API_BASES[provider]);
}
