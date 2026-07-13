import 'server-only';
import { db } from './db';
import { parseStageData } from './conversation';
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

/** 教师待审核列表：所辖班级中 status 为 PENDING_STAGE2/5 的学生作业。 */
export async function getPendingReviews(teacherId: string) {
  return db.studentAssignment.findMany({
    where: {
      status: { in: ['PENDING_STAGE2', 'PENDING_STAGE5'] },
      assignment: { class: { teacherId } },
    },
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true,
      status: true,
      currentStage: true,
      dataConsentStatus: true,
      updatedAt: true,
      student: { select: { displayName: true, username: true } },
      assignment: { select: { title: true, class: { select: { name: true } } } },
    },
  });
}

/**
 * 第三阶段「数据表待过目（可选）」清单：
 * 所辖班级中 currentStage∈{3,4}、IN_PROGRESS，且 stage3 已提交、尚未被教师认可的学生作业。
 * stage3.submitted/approved 存在 stageData JSON 中，无法用 Prisma where 过滤，故先取候选再在内存里筛。
 */
export async function getOptionalStage3Reviews(teacherId: string) {
  const rows = await db.studentAssignment.findMany({
    where: {
      status: 'IN_PROGRESS',
      currentStage: { in: [3, 4] },
      assignment: { class: { teacherId } },
    },
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true,
      currentStage: true,
      updatedAt: true,
      student: { select: { displayName: true, username: true } },
      assignment: { select: { title: true, class: { select: { name: true } } } },
      conversation: { select: { stageData: true } },
    },
  });

  return rows
    .filter((r) => {
      const sd = parseStageData(r.conversation?.stageData ?? '{}');
      return sd.stage3?.submitted === true && sd.stage3?.approved !== true;
    })
    .map((r) => ({
      id: r.id,
      currentStage: r.currentStage,
      updatedAt: r.updatedAt,
      student: r.student,
      assignment: r.assignment,
    }));
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
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              assistantMessageId: true,
              stage: true,
              responseJson: true,
              createdAt: true,
              productionCandidate: { select: { id: true, status: true } },
            },
          },
        },
      },
    },
  });
}
