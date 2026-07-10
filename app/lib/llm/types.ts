/**
 * LLM provider type definitions
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ChatOptions {
  useJsonFormat?: boolean;
}

export interface LLMProvider {
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<string>;
}

// ---- Error classification ----

export type ErrorCode =
  | 'network_error'
  | 'timeout'
  | 'bad_api_key'
  | 'insufficient_balance'
  | 'forbidden'
  | 'invalid_model'
  | 'context_overflow'
  | 'content_filtered'
  | 'rate_limited'
  | 'server_overloaded'
  | 'server_error'
  | 'bad_config'
  | 'parse_error'
  | 'safety_violation'
  | 'unknown_error';

export interface ClassifiedError {
  error: ErrorCode;
  detail: string;
  status: number;
}

// ---- Health check ----

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  provider: string | null;
  model: string | null;
  checks: {
    config: { ok: boolean; detail?: string };
    connectivity: { ok: boolean; latency_ms?: number; detail?: string };
    auth: { ok: boolean; detail?: string };
  };
  errors: ErrorCode[];
}

export interface ConfigValidation {
  valid: boolean;
  provider: string | null;
  model: string | null;
  issues: string[];
}
