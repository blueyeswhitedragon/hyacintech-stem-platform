import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from './db';
import {
  normalizePageParams,
  clampToPage,
  toPage,
  STAGE3_PENDING_FROM_WHERE,
  STUCK_FROM_WHERE,
  type PageParams,
} from './pagination';
import { advanceHint } from '@/app/lib/advanceHint';
import { parseStageData } from '@/app/lib/conversation';
import type { AssignmentStatus } from '@/app/models/stageData';
import type { AssistantStyleSelection } from '@/app/lib/stylePolicy';

/**
 * 共享数据查询层。Server Component 页面与 GET API 都调用这里，避免重复。
 */

/** 教师的所有班级，含成员数与作业数。 */
export async function getTeacherClasses(teacherId: string) {
  return db.class.findMany({
    where: { teacherId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      inviteCode: true,
      createdAt: true,
      _count: { select: { members: true, assignments: true } },
    },
  });
}

/** 班级详情：成员列表 + 每个成员在每个作业上的进度。仅供班级所属教师使用。 */
export async function getClassDetail(classId: string) {
  return db.class.findUnique({
    where: { id: classId },
    select: {
      id: true,
      name: true,
      inviteCode: true,
      teacherId: true,
      createdAt: true,
      members: {
        orderBy: { joinedAt: 'asc' },
        select: {
          joinedAt: true,
          student: { select: { id: true, username: true, displayName: true } },
        },
      },
      assignments: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          topicDirection: true,
          dueDate: true,
          studentAssignments: {
            select: {
              studentId: true,
              status: true,
              currentStage: true,
              conversationId: true,
            },
          },
        },
      },
    },
  });
}

/** 某班级的作业列表（教师视角）。 */
export async function getClassAssignments(classId: string) {
  return db.assignment.findMany({
    where: { classId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      topicDirection: true,
      assistantStyleFamily: true,
      dueDate: true,
      createdAt: true,
      _count: { select: { studentAssignments: true } },
    },
  });
}

export interface StudentAssignmentView {
  assignmentId: string;
  title: string;
  topicDirection: string | null;
  assistantStyleFamily: AssistantStyleSelection;
  dueDate: Date | null;
  className: string;
  status: AssignmentStatus;
  currentStage: number;
  conversationId: string | null;
}

/**
 * 学生的所有作业：来自其所在班级的全部作业，左连其 StudentAssignment。
 * 未开始的作业 status 视为 NOT_STARTED、currentStage 0。
 */
export async function getStudentAssignments(
  studentId: string
): Promise<StudentAssignmentView[]> {
  const memberships = await db.classMember.findMany({
    where: { studentId },
    select: { classId: true },
  });
  const classIds = memberships.map((m) => m.classId);
  if (classIds.length === 0) return [];

  const assignments = await db.assignment.findMany({
    where: { classId: { in: classIds } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      topicDirection: true,
      assistantStyleFamily: true,
      dueDate: true,
      class: { select: { name: true } },
      studentAssignments: {
        where: { studentId },
        select: { status: true, currentStage: true, conversationId: true },
      },
    },
  });

  return assignments.map((a) => {
    const sa = a.studentAssignments[0];
    return {
      assignmentId: a.id,
      title: a.title,
      topicDirection: a.topicDirection,
      assistantStyleFamily: (a.assistantStyleFamily === 'auto' ? 'auto' : a.assistantStyleFamily) as AssistantStyleSelection,
      dueDate: a.dueDate,
      className: a.class.name,
      status: (sa?.status as AssignmentStatus) ?? 'NOT_STARTED',
      currentStage: sa?.currentStage ?? 0,
      conversationId: sa?.conversationId ?? null,
    };
  });
}

/** 学生加入的班级列表。 */
export async function getStudentClasses(studentId: string) {
  return db.classMember.findMany({
    where: { studentId },
    orderBy: { joinedAt: 'desc' },
    select: {
      joinedAt: true,
      class: {
        select: {
          id: true,
          name: true,
          teacher: { select: { displayName: true } },
          _count: { select: { assignments: true } },
        },
      },
    },
  });
}

/** 教师概览统计：班级数 / 去重学生数 / 作业数。 */
export async function getTeacherStats(teacherId: string) {
  const classes = await db.class.findMany({
    where: { teacherId },
    select: { id: true },
  });
  const classIds = classes.map((c) => c.id);

  const [assignmentCount, members, pendingCount] = await Promise.all([
    db.assignment.count({ where: { classId: { in: classIds } } }),
    db.classMember.findMany({
      where: { classId: { in: classIds } },
      select: { studentId: true },
    }),
    db.studentAssignment.count({
      where: {
        assignment: { classId: { in: classIds } },
        status: { in: ['PENDING_STAGE2', 'PENDING_STAGE5'] },
      },
    }),
  ]);

  const uniqueStudents = new Set(members.map((m) => m.studentId)).size;
  return { classCount: classIds.length, studentCount: uniqueStudents, assignmentCount, pendingCount };
}

/**
 * 教师待审核列表：所辖班级中 status 为 PENDING_STAGE2/5 的学生作业。
 * 必须分页：一个教师带多个班时这里会线性增长，而每行都要拖 generationTraces。
 */
export async function getPendingReviews(teacherId: string, params: PageParams = {}) {
  const { page: requested, pageSize } = normalizePageParams(params);
  const where: Prisma.StudentAssignmentWhereInput = {
    status: { in: ['PENDING_STAGE2', 'PENDING_STAGE5'] },
    assignment: { class: { teacherId } },
  };

  // 先数后取：越界页码要夹回最后一页，否则 URL 上的 ?p=999 会渲染出「无待审」的假空态。
  const total = await db.studentAssignment.count({ where });
  const { page, skip } = clampToPage(requested, pageSize, total);

  const items = await db.studentAssignment.findMany({
    where,
    orderBy: { updatedAt: 'asc' },
    skip,
    take: pageSize,
    select: {
      id: true,
      status: true,
      currentStage: true,
      dataConsentStatus: true,
      updatedAt: true,
      student: { select: { displayName: true, username: true } },
      assignment: { select: { title: true, dataContributionMode: true, class: { select: { name: true } } } },
      conversation: { select: { traceCoverage: true, generationTraces: { where: { triggerType: 'USER_MESSAGE', trainingSystemPromptSnapshot: { not: '' } }, select: { id: true } } } },
    },
  });

  return toPage(items, total, page, pageSize);
}

/**
 * 第三阶段「数据表待过目（可选）」清单：
 * 所辖班级中 currentStage∈{3,4}、IN_PROGRESS，且 stage3 已提交、尚未被教师认可的学生作业。
 *
 * 谓词见 `pagination.ts` 的 STAGE3_PENDING_FROM_WHERE（下推到 SQL 的原因也写在那里）。
 * 这里先只取本页 id 与总数，再用 Prisma 补齐关联字段——关联的类型推导比手写 JOIN 可靠。
 */
export async function getOptionalStage3Reviews(teacherId: string, params: PageParams = {}) {
  const { page: requested, pageSize } = normalizePageParams(params);

  // 同 getPendingReviews：先数后取，越界页码夹回最后一页。
  const countRows = await db.$queryRawUnsafe<{ total: bigint | number }[]>(
    `SELECT COUNT(*) AS total ${STAGE3_PENDING_FROM_WHERE}`,
    teacherId,
  );
  const total = Number(countRows[0]?.total ?? 0);
  const { page, skip } = clampToPage(requested, pageSize, total);

  const idRows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT sa.id AS id ${STAGE3_PENDING_FROM_WHERE} ORDER BY sa.updatedAt ASC LIMIT ? OFFSET ?`,
    teacherId,
    pageSize,
    skip,
  );

  const ids = idRows.map((r) => r.id);
  if (ids.length === 0) return toPage<Stage3ReviewRow>([], total, page, pageSize);

  const rows = await db.studentAssignment.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      currentStage: true,
      dataConsentStatus: true,
      updatedAt: true,
      student: { select: { displayName: true, username: true } },
      assignment: { select: { title: true, dataContributionMode: true, class: { select: { name: true } } } },
      conversation: { select: { traceCoverage: true, generationTraces: { where: { triggerType: 'USER_MESSAGE', trainingSystemPromptSnapshot: { not: '' } }, select: { id: true } } } },
    },
  });

  // `in` 查询不保证顺序，按上面 SQL 的 updatedAt ASC 复原。
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = ids
    .map((id) => byId.get(id))
    .filter((r): r is (typeof rows)[number] => r !== undefined)
    .map((r) => ({
      id: r.id,
      currentStage: r.currentStage,
      updatedAt: r.updatedAt,
      student: r.student,
      assignment: r.assignment,
      eligibleTraceCount: r.dataConsentStatus === 'GRANTED' && r.conversation?.traceCoverage === 'COMPLETE' ? r.conversation.generationTraces.length : 0,
    }));

  return toPage(items, total, page, pageSize);
}

export interface Stage3ReviewRow {
  id: string;
  currentStage: number;
  updatedAt: Date;
  student: { displayName: string; username: string };
  assignment: { title: string; dataContributionMode: string; class: { name: string } };
  eligibleTraceCount: number;
}

export async function getStuckStudents(
  teacherId: string,
  params: PageParams & { minRounds?: number } = {},
) {
  const { page: requested, pageSize } = normalizePageParams(params);
  const minRounds = Number.isInteger(params.minRounds) && Number(params.minRounds) > 0
    ? Number(params.minRounds)
    : 8;
  const countRows = await db.$queryRawUnsafe<{ total: bigint | number }[]>(
    `SELECT COUNT(*) AS total ${STUCK_FROM_WHERE}`,
    teacherId,
    minRounds,
  );
  const total = Number(countRows[0]?.total ?? 0);
  const { page, skip } = clampToPage(requested, pageSize, total);
  const idRows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT sa.id AS id ${STUCK_FROM_WHERE} ORDER BY sa.updatedAt ASC LIMIT ? OFFSET ?`,
    teacherId,
    minRounds,
    pageSize,
    skip,
  );
  const ids = idRows.map((row) => row.id);
  if (ids.length === 0) return toPage<StuckStudentRow>([], total, page, pageSize);

  const rows = await db.studentAssignment.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      currentStage: true,
      updatedAt: true,
      student: { select: { displayName: true, username: true } },
      assignment: { select: { title: true, class: { select: { name: true } } } },
      conversation: { select: { stageData: true, safetyQuizCompleted: true } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row?.conversation) return [];
    const stageData = parseStageData(row.conversation.stageData);
    const hint = advanceHint({
      currentStage: row.currentStage,
      stageData,
      safetyQuizCompleted: row.conversation.safetyQuizCompleted,
    });
    return [{
      id: row.id,
      currentStage: row.currentStage,
      roundCount: stageData.roundCounts?.[row.currentStage] ?? 0,
      reason: hint.ok ? '服务器已满足推进条件，但学生尚未推进' : hint.reason ?? '当前阶段尚未满足推进条件',
      updatedAt: row.updatedAt,
      student: row.student,
      assignment: row.assignment,
    }];
  });
  return toPage(items, total, page, pageSize);
}

export interface StuckStudentRow {
  id: string;
  currentStage: number;
  roundCount: number;
  reason: string;
  updatedAt: Date;
  student: { displayName: string; username: string };
  assignment: { title: string; class: { name: string } };
}

/** 审核详情：单个学生作业 + 会话 messages/stageData + 归属（class.teacherId）。 */
export async function getReviewItem(studentAssignmentId: string) {
  return db.studentAssignment.findUnique({
    where: { id: studentAssignmentId },
    select: {
      id: true,
      status: true,
      currentStage: true,
      conversationId: true,
      dataConsentStatus: true,
      student: { select: { displayName: true, username: true } },
      assignment: {
        select: { title: true, topicDirection: true, dataContributionMode: true, dataPolicyVersion: true, class: { select: { name: true, teacherId: true } } },
      },
      conversation: {
        select: {
          messages: true,
          stageData: true,
          traceCoverage: true,
          generationTraces: {
            where: { triggerType: 'USER_MESSAGE' },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              assistantMessageId: true,
              stage: true,
              responseJson: true,
              trainingSystemPromptSnapshot: true,
              createdAt: true,
              productionCandidate: { select: { id: true, status: true } },
            },
          },
        },
      },
    },
  });
}
