export interface RateLimitResult {
  ok: boolean;
  error?: string;
}

interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

// 模块级内存存储（按 IP）。进程内有效；多实例/重启不共享 —— 体验模式够用。
const store = new Map<string, Window>();

/**
 * 纯逻辑滑动窗口限流（可注入 now 便于单测）。
 */
export function checkRateLimit(ip: string, now: number = Date.now()): RateLimitResult {
  const key = ip || 'unknown';
  const w = store.get(key);

  if (!w || now >= w.resetAt) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }

  if (w.count >= MAX_PER_WINDOW) {
    return { ok: false, error: '体验模式请求过于频繁，请稍后再试。' };
  }

  w.count += 1;
  return { ok: true };
}

/** 仅供测试：清空限流状态。 */
export function _resetRateLimit() {
  store.clear();
}

export const RATE_LIMIT_MAX = MAX_PER_WINDOW;
export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
