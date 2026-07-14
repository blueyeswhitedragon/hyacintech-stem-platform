#!/usr/bin/env tsx
import bcrypt from 'bcryptjs';
import { db } from '../app/lib/db';
import { createCampaign, startCampaign } from '../app/lib/dataLab/service';
import type { SessionUser } from '../app/lib/session';
import './load-script-env';

async function upsertUser(username: string, displayName: string, role: 'annotator' | 'reviewer') {
  return db.user.upsert({
    where: { username },
    update: { displayName, role },
    create: { username, displayName, role, passwordHash: await bcrypt.hash('demo1234', 10) },
  });
}

async function main() {
  const admin = await db.user.findUnique({ where: { username: process.env.ADMIN_USERNAME ?? 'data-admin' } });
  if (!admin || admin.role !== 'admin') throw new Error('请先运行 data-lab:init 创建管理员');
  await Promise.all([
    upsertUser('annotator1', '标注员·甲', 'annotator'),
    upsertUser('annotator2', '标注员·乙', 'annotator'),
    upsertUser('reviewer1', '复审员·仲裁', 'reviewer'),
  ]);
  const existing = await db.annotationCampaign.findUnique({ where: { name: 'dataset-base-v1-pilot-12' } });
  if (existing) {
    console.log(JSON.stringify({ campaign: existing.name, status: existing.status, tasks: await db.annotationTask.count({ where: { campaignId: existing.id } }) }, null, 2));
    return;
  }
  const batch = await db.datasetBatch.findUnique({ where: { name: 'dataset-base-v1' } });
  if (!batch) throw new Error('dataset-base-v1 尚未导入');
  const user: SessionUser = { id: admin.id, username: admin.username, displayName: admin.displayName, role: 'admin' };
  const campaign = await createCampaign({
    name: 'dataset-base-v1-pilot-12',
    selection: { batchIds: [batch.id], phases: [1, 2, 3, 4, 5, 6], candidateTiers: ['gold_candidate', 'silver'], limit: 12 },
    goldSlots: 2,
    silverDoubleReviewPercent: 30,
    maxActivePerAnnotator: 1,
    styleQuota: {
      socratic_concise: 1,
      warm_companion: 1,
      engineering_mentor: 1,
      evidence_analyst: 1,
      classroom_coach: 1,
    },
    user,
  });
  const started = await startCampaign(campaign.id, user);
  const tasks = await db.annotationTask.findMany({ where: { campaignId: campaign.id }, include: { sample: true }, orderBy: [{ sample: { phase: 'asc' } }, { slot: 'asc' }] });
  const byPhase: Record<string, number> = {};
  const styles: Record<string, number> = {};
  for (const task of tasks) {
    byPhase[`P${task.sample.phase}`] = (byPhase[`P${task.sample.phase}`] ?? 0) + 1;
    styles[task.styleFamily ?? 'none'] = (styles[task.styleFamily ?? 'none'] ?? 0) + 1;
  }
  console.log(JSON.stringify({ campaign: campaign.name, samples: started.samples, tasks: tasks.length, byPhase, styles }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(async () => db.$disconnect());
