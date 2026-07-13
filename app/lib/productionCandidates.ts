import { randomUUID } from 'crypto';
import { db } from '@/app/lib/db';
import type { Message } from '@/app/models/types';
import { detectDatasetLeakage } from '@/app/lib/datasetLeakage';
import {
  productionContentFingerprint,
  productionFamilyKey,
  redactProductionRecord,
} from '@/app/lib/redaction';
import type { ShareGPTRecord } from '@/app/lib/dataLab/types';
import { parseJson, sha256, validateShareGPTRecord } from '@/app/lib/dataLab/validation';

export const DATA_POLICY_VERSION = 'student-data-policy-v1';
export const CONSENT_STATUSES = ['PENDING', 'GRANTED', 'DECLINED', 'WITHDRAWN'] as const;

function parseMessages(raw: string): Message[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as Message[] : [];
  } catch {
    return [];
  }
}

async function audit(actorId: string, action: string, entityType: string, entityId: string, payload: unknown = {}) {
  await db.dataLabAuditLog.create({
    data: { actorId, action, entityType, entityId, payloadJson: JSON.stringify(payload) },
  });
}

export async function setStudentDataConsent(input: {
  studentAssignmentId: string;
  studentId: string;
  decision: 'GRANT' | 'DECLINE' | 'WITHDRAW';
}) {
  const item = await db.studentAssignment.findUnique({
    where: { id: input.studentAssignmentId },
    include: { assignment: true },
  });
  if (!item || item.studentId !== input.studentId) throw new Error('作业不存在或无权访问');
  if (item.assignment.dataContributionMode !== 'CONSENT_REQUIRED') {
    throw new Error('该作业未启用模型改进数据授权');
  }
  const next = input.decision === 'GRANT' ? 'GRANTED' : input.decision === 'DECLINE' ? 'DECLINED' : 'WITHDRAWN';
  if (input.decision === 'WITHDRAW' && item.dataConsentStatus !== 'GRANTED') {
    throw new Error('只有已授权状态可以撤回');
  }

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.studentAssignment.update({
      where: { id: item.id },
      data: {
        dataConsentStatus: next,
        dataConsentPolicyVersion: DATA_POLICY_VERSION,
        dataConsentDecidedAt: new Date(),
      },
    });
    if (next === 'WITHDRAWN' && item.conversationId) {
      await tx.productionCandidate.updateMany({
        where: { generationTrace: { conversationId: item.conversationId }, status: { not: 'REJECTED' } },
        data: { status: 'WITHDRAWN', processedAt: new Date() },
      });
    }
    await tx.dataLabAuditLog.create({
      data: {
        actorId: input.studentId,
        action: `DATA_CONSENT_${next}`,
        entityType: 'StudentAssignment',
        entityId: item.id,
        payloadJson: JSON.stringify({ policyVersion: DATA_POLICY_VERSION }),
      },
    });
    return result;
  });
  return updated;
}

async function leakageFor(record: ShareGPTRecord) {
  const samples = await db.datasetSample.findMany({ select: { id: true, originalRecordJson: true } });
  return detectDatasetLeakage(
    record,
    samples.map((sample) => ({ id: sample.id, record: parseJson<ShareGPTRecord>(sample.originalRecordJson, {} as ShareGPTRecord) }))
  );
}

export async function nominateProductionCandidate(input: {
  studentAssignmentId: string;
  assistantMessageId: string;
  teacherId: string;
  triggerType: string;
  triggerNote?: string;
}) {
  const trace = await db.generationTrace.findUnique({
    where: { assistantMessageId: input.assistantMessageId },
    include: {
      conversation: {
        include: {
          user: { select: { username: true, displayName: true } },
          studentAssignment: {
            include: {
              assignment: {
                include: {
                  class: {
                    include: { teacher: { select: { username: true, displayName: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const studentAssignment = trace?.conversation.studentAssignment;
  if (!trace || !studentAssignment || studentAssignment.id !== input.studentAssignmentId) throw new Error('生成轨迹不存在');
  if (studentAssignment.assignment.class.teacherId !== input.teacherId) throw new Error('无权提名该会话');
  if (studentAssignment.assignment.dataContributionMode !== 'CONSENT_REQUIRED') throw new Error('该作业未开启数据回流');
  if (studentAssignment.dataConsentStatus !== 'GRANTED') throw new Error('学生尚未授权或已撤回授权');
  if (trace.conversation.traceCoverage !== 'COMPLETE') throw new Error('历史不可验证会话不能进入候选池');

  const messages = parseMessages(trace.conversation.messages);
  const userMessage = messages.find((message) => message.id === trace.userMessageId);
  if (!userMessage) throw new Error('无法找到轨迹对应的学生消息');
  const response = parseJson<Record<string, unknown>>(trace.responseJson, {});
  const record: ShareGPTRecord = {
    id: `production-trace-${trace.id}`,
    source: 'production_trace',
    scenario: `正式教学会话 · 阶段${trace.stage}`,
    phase: trace.stage,
    rubricTargets: ['human_correction_required'],
    conversations: [
      { from: 'human', value: userMessage.content },
      { from: 'gpt', value: JSON.stringify(response) },
    ],
    meta: {
      tier: 'production_candidate',
      sourceKind: 'production_trace',
      styleFamily: trace.styleFamily as ShareGPTRecord['meta'] extends { styleFamily?: infer T } ? T : never,
      stylePolicyVersion: trace.stylePolicyVersion,
    },
  };
  const { record: redacted, report } = redactProductionRecord(record, [
    trace.conversation.user.username,
    trace.conversation.user.displayName,
    studentAssignment.assignment.class.name,
    studentAssignment.assignment.class.teacher.username,
    studentAssignment.assignment.class.teacher.displayName,
  ], DATA_POLICY_VERSION);
  const leakage = await leakageFor(redacted);

  const candidate = await db.productionCandidate.create({
    data: {
      generationTraceId: trace.id,
      triggerType: input.triggerType || 'TEACHER_NOMINATION',
      triggerNote: input.triggerNote?.trim() || '',
      signalJson: JSON.stringify({ stage: trace.stage, styleFamily: trace.styleFamily }),
      consentStatusSnapshot: studentAssignment.dataConsentStatus,
      dataPolicyVersion: DATA_POLICY_VERSION,
      redactedRecordJson: JSON.stringify(redacted),
      redactionReportJson: JSON.stringify(report),
      contentSha256: productionContentFingerprint(redacted),
      familyKey: productionFamilyKey(redacted),
      leakageCheckJson: JSON.stringify(leakage),
      nominatedById: input.teacherId,
    },
  });
  await audit(input.teacherId, 'PRODUCTION_CANDIDATE_NOMINATED', 'ProductionCandidate', candidate.id, { triggerType: candidate.triggerType });
  return candidate;
}

export function listProductionCandidates(status?: string) {
  return db.productionCandidate.findMany({
    where: status ? { status } : undefined,
    include: {
      generationTrace: {
        select: {
          stage: true,
          styleFamily: true,
          stylePolicyVersion: true,
          modelVersion: { select: { tag: true } },
        },
      },
      nominatedBy: { select: { displayName: true } },
      processedBy: { select: { displayName: true } },
      convertedSample: { select: { sourceRecordId: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function reviewProductionCandidate(input: {
  id: string;
  action: 'APPROVE' | 'REJECT';
  reason?: string;
  adminId: string;
}) {
  const candidate = await db.productionCandidate.findUnique({
    where: { id: input.id },
    include: { generationTrace: { include: { conversation: { include: { studentAssignment: true } } } } },
  });
  if (!candidate || candidate.status !== 'NOMINATED') throw new Error('候选不存在或已处理');
  const consent = candidate.generationTrace.conversation.studentAssignment?.dataConsentStatus;
  if (input.action === 'APPROVE' && consent !== 'GRANTED') throw new Error('学生授权已失效，不能通过');
  const leakage = await leakageFor(parseJson(candidate.redactedRecordJson, {} as ShareGPTRecord));
  if (input.action === 'APPROVE' && leakage.blocked) throw new Error('候选与现有数据精确重复，不能通过');
  const status = input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const updated = await db.productionCandidate.update({
    where: { id: candidate.id },
    data: {
      status,
      leakageCheckJson: JSON.stringify(leakage),
      processedById: input.adminId,
      rejectionReason: input.action === 'REJECT' ? input.reason?.trim() || '管理员拒绝' : '',
      processedAt: new Date(),
    },
  });
  await audit(input.adminId, `PRODUCTION_CANDIDATE_${status}`, 'ProductionCandidate', candidate.id, { reason: input.reason ?? '' });
  return updated;
}

export async function convertProductionCandidates(input: { ids: string[]; batchName: string; adminId: string }) {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0 || !input.batchName.trim()) throw new Error('请选择候选并填写批次名称');
  const candidates = await db.productionCandidate.findMany({
    where: { id: { in: ids } },
    include: { generationTrace: { include: { conversation: { include: { studentAssignment: true } } } } },
  });
  if (candidates.length !== ids.length || candidates.some((item) => item.status !== 'APPROVED')) throw new Error('只能转换全部处于 APPROVED 的候选');
  if (candidates.some((item) => item.generationTrace.conversation.studentAssignment?.dataConsentStatus !== 'GRANTED')) throw new Error('部分候选授权已失效');

  const batchId = randomUUID();
  const records = candidates.map((item) => parseJson<ShareGPTRecord>(item.redactedRecordJson, {} as ShareGPTRecord));
  const summary = { records: records.length, sourceType: 'production_trace', requiresHumanCorrection: records.length };
  const batch = await db.$transaction(async (tx) => {
    const created = await tx.datasetBatch.create({
      data: {
        id: batchId,
        name: input.batchName.trim(),
        sourceType: 'production_trace',
        sourceFileName: `production-candidates-${batchId}.json`,
        sourceSha256: sha256(JSON.stringify(records)),
        manifestJson: JSON.stringify({ schemaVersion: 1, candidateIds: ids, dataPolicyVersion: DATA_POLICY_VERSION }),
        summaryJson: JSON.stringify(summary),
        importedById: input.adminId,
      },
    });
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const record = records[index];
      const check = validateShareGPTRecord(record);
      const sample = await tx.datasetSample.create({
        data: {
          batchId: created.id,
          sourceRecordId: record.id,
          familyKey: candidate.familyKey,
          phase: record.phase,
          scenario: record.scenario,
          sourceKind: 'production_trace',
          candidateTier: 'production_candidate',
          rubricTargetsJson: JSON.stringify(record.rubricTargets ?? []),
          autoCheckJson: JSON.stringify(check),
          originalRecordJson: JSON.stringify(record),
        },
      });
      await tx.productionCandidate.update({
        where: { id: candidate.id },
        data: { status: 'CONVERTED', convertedSampleId: sample.id, processedAt: new Date() },
      });
    }
    await tx.dataLabAuditLog.create({
      data: { actorId: input.adminId, action: 'PRODUCTION_CANDIDATES_CONVERTED', entityType: 'DatasetBatch', entityId: created.id, payloadJson: JSON.stringify({ candidateIds: ids }) },
    });
    return created;
  });
  return { batch, summary };
}
