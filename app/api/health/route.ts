import { NextResponse } from 'next/server';
import { HealthResponse, LLMMessage } from '../../lib/llm/types';
import { validateConfig } from '../../lib/llm/provider';
import { classifyError } from '../../lib/llm/errors';

export async function GET() {
  const result: HealthResponse = {
    status: 'healthy',
    provider: null,
    model: null,
    checks: {
      config: { ok: false },
      connectivity: { ok: false },
      auth: { ok: false },
    },
    errors: [],
  };

  // ---- Step 1: config check ----
  const config = validateConfig();
  result.provider = config.provider;
  result.model = config.model;

  if (!config.valid) {
    result.checks.config = { ok: false, detail: config.issues.join(' ') };
    result.status = 'unhealthy';
    result.errors.push('bad_config');
    return NextResponse.json(result, { status: 200 });
  }
  result.checks.config = { ok: true };

  // ---- Step 2: connectivity test ----
  const baseURL = config.provider === 'deepseek'
    ? (process.env.DEEPSEEK_API_BASE ?? 'https://api.deepseek.com/v1')
    : (process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1');

  try {
    const start = Date.now();
    const resp = await fetch(`${baseURL}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env[config.provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY']}` },
      signal: AbortSignal.timeout(10_000),
    });
    const latency = Date.now() - start;

    // 401 on /models is fine for auth check, but connectivity is ok
    if (resp.ok || resp.status === 401) {
      result.checks.connectivity = { ok: true, latency_ms: latency };
    } else {
      result.checks.connectivity = { ok: true, latency_ms: latency, detail: `HTTP ${resp.status}` };
    }
  } catch (err) {
    result.checks.connectivity = { ok: false, detail: classifyError(err).detail };
    result.status = 'degraded';
    result.errors.push('network_error');
  }

  // ---- Step 3: auth + model test (minimal chat) ----
  if (result.checks.connectivity.ok) {
    try {
      const chatURL = `${baseURL}/chat/completions`;
      const pingMessages: LLMMessage[] = [{ role: 'user', content: 'ping' }];
      const apiKey = process.env[config.provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY'];

      const resp = await fetch(chatURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: pingMessages,
          max_tokens: 1,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!resp.ok) {
        const body = await resp.text();
        const classified = classifyError(new Error(`LLM API error ${resp.status}: ${body}`));
        result.checks.auth = { ok: false, detail: classified.detail };
        result.errors.push(classified.error);
        if (result.status === 'healthy') result.status = 'degraded';
      } else {
        result.checks.auth = { ok: true };
      }
    } catch (err) {
      const classified = classifyError(err);
      result.checks.auth = { ok: false, detail: classified.detail };
      result.errors.push(classified.error);
      if (result.status === 'healthy') result.status = 'degraded';
    }
  } else {
    result.checks.auth = { ok: false, detail: '连通性检查未通过，跳过鉴权检测' };
  }

  // ---- Final status ----
  if (result.errors.length > 0 && result.status === 'healthy') {
    result.status = 'degraded';
  }

  return NextResponse.json(result);
}
