#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import { parseShareGPTDataset, sha256, validateShareGPTRecord } from '../app/lib/dataLab/validation';

const defaultFile = path.join(process.cwd(), 'data/sft/sharegpt-distill-dsv4-all-clean.json');
const file = process.argv.find((arg) => !arg.startsWith('--') && arg !== process.argv[0] && arg !== process.argv[1]) ?? defaultFile;
const asJson = process.argv.includes('--json');

async function main() {
  const raw = await readFile(path.resolve(file), 'utf8');
  const records = parseShareGPTDataset(raw);
  const issueCounts: Record<string, number> = {};
  const affected = new Map<string, string[]>();
  const byPhase: Record<string, number> = {};

  for (const record of records) {
    byPhase[`P${record.phase}`] = (byPhase[`P${record.phase}`] ?? 0) + 1;
    const check = validateShareGPTRecord(record, 'release');
    const contractIssues = check.issues.filter((item) =>
      item.ruleCode.startsWith('P2_') || item.ruleCode === 'ACTION_TYPE_INVALID'
    );
    if (contractIssues.length === 0) continue;
    affected.set(record.id, contractIssues.map((item) => item.ruleCode));
    for (const item of contractIssues) issueCounts[item.ruleCode] = (issueCounts[item.ruleCode] ?? 0) + 1;
  }

  const report = {
    file: path.resolve(file),
    sha256: sha256(raw),
    totalRecords: records.length,
    byPhase,
    affectedRecords: affected.size,
    issueCounts,
    records: [...affected].map(([id, issues]) => ({ id, issues })),
  };

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`文件: ${report.file}`);
    console.log(`SHA-256: ${report.sha256}`);
    console.log(`记录数: ${report.totalRecords}`);
    console.log(`阶段分布: ${Object.entries(byPhase).map(([phase, count]) => `${phase}=${count}`).join(', ')}`);
    console.log(`受结构契约影响的记录: ${report.affectedRecords}`);
    for (const [code, count] of Object.entries(issueCounts)) console.log(`  ${code}: ${count}`);
    for (const item of report.records) console.log(`  ${item.id}: ${item.issues.join(', ')}`);
  }
}

void main();
