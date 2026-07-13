#!/usr/bin/env tsx
import { mkdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { db } from '../app/lib/db';

async function main() {
  const backupDir = path.join(process.cwd(), 'backups');
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const requested = process.argv.find((item) => item.startsWith('--output='))?.slice('--output='.length);
  const output = path.resolve(requested || path.join(backupDir, `dev-${stamp}.bak`));
  if (!output.startsWith(path.resolve(backupDir) + path.sep)) {
    throw new Error('备份文件必须位于项目 backups 目录内');
  }
  const sqlitePath = output.replace(/\\/g, '/').replace(/'/g, "''");
  await db.$executeRawUnsafe(`VACUUM INTO '${sqlitePath}'`);
  const bytes = await readFile(output);
  const info = await stat(output);
  console.log(JSON.stringify({
    path: output,
    bytes: info.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => db.$disconnect());
