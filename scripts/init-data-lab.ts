#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import { db } from '../app/lib/db';
import { importDatasetBatch } from '../app/lib/dataLab/service';
import type { SessionUser } from '../app/lib/session';

const DATASET = path.join(process.cwd(), 'data/sft/sharegpt-distill-dsv4-all-clean.json');
const MANIFEST = path.join(process.cwd(), 'data/sft/merge-manifest-distill-dsv4-all.json');

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
  const user: SessionUser = { id: admin.id, username: admin.username, displayName: admin.displayName, role: 'admin' };
  const existing = await db.datasetBatch.findUnique({ where: { name: 'dataset-base-v1' } });
  if (existing) {
    console.log(JSON.stringify({ admin: admin.username, batch: existing.name, status: 'already-imported' }, null, 2));
    return;
  }
  const [raw, manifestRaw] = await Promise.all([readFile(DATASET, 'utf8'), readFile(MANIFEST, 'utf8')]);
  const result = await importDatasetBatch({
    name: 'dataset-base-v1',
    sourceType: 'sharegpt_clean',
    sourceFileName: path.basename(DATASET),
    raw,
    manifest: JSON.parse(manifestRaw),
    user,
  });
  console.log(JSON.stringify({ admin: admin.username, batch: result.batch.name, summary: result.summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => db.$disconnect());
