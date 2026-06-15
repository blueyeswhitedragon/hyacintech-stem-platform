/**
 * 确定性单测：checkRateLimit 滑动窗口（注入 now，无真实时间）。
 * 运行: npx tsx scripts/test-guest-ratelimit.ts
 */
import { checkRateLimit, _resetRateLimit, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from '../app/lib/guestRateLimit';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

console.log('checkRateLimit:');

// 窗口内 MAX 次放行，第 MAX+1 次拒绝
{
  _resetRateLimit();
  const t0 = 1_000_000;
  let allOk = true;
  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    if (!checkRateLimit('1.1.1.1', t0).ok) allOk = false;
  }
  check(`窗口内前 ${RATE_LIMIT_MAX} 次放行`, allOk);
  const over = checkRateLimit('1.1.1.1', t0);
  check('第 MAX+1 次被拒', over.ok === false && !!over.error);
}

// 窗口过期后重置
{
  _resetRateLimit();
  const t0 = 2_000_000;
  for (let i = 0; i < RATE_LIMIT_MAX; i++) checkRateLimit('2.2.2.2', t0);
  check('过期前已满被拒', checkRateLimit('2.2.2.2', t0).ok === false);
  const after = checkRateLimit('2.2.2.2', t0 + RATE_LIMIT_WINDOW_MS + 1);
  check('窗口过期后重置放行', after.ok === true);
}

// 不同 IP 独立计数
{
  _resetRateLimit();
  const t0 = 3_000_000;
  for (let i = 0; i < RATE_LIMIT_MAX; i++) checkRateLimit('3.3.3.3', t0);
  check('A 满后 B 仍放行', checkRateLimit('4.4.4.4', t0).ok === true);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
