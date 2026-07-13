#!/usr/bin/env tsx
/** CI-only deterministic Data Lab fixtures. Never imports production/legacy data. */
import { createHash } from 'crypto';
import { db } from '../app/lib/db';
import { ACTIVE_DATASET_BATCH_STATUS } from '../app/lib/dataLab/datasetPolicy';
import { createCampaign, startCampaign } from '../app/lib/dataLab/service';
import type { ShareGPTRecord } from '../app/lib/dataLab/types';
import type { SessionUser } from '../app/lib/session';
import { STAGE_CONTRACT_VERSION } from '../app/lib/stageContract';
import { DEFAULT_STYLE_POLICY_VERSION } from '../app/lib/stylePolicy';
import { getPromptForPhase } from '../app/prompts';
import { PhaseEnum } from '../app/models/types';

const BATCH_NAME = 'ci-dataset-v3-fixtures';
const CAMPAIGN_NAME = 'ci-dataset-v3-pilot';

function record(index: number): ShareGPTRecord {
  const prompt = getPromptForPhase(PhaseEnum.DataAnalysis, {
    styleFamily: 'evidence_analyst',
    stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION,
  });
  return {
    id: `ci-v3-fixture-${index}`,
    source: 'ci_fixture',
    scenario: `CI 当前合同样本 ${index}`,
    phase: 4,
    conversations: [
      { from: 'human', value: '第一轮低条件2、高条件5；第二轮低条件3、高条件7。' },
      { from: 'gpt', value: JSON.stringify({
        dialogue: '你引用了2、5、3、7。请比较两轮中两种条件的差值，再用这些证据写出一个观察。',
        next_action_type: 'text_input',
        phase_complete: false,
        analysis_progress: {
          observation: '学生已提供两轮可核验数据',
          evidenceCitations: ['第一轮2和5', '第二轮3和7'],
          studentEvidenceAccepted: true,
        },
      }) },
    ],
    meta: {
      tier: 'silver',
      sourceKind: 'stage_contract_rollout',
      styleFamily: 'evidence_analyst',
      stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION,
      stageContractVersion: STAGE_CONTRACT_VERSION,
      systemPrompt: prompt,
      stageTriggerType: 'USER_MESSAGE',
      visibleContext: '{"values":[1,2,3,5,7]}',
      generationContext: { turnSystemPrompts: [prompt], turnTriggerTypes: ['USER_MESSAGE'] },
    },
  };
}

async function upsertRole(username: string, displayName: string, role: 'annotator' | 'reviewer') {
  return db.user.upsert({
    where: { username },
    update: { displayName, role, isActive: true },
    create: { username, displayName, role, passwordHash: 'ci-test-only' },
  });
}

async function main() {
  const adminUsername = process.env.ADMIN_USERNAME ?? 'ci-admin';
  const admin = await db.user.findUnique({ where: { username: adminUsername } });
  if (!admin || admin.role !== 'admin') throw new Error('请先运行 data-lab:init 创建 CI 管理员');
  await Promise.all([
    upsertRole('ci-annotator-1', 'CI 标注员甲', 'annotator'),
    upsertRole('ci-annotator-2', 'CI 标注员乙', 'annotator'),
    upsertRole('ci-reviewer-1', 'CI 复审员', 'reviewer'),
  ]);

  let batch = await db.datasetBatch.findUnique({ where: { name: BATCH_NAME } });
  if (!batch) {
    const records = Array.from({ length: 12 }, (_, index) => record(index + 1));
    batch = await db.datasetBatch.create({
      data: {
        name: BATCH_NAME,
        sourceType: 'CI_TEST_FIXTURE',
        sourceFileName: 'generated-in-ci.json',
        sourceSha256: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
        status: ACTIVE_DATASET_BATCH_STATUS,
        importedById: admin.id,
        samples: {
          create: records.map((item) => ({
            sourceRecordId: item.id,
            familyKey: item.id,
            phase: item.phase,
            scenario: item.scenario,
            sourceKind: String(item.meta?.sourceKind),
            candidateTier: String(item.meta?.tier),
            originalRecordJson: JSON.stringify(item),
          })),
        },
      },
    });
  }
  let campaign = await db.annotationCampaign.findUnique({ where: { name: CAMPAIGN_NAME } });
  if (!campaign) {
    const user: SessionUser = { id: admin.id, username: admin.username, displayName: admin.displayName, role: 'admin' };
    campaign = await createCampaign({
      name: CAMPAIGN_NAME,
      selection: { batchIds: [batch.id], limit: 12 },
      goldSlots: 2,
      silverDoubleReviewPercent: 100,
      user,
    });
    await startCampaign(campaign.id, user);
    campaign = await db.annotationCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
  }
  console.log(JSON.stringify({ batch: batch.name, campaign: campaign.name, status: campaign.status }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}).finally(async () => db.$disconnect());
