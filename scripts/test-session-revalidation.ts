#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../app/lib/db';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

async function main() {
  const username = `session-test-${randomUUID().slice(0, 8)}`;
  const password = 'session-test-password';
  const user = await db.user.create({ data: { username, displayName: '会话验证测试', role: 'annotator', passwordHash: await bcrypt.hash(password, 4) } });
  try {
    const login = await fetch('http://127.0.0.1:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    check('启用账户可以登录', login.status === 200 && cookie.includes('hyacintech_session='));
    const before = await fetch('http://127.0.0.1:3000/api/auth/me', { headers: { Cookie: cookie } });
    check('新会话可以读取当前账户', before.status === 200);

    await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    const stale = await fetch('http://127.0.0.1:3000/api/auth/me', { headers: { Cookie: cookie } });
    check('会话版本变化后旧登录立即失效', stale.status === 401);

    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    const disabledLogin = await fetch('http://127.0.0.1:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    check('停用账户不能重新登录', disabledLogin.status === 401);
  } finally {
    await db.user.delete({ where: { id: user.id } });
  }
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
