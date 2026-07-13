#!/usr/bin/env tsx
import bcrypt from 'bcryptjs';
import { db } from '../app/lib/db';
import './load-script-env';

async function main() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_DISPLAY_NAME?.trim();
  if (!username || !password || !displayName) {
    throw new Error('请在 .env 设置 ADMIN_USERNAME、ADMIN_PASSWORD、ADMIN_DISPLAY_NAME');
  }
  if (password.length < 8) throw new Error('ADMIN_PASSWORD 至少 8 个字符');
  const admin = await db.user.upsert({
    where: { username },
    update: { role: 'admin', displayName, passwordHash: await bcrypt.hash(password, 10) },
    create: { username, role: 'admin', displayName, passwordHash: await bcrypt.hash(password, 10) },
  });
  console.log(JSON.stringify({ admin: admin.username, status: 'ready', note: '管理员初始化不会自动导入任何数据集' }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => db.$disconnect());
