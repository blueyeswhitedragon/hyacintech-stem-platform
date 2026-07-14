#!/usr/bin/env tsx
import { readFile, unlink } from 'fs/promises';
import { db } from '../app/lib/db';
import {
  createCampaign,
  createDatasetRelease,
  freezeDatasetRelease,
  reviewAnnotationWork,
  startCampaign,
  submitAnnotationTask,
} from '../app/lib/dataLab/service';
import { DEFAULT_STYLE_POLICY_VERSION, resolveStyleFamily } from '../app/lib/stylePolicy';
import { STAGE_CONTRACT_VERSION } from '../app/lib/stageContract';
import { ACTIVE_DATASET_BATCH_STATUS } from '../app/lib/dataLab/datasetPolicy';
import { getPromptForPhase } from '../app/prompts';
import { PhaseEnum } from '../app/models/types';
import type { SessionUser } from '../app/lib/session';
import { parseAssistantResponse, parseJson } from '../app/lib/dataLab/validation';
import type { RevisionInput, ShareGPTRecord } from '../app/lib/dataLab/types';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

function sessionUser(user: { id: string; username: string; displayName: string; role: string }): SessionUser {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role as SessionUser['role'] };
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const membership = await db.classMember.findFirst({ include: { class: true, student: true } });
  if (!membership) throw new Error('需要至少一条班级成员关系才能测试会话风格持久化');
  const [adminRow, annotatorRow] = await Promise.all([
    db.user.create({ data: { username: `style-admin-${suffix}`, displayName: '测试管理员', passwordHash: 'test-only', role: 'admin' } }),
    db.user.create({ data: { username: `style-annotator-${suffix}`, displayName: '测试标注员', passwordHash: 'test-only', role: 'annotator' } }),
  ]);

  const fixtureRecord: ShareGPTRecord = {
    id: `style-fixture-${suffix}`,
    source: 'test',
    scenario: '风格持久化测试',
    phase: 4,
    conversations: [
      { from: 'human', value: '第1次短光照2粒、长光照5粒；第2次短光照3粒、长光照7粒。' },
      { from: 'gpt', value: JSON.stringify({
        dialogue: '你引用了2、5、3、7。先比较两组从第一次到第二次的变化幅度，这些证据支持怎样的观察？',
        next_action_type: 'text_input',
        phase_complete: false,
        analysis_progress: {
          observation: '第1次短光照2粒、长光照5粒；第2次短光照3粒、长光照7粒。',
          evidenceCitations: ['第1次：2和5', '第2次：3和7'],
          studentEvidenceAccepted: true,
        },
      }) },
    ],
    meta: {
      sourceKind: 'stage_contract_rollout',
      stageContractVersion: STAGE_CONTRACT_VERSION,
      systemPrompt: getPromptForPhase(PhaseEnum.DataAnalysis, { styleFamily: 'evidence_analyst', stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION }),
      stageTriggerType: 'USER_MESSAGE',
      visibleContext: JSON.stringify({
        tutorVisible: { dataRows: [{ short: 2, long: 5 }, { short: 3, long: 7 }] },
        studentMessages: ['第1次短光照2粒、长光照5粒；第2次短光照3粒、长光照7粒。'],
      }),
      generationContext: { turnSystemPrompts: [getPromptForPhase(PhaseEnum.DataAnalysis, { styleFamily: 'evidence_analyst', stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION })], turnTriggerTypes: ['USER_MESSAGE'] },
    },
  };
  const batch = await db.datasetBatch.create({
    data: {
      name: `style-active-${suffix}`,
      sourceType: 'TEST',
      sourceFileName: 'style-fixture.json',
      sourceSha256: `style-${suffix}`,
      status: ACTIVE_DATASET_BATCH_STATUS,
      importedById: adminRow.id,
      samples: {
        create: [0, 1].map((index) => ({
          sourceRecordId: `${fixtureRecord.id}-${index}`,
          familyKey: `${fixtureRecord.id}-${index}`,
          phase: fixtureRecord.phase,
          scenario: fixtureRecord.scenario,
          sourceKind: 'stage_contract_rollout',
          candidateTier: 'silver',
          originalRecordJson: JSON.stringify({ ...fixtureRecord, id: `${fixtureRecord.id}-${index}` }),
          autoCheckJson: '{}',
        })),
      },
    },
  });

  let assignmentId: string | null = null;
  let conversationId: string | null = null;
  let studentAssignmentId: string | null = null;
  let campaignId: string | null = null;
  let releaseCampaignId: string | null = null;
  let releaseId: string | null = null;
  const generatedPaths: string[] = [];

  try {
    const assignment = await db.assignment.create({
      data: {
        classId: membership.classId,
        title: `style-persistence-${suffix}`,
        assistantStyleFamily: 'warm_companion',
        stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION,
      },
    });
    assignmentId = assignment.id;
    const resolvedStyleFamily = resolveStyleFamily('warm_companion', assignment.id, membership.studentId);
    const conversation = await db.conversation.create({
      data: {
        userId: membership.studentId,
        resolvedStyleFamily,
        stylePolicyVersion: assignment.stylePolicyVersion,
      },
    });
    conversationId = conversation.id;
    const studentAssignment = await db.studentAssignment.create({
      data: {
        assignmentId: assignment.id,
        studentId: membership.studentId,
        conversationId: conversation.id,
        status: 'IN_PROGRESS',
        currentStage: 1,
      },
    });
    studentAssignmentId = studentAssignment.id;
    const persisted = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    check('会话固化教师选择的风格', persisted.resolvedStyleFamily === 'warm_companion');
    check('会话固化风格规范版本', persisted.stylePolicyVersion === DEFAULT_STYLE_POLICY_VERSION);

    const campaign = await createCampaign({
      name: `style-slots-${suffix}`,
      selection: { batchIds: [batch.id], limit: 2 },
      styleQuota: { socratic_concise: 1, warm_companion: 1 },
      goldSlots: 2,
      silverDoubleReviewPercent: 100,
      user: sessionUser(adminRow),
    });
    campaignId = campaign.id;
    await startCampaign(campaign.id, sessionUser(adminRow));
    const tasks = await db.annotationTask.findMany({ where: { campaignId: campaign.id }, orderBy: [{ sampleId: 'asc' }, { slot: 'asc' }] });
    const stylesBySample = new Map<string, Set<string | null>>();
    for (const task of tasks) {
      if (!stylesBySample.has(task.sampleId)) stylesBySample.set(task.sampleId, new Set());
      stylesBySample.get(task.sampleId)?.add(task.styleFamily);
    }
    check('测试活动产生双标任务', [...stylesBySample.values()].some((styles) => styles.size === 1) && tasks.length >= 4);
    check('每个样本的所有槽位共享目标风格', [...stylesBySample.values()].every((styles) => styles.size === 1));
    check('任务保存创建时的风格规范版本', tasks.every((task) => task.stylePolicyVersion === DEFAULT_STYLE_POLICY_VERSION));

    const annotator = annotatorRow;
    const releaseCampaign = await createCampaign({
      name: `style-release-${suffix}`,
      selection: { batchIds: [batch.id], candidateTiers: ['silver'], limit: 1 },
      styleQuota: { evidence_analyst: 1 },
      goldSlots: 1,
      silverDoubleReviewPercent: 0,
      user: sessionUser(adminRow),
    });
    releaseCampaignId = releaseCampaign.id;
    await startCampaign(releaseCampaign.id, sessionUser(adminRow));
    const releaseTask = await db.annotationTask.findFirstOrThrow({ where: { campaignId: releaseCampaign.id }, include: { sample: true } });
    await db.annotationTask.update({ where: { id: releaseTask.id }, data: { assignedToId: annotator.id, status: 'IN_PROGRESS' } });
    const original = parseJson<ShareGPTRecord>(releaseTask.sample.originalRecordJson, {} as ShareGPTRecord);
    const revisionInput: RevisionInput = {
      assistantMessages: original.conversations.flatMap((message, index) => message.from === 'gpt'
        ? [{ messageIndex: index, response: parseAssistantResponse(message.value) }]
        : []),
      issueTags: [],
      changeReason: 'M9A2 风格导出集成测试',
      noChange: true,
    };
    const submitted = await submitAnnotationTask(releaseTask.id, revisionInput, sessionUser(annotator));
    check('提交修订固化目标风格', submitted.revision.styleFamily === 'evidence_analyst' && submitted.revision.stylePolicyVersion === DEFAULT_STYLE_POLICY_VERSION);
    const revisedRecord = parseJson<ShareGPTRecord>(submitted.revision.fullRecordJson, {} as ShareGPTRecord);
    check('修订完整记录包含风格元数据', revisedRecord.meta?.styleFamily === 'evidence_analyst');
    const workReview = await db.annotationWorkReview.findUniqueOrThrow({ where: { revisionId: submitted.revision.id } });
    await reviewAnnotationWork({ reviewId: workReview.id, status: 'APPROVED', user: sessionUser(adminRow) });
    const release = await createDatasetRelease({ version: `style-export-${suffix}`, campaignId: releaseCampaign.id, user: sessionUser(adminRow) });
    releaseId = release.id;
    const releaseSummary = await freezeDatasetRelease(release.id, sessionUser(adminRow));
    const frozen = await db.datasetRelease.findUniqueOrThrow({ where: { id: release.id }, include: { items: true } });
    for (const filePath of [frozen.cleanPath, frozen.goldPath, frozen.silverPath, frozen.trainingPath, frozen.preferencePath, frozen.manifestPath]) {
      if (filePath) generatedPaths.push(filePath);
    }
    check('冻结版本生成独立 training 文件', !!frozen.trainingPath && !!frozen.trainingSha256);
    check('冻结版本生成独立 preference 文件', !!frozen.preferencePath && !!frozen.preferenceSha256);
    check('发布条目固化最终目标风格', frozen.items.length === 1 && frozen.items[0].styleFamily === 'evidence_analyst');
    const trainingRecords = JSON.parse(await readFile(frozen.trainingPath!, 'utf8')) as Array<{ conversations: Array<{ from: string; value: string }> }>;
    check('training 文件把风格作为首条 system 消息', trainingRecords[0]?.conversations[0]?.from === 'system' && trainingRecords[0].conversations[0].value.includes('证据分析型'));
    check('外部基线不会伪造生产偏好对', (JSON.parse(await readFile(frozen.preferencePath!, 'utf8')) as unknown[]).length === 0);
    const styleSummary = releaseSummary as { byStyle?: Record<string, number> };
    check('冻结汇总按实际入选风格计数', styleSummary.byStyle?.evidence_analyst === 1);
  } finally {
    if (releaseId) await db.datasetRelease.delete({ where: { id: releaseId } }).catch(() => undefined);
    if (releaseCampaignId) await db.annotationCampaign.delete({ where: { id: releaseCampaignId } }).catch(() => undefined);
    if (campaignId) {
      await db.annotationCampaign.delete({ where: { id: campaignId } }).catch(() => undefined);
      await db.dataLabAuditLog.deleteMany({ where: { entityType: 'AnnotationCampaign', entityId: campaignId } });
    }
    await db.dataLabAuditLog.deleteMany({ where: { entityId: { in: [releaseId, releaseCampaignId].filter((value): value is string => !!value) } } });
    await Promise.all(generatedPaths.map((filePath) => unlink(filePath).catch(() => undefined)));
    if (studentAssignmentId) await db.studentAssignment.delete({ where: { id: studentAssignmentId } }).catch(() => undefined);
    if (conversationId) await db.conversation.delete({ where: { id: conversationId } }).catch(() => undefined);
    if (assignmentId) await db.assignment.delete({ where: { id: assignmentId } }).catch(() => undefined);
    await db.datasetBatch.delete({ where: { id: batch.id } }).catch(() => undefined);
    await db.dataLabAuditLog.deleteMany({ where: { actorId: { in: [adminRow.id, annotatorRow.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminRow.id, annotatorRow.id] } } });
  }

  console.log(`\nStyle persistence tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => db.$disconnect());
