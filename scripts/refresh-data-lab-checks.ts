#!/usr/bin/env tsx
import { createHash } from 'crypto';
import { db } from '../app/lib/db';
import type { AutoCheckResult, ShareGPTRecord } from '../app/lib/dataLab/types';
import { parseJson, validateShareGPTRecord } from '../app/lib/dataLab/validation';

const apply = process.argv.includes('--apply');

async function main() {
  const batches = await db.datasetBatch.findMany({
    include: { samples: { orderBy: { sourceRecordId: 'asc' } } },
    orderBy: { importedAt: 'asc' },
  });
  let total = 0;
  let changed = 0;
  let ok = 0;
  let warning = 0;
  let error = 0;
  const originalFingerprint = createHash('sha256');

  for (const batch of batches) {
    const updates: Array<{ id: string; check: AutoCheckResult }> = [];
    for (const sample of batch.samples) {
      total++;
      originalFingerprint.update(sample.sourceRecordId).update('\0').update(sample.originalRecordJson).update('\0');
      const record = parseJson<ShareGPTRecord>(sample.originalRecordJson, {} as ShareGPTRecord);
      const check = validateShareGPTRecord(record, 'import');
      if (check.status === 'ok') ok++;
      else if (check.status === 'warning') warning++;
      else error++;
      if (JSON.stringify(check) !== sample.autoCheckJson) {
        changed++;
        updates.push({ id: sample.id, check });
      }
    }

    if (apply && updates.length > 0) {
      const previousSummary = parseJson<Record<string, unknown>>(batch.summaryJson, {});
      const counts = batch.samples.map((sample) => updates.find((item) => item.id === sample.id)?.check ?? parseJson<AutoCheckResult>(sample.autoCheckJson, { status: 'error', issues: [] }));
      await db.$transaction(async (tx) => {
        for (const update of updates) {
          await tx.datasetSample.update({ where: { id: update.id }, data: { autoCheckJson: JSON.stringify(update.check) } });
        }
        await tx.datasetBatch.update({
          where: { id: batch.id },
          data: {
            summaryJson: JSON.stringify({
              ...previousSummary,
              autoCheck: {
                ok: counts.filter((item) => item.status === 'ok').length,
                warning: counts.filter((item) => item.status === 'warning').length,
                error: counts.filter((item) => item.status === 'error').length,
              },
            }),
          },
        });
      });
    }
  }

  console.log(`${apply ? '已刷新' : '只读预检'}：批次 ${batches.length}，样本 ${total}，派生检查需更新 ${changed}`);
  console.log(`新检查分布：ok=${ok}, warning=${warning}, error=${error}`);
  console.log(`原始记录内容指纹：${originalFingerprint.digest('hex')}`);
  if (!apply && changed > 0) console.log('确认数据库已备份后，可加 --apply 写入 autoCheckJson 与批次汇总；原始记录不会修改。');
}

main().finally(() => db.$disconnect());
