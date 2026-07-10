#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'data/sft');
const BATCHES = ['calibration', 'batch100', 'batch200', 'batch300', 'batch400', 'batch500'];

interface RecordMeta {
  tier?: 'gold_candidate' | 'silver';
  sourceKind?: string;
}

interface ShareGPTRecord {
  id: string;
  phase: number;
  meta: RecordMeta;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const records: ShareGPTRecord[] = [];
  const sources: Array<{ batch: string; file: string; count: number }> = [];
  const ids = new Set<string>();

  for (const batch of BATCHES) {
    const file = path.join(OUT_DIR, `sharegpt-distill-dsv4-${batch}-clean.json`);
    const batchRecords = await readJson<ShareGPTRecord[]>(file);
    for (const record of batchRecords) {
      if (ids.has(record.id)) throw new Error(`duplicate-id:${record.id}`);
      ids.add(record.id);
      records.push(record);
    }
    sources.push({ batch, file, count: batchRecords.length });
  }

  const gold = records.filter((record) => record.meta.tier === 'gold_candidate');
  const silver = records.filter((record) => record.meta.tier === 'silver');
  const byPhase: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const record of records) {
    byPhase[`P${record.phase}`] = (byPhase[`P${record.phase}`] ?? 0) + 1;
    const source = record.meta.sourceKind ?? 'unknown';
    bySource[source] = (bySource[source] ?? 0) + 1;
  }

  const cleanOut = path.join(OUT_DIR, 'sharegpt-distill-dsv4-all-clean.json');
  const goldOut = path.join(OUT_DIR, 'sharegpt-distill-dsv4-all-gold-candidate.json');
  const silverOut = path.join(OUT_DIR, 'sharegpt-distill-dsv4-all-silver.json');
  const manifestOut = path.join(OUT_DIR, 'merge-manifest-distill-dsv4-all.json');
  await writeJson(cleanOut, records);
  await writeJson(goldOut, gold);
  await writeJson(silverOut, silver);
  await writeJson(manifestOut, {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sources,
    outputs: { clean: cleanOut, goldCandidate: goldOut, silver: silverOut },
    summary: {
      clean: records.length,
      goldCandidate: gold.length,
      silver: silver.length,
      uniqueIds: ids.size,
      byPhase,
      bySource,
    },
  });

  console.log(JSON.stringify({
    clean: records.length,
    goldCandidate: gold.length,
    silver: silver.length,
    uniqueIds: ids.size,
    byPhase,
    bySource,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
