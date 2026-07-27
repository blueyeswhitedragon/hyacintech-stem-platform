#!/usr/bin/env tsx
import './load-script-env';

import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { db } from '../app/lib/db';
import { repairProductionCandidateFocusValidation } from '../app/lib/dataLab/productionCandidateRepair';

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function verifiedBackup() {
  const rawPath = arg('--backup');
  const expectedSha256 = arg('--backup-sha')?.toLowerCase();
  if (!rawPath || !expectedSha256) throw new Error('--apply requires --backup <path> and --backup-sha <sha256>');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('--backup-sha must be a lowercase SHA-256');
  const absolutePath = path.resolve(rawPath);
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error(`Backup is not a file: ${absolutePath}`);
  const bytes = await readFile(absolutePath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) throw new Error(`Backup SHA-256 mismatch for ${absolutePath}`);
  return { path: path.relative(process.cwd(), absolutePath) || absolutePath, sha256: actualSha256 };
}

async function main() {
  const actorUsername = arg('--actor');
  if (!actorUsername) {
    throw new Error('Usage: npx tsx scripts/repair-production-focus-validation.ts --actor <active-admin> [--apply --backup <path> --backup-sha <sha256>]');
  }
  const apply = hasFlag('--apply');
  const result = await repairProductionCandidateFocusValidation({
    client: db,
    actorUsername,
    apply,
    verifiedBackup: apply ? await verifiedBackup() : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
