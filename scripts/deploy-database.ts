#!/usr/bin/env tsx
/**
 * Production-safe Prisma migration deploy.
 *
 * On Windows, Prisma/SQLite may create the empty file on the first invocation
 * but fail before applying migrations. A second `migrate deploy` is idempotent
 * and completes that first-install edge case. Existing databases are unchanged.
 */
import { spawnSync } from 'child_process';
import { closeSync, mkdirSync, openSync } from 'fs';
import path from 'path';
import './load-script-env';

const prismaCli = path.resolve('node_modules/prisma/build/index.js');
const databaseUrl = process.env.DATABASE_URL ?? '';
const sqlite = databaseUrl.startsWith('file:');

if (sqlite) {
  const configuredPath = databaseUrl.slice('file:'.length).split('?')[0];
  const databasePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve('prisma', configuredPath);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  closeSync(openSync(databasePath, 'a'));
}

function deploy() {
  return spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
}

const first = deploy();
if (sqlite && first.status !== 0) {
  console.warn('SQLite 首次迁移未完成，正在执行一次安全重试。');
  const retry = deploy();
  if (retry.error) throw retry.error;
  process.exit(retry.status ?? 1);
}
if (first.error) throw first.error;
process.exit(first.status ?? 1);
