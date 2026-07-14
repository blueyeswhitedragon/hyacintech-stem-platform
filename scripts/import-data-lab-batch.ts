#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import { db } from '../app/lib/db';
import { importDatasetBatch } from '../app/lib/dataLab/service';
import type { SessionUser } from '../app/lib/session';
import './load-script-env';

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const file = flag('--file');
  const name = flag('--batch');
  const manifestFile = flag('--manifest');
  const sourceType = flag('--source-type', 'stage_contract_rollout')!;
  if (!file || !name) {
    throw new Error('用法：npm run data-lab:import -- --file <dataset.json> --batch <批次名> [--manifest <manifest.json>]');
  }
  const username = process.env.ADMIN_USERNAME?.trim();
  if (!username) throw new Error('请在 .env 设置 ADMIN_USERNAME');
  const admin = await db.user.findUnique({ where: { username } });
  if (!admin || admin.role !== 'admin' || !admin.isActive) throw new Error('ADMIN_USERNAME 不是可用管理员账号');
  const user: SessionUser = { id: admin.id, username: admin.username, displayName: admin.displayName, role: 'admin' };
  const [raw, manifest] = await Promise.all([
    readFile(path.resolve(file), 'utf8'),
    manifestFile ? readFile(path.resolve(manifestFile), 'utf8').then(JSON.parse) : Promise.resolve(undefined),
  ]);
  const result = await importDatasetBatch({
    name,
    sourceType,
    sourceFileName: path.basename(file),
    raw,
    manifest,
    user,
  });
  console.log(JSON.stringify({ batch: result.batch.name, status: result.batch.status, summary: result.summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}).finally(async () => db.$disconnect());
