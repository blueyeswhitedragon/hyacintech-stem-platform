#!/usr/bin/env tsx
import { db } from '../app/lib/db';
import { normalizeLegacyEmptyStage2Schemas, parseJson } from '../app/lib/dataLab/validation';
import type { RevisionInput } from '../app/lib/dataLab/types';

async function main() {
  const apply = process.argv.includes('--apply');
  const tasks = await db.annotationTask.findMany({
    where: { status: { in: ['PENDING', 'IN_PROGRESS', 'RETURNED'] } },
    select: { id: true, status: true, assignedToId: true, draftJson: true, sample: { select: { sourceRecordId: true, scenario: true } } },
  });
  const repairs: Array<{ taskId: string; sourceRecordId: string; scenario: string; messageIndexes: number[]; draftJson: string }> = [];
  for (const task of tasks) {
    const draft = parseJson<Partial<RevisionInput>>(task.draftJson, {});
    if (!Array.isArray(draft.assistantMessages)) continue;
    const normalized = normalizeLegacyEmptyStage2Schemas(draft as RevisionInput);
    if (normalized.removedMessageIndexes.length === 0) continue;
    repairs.push({
      taskId: task.id,
      sourceRecordId: task.sample.sourceRecordId,
      scenario: task.sample.scenario,
      messageIndexes: normalized.removedMessageIndexes,
      draftJson: JSON.stringify(normalized.input),
    });
  }

  if (apply && repairs.length > 0) {
    const admin = await db.user.findFirstOrThrow({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
    for (const repair of repairs) {
      await db.$transaction([
        db.annotationTask.update({ where: { id: repair.taskId }, data: { draftJson: repair.draftJson } }),
        db.dataLabAuditLog.create({
          data: {
            actorId: admin.id,
            action: 'EMPTY_STAGE2_SCHEMA_DRAFT_REPAIRED',
            entityType: 'AnnotationTask',
            entityId: repair.taskId,
            payloadJson: JSON.stringify({ messageIndexes: repair.messageIndexes, source: 'repair-empty-stage2-drafts' }),
          },
        }),
      ]);
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    scanned: tasks.length,
    repairs: repairs.map((item) => ({
      taskId: item.taskId,
      sourceRecordId: item.sourceRecordId,
      scenario: item.scenario,
      messageIndexes: item.messageIndexes,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => db.$disconnect());
