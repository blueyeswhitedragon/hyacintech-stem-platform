import { createHash } from 'crypto';
import { mkdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { db } from '@/app/lib/db';

export async function createDataLabBackup() {
  const backupDir = path.join(process.cwd(), 'backups');
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.join(backupDir, `dev-${stamp}.bak`);
  const sqlitePath = output.replace(/\\/g, '/').replace(/'/g, "''");
  await db.$executeRawUnsafe(`VACUUM INTO '${sqlitePath}'`);
  const bytes = await readFile(output);
  const info = await stat(output);
  return { path: output, bytes: info.size, sha256: createHash('sha256').update(bytes).digest('hex') };
}
