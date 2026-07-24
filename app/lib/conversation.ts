import 'server-only';
import { db } from './db';
import type { Message } from '@/app/models/types';
import type { AssignmentStatus, StageData } from '@/app/models/stageData';
import { initialWelcomeMessage } from './welcome';
import { ensureRuntimeModelVersion } from './modelRegistry';
import { TUTOR_LANGUAGE_CONTRACT_VERSION } from './tutorLanguage';
import { recoverStageDataV3, studentVisibleStageData } from './stageState';
import {
  DEFAULT_STYLE_FAMILY,
  DEFAULT_STYLE_POLICY_VERSION,
  isStyleFamily,
  resolveStyleFamily,
  type AssistantStyleSelection,
  type StyleFamily,
} from './stylePolicy';

export { initialWelcomeMessage };

/** 把数据库里的 messages JSON 字符串安全解析为 Message[]。 */
export function parseMessages(raw: string): Message[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Message[]) : [];
  } catch {
    return [];
  }
}

/** 把数据库里的 stageData JSON 字符串安全解析为 StageData。 */
export function parseStageData(raw: string): StageData {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StageData) : {};
  } catch {
    return {};
  }
}

export type EnsureConversationResult =
  | {
      ok: true;
      conversationId: string;
      studentAssignmentId: string;
      currentStage: number;
      messages: Message[];
      stageData: StageData;
      status: AssignmentStatus;
      styleFamily: StyleFamily;
      stylePolicyVersion: string;
      safetyQuizCompleted: boolean;
      contractVersion: string;
      stageDataRecovered: boolean;
    }
  | { ok: false; error: 'not_found' | 'forbidden' };

/**
 * 确保某学生在某作业上有会话：已存在则返回，否则创建
 * StudentAssignment + 带 welcome 种子的 Conversation。供会话页与 start 端点共用。
 */
export async function ensureStudentConversation(
  assignmentId: string,
  studentId: string
): Promise<EnsureConversationResult> {
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      classId: true,
      title: true,
      topicDirection: true,
      assistantStyleFamily: true,
      stylePolicyVersion: true,
      dataContributionMode: true,
      dataPolicyVersion: true,
    },
  });
  if (!assignment) return { ok: false, error: 'not_found' };

  const membership = await db.classMember.findUnique({
    where: { classId_studentId: { classId: assignment.classId, studentId } },
    select: { id: true },
  });
  if (!membership) return { ok: false, error: 'forbidden' };

  const existing = await db.studentAssignment.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId } },
    select: { id: true, conversationId: true, currentStage: true, status: true, dataConsentStatus: true },
  });
  if (existing?.conversationId) {
    const conv = await db.conversation.findUnique({
      where: { id: existing.conversationId },
      select: { messages: true, stageData: true, safetyQuizCompleted: true, resolvedStyleFamily: true, stylePolicyVersion: true, contractVersion: true },
    });
    const recovered = recoverStageDataV3(parseStageData(conv?.stageData ?? '{}'));
    return {
      ok: true,
      conversationId: existing.conversationId,
      studentAssignmentId: existing.id,
      currentStage: existing.currentStage,
      messages: parseMessages(conv?.messages ?? '[]'),
      stageData: studentVisibleStageData(recovered.stageData),
      status: existing.status as AssignmentStatus,
      styleFamily: isStyleFamily(conv?.resolvedStyleFamily) ? conv.resolvedStyleFamily : DEFAULT_STYLE_FAMILY,
      stylePolicyVersion: conv?.stylePolicyVersion ?? DEFAULT_STYLE_POLICY_VERSION,
      safetyQuizCompleted: conv?.safetyQuizCompleted ?? false,
      contractVersion: conv?.contractVersion ?? 'stage-contract-v2',
      stageDataRecovered: recovered.recovered,
    };
  }

  const welcome = [initialWelcomeMessage({
    assignmentTitle: assignment.title,
    topicDirection: assignment.topicDirection ?? undefined,
  })];
  // 新会话固定到 tutor-language-v1；旧会话保留其历史合同与模型。
  const runtimeModel = await ensureRuntimeModelVersion();
  const styleSelection: AssistantStyleSelection = assignment.assistantStyleFamily === 'auto' || isStyleFamily(assignment.assistantStyleFamily)
    ? assignment.assistantStyleFamily
    : 'auto';
  const resolvedStyleFamily = resolveStyleFamily(styleSelection, assignment.id, studentId);
  const result = await db.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: {
        userId: studentId,
        messages: JSON.stringify(welcome),
        // 历史字段保留但新会话不再消费五风格。
        resolvedStyleFamily: '',
        stylePolicyVersion: '',
        contractVersion: TUTOR_LANGUAGE_CONTRACT_VERSION,
        deployedModelVersionId: runtimeModel.id,
        traceCoverage: 'COMPLETE',
      },
      select: { id: true },
    });
    const studentAssignment = existing
      ? await tx.studentAssignment.update({
          where: { id: existing.id },
          data: {
            conversationId: conversation.id,
            status: 'IN_PROGRESS',
            currentStage: 1,
            ...(assignment.dataContributionMode === 'CONSENT_REQUIRED' && existing.dataConsentStatus === 'NOT_APPLICABLE'
              ? { dataConsentStatus: 'PENDING', dataConsentPolicyVersion: assignment.dataPolicyVersion }
              : {}),
          },
          select: { id: true },
        })
      : await tx.studentAssignment.create({
          data: {
            assignmentId,
            studentId,
            conversationId: conversation.id,
            status: 'IN_PROGRESS',
            currentStage: 1,
            dataConsentStatus: assignment.dataContributionMode === 'CONSENT_REQUIRED' ? 'PENDING' : 'NOT_APPLICABLE',
            dataConsentPolicyVersion: assignment.dataContributionMode === 'CONSENT_REQUIRED' ? assignment.dataPolicyVersion : null,
          },
          select: { id: true },
        });
    return { conversationId: conversation.id, studentAssignmentId: studentAssignment.id };
  });

  return {
    ok: true,
    conversationId: result.conversationId,
    studentAssignmentId: result.studentAssignmentId,
    currentStage: 1,
    messages: welcome,
    stageData: {},
    status: 'IN_PROGRESS',
    styleFamily: resolvedStyleFamily,
    stylePolicyVersion: assignment.stylePolicyVersion,
    safetyQuizCompleted: false,
    contractVersion: TUTOR_LANGUAGE_CONTRACT_VERSION,
    stageDataRecovered: false,
  };
}

export interface ConversationForUser {
  id: string;
  messages: Message[];
  stageData: StageData;
  currentStage: number;
  status: AssignmentStatus;
  studentAssignmentId: string;
  assignmentId: string;
  topicDirection: string | null;
  dueDate: Date | null;
  dataConsentStatus: string;
  safetyQuizCompleted: boolean;
  styleFamily: StyleFamily;
  stylePolicyVersion: string;
  contractVersion: string;
  stageDataRecovered: boolean;
}

/**
 * 取归属于该用户的会话（连带其 StudentAssignment 的阶段/状态、作业方向、stageData）。
 * 非归属或不存在返回 null。
 */
export async function getConversationForUser(
  conversationId: string,
  userId: string
): Promise<ConversationForUser | null> {
  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      userId: true,
      messages: true,
      stageData: true,
      safetyQuizCompleted: true,
      resolvedStyleFamily: true,
      stylePolicyVersion: true,
      contractVersion: true,
      studentAssignment: {
        select: {
          id: true,
          currentStage: true,
          status: true,
          assignmentId: true,
          dataConsentStatus: true,
          assignment: { select: { topicDirection: true, dueDate: true } },
        },
      },
    },
  });
  if (!conv || conv.userId !== userId || !conv.studentAssignment) return null;

  const recovered = recoverStageDataV3(parseStageData(conv.stageData));
  return {
    id: conv.id,
    messages: parseMessages(conv.messages),
    stageData: recovered.stageData,
    currentStage: conv.studentAssignment.currentStage,
    status: conv.studentAssignment.status as AssignmentStatus,
    studentAssignmentId: conv.studentAssignment.id,
    assignmentId: conv.studentAssignment.assignmentId,
    topicDirection: conv.studentAssignment.assignment.topicDirection,
    dueDate: conv.studentAssignment.assignment.dueDate,
    dataConsentStatus: conv.studentAssignment.dataConsentStatus,
    safetyQuizCompleted: conv.safetyQuizCompleted,
    styleFamily: isStyleFamily(conv.resolvedStyleFamily) ? conv.resolvedStyleFamily : DEFAULT_STYLE_FAMILY,
    stylePolicyVersion: conv.stylePolicyVersion || DEFAULT_STYLE_POLICY_VERSION,
    contractVersion: conv.contractVersion,
    stageDataRecovered: recovered.recovered,
  };
}
