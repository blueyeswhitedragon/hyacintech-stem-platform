#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import { db } from '../app/lib/db';
import { buildDataTableSchema } from '../app/lib/stageArtifacts';
import { buildReportDocx } from '../app/lib/reportDocx';
import { stage2DraftHash } from '../app/lib/stageState';
import type { Stage2ExperimentPlan, Stage5Sections, StageData } from '../app/models/stageData';

const BASE_URL = (process.env.TEST_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
let passed = 0;
let failed = 0;

function check(condition: unknown, label: string) {
  if (condition) { passed++; console.log(`PASS ${label}`); }
  else { failed++; console.error(`FAIL ${label}`); }
}

async function login(username: string, password: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`登录失败：${username} HTTP ${response.status}`);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function jsonRequest(path: string, cookie: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      Cookie: cookie,
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function main() {
  const suffix = randomUUID();
  const password = 'formal-e2e-password';
  const passwordHash = await bcrypt.hash(password, 4);
  const teacher = await db.user.create({
    data: { username: `formal-teacher-${suffix}`, passwordHash, role: 'teacher', displayName: '正式流程教师' },
  });
  const student = await db.user.create({
    data: { username: `formal-student-${suffix}`, passwordHash, role: 'student', displayName: '正式流程学生' },
  });
  const klass = await db.class.create({
    data: { name: `正式流程班级-${suffix}`, inviteCode: suffix.replace(/-/g, '').slice(0, 8).toUpperCase(), teacherId: teacher.id },
  });
  const assignment = await db.assignment.create({
    data: { classId: klass.id, title: '六阶段正式流程 E2E' },
  });
  await db.classMember.create({ data: { classId: klass.id, studentId: student.id } });

  const plan: Stage2ExperimentPlan = {
    researchQuestion: '不同光照时长是否影响豆苗高度？',
    hypothesis: '光照较长时豆苗可能更高',
    independentVariable: { name: '光照时长', levels: ['4小时', '8小时'] },
    dependentVariable: { name: '豆苗高度', measurement: '用刻度尺测量', unit: 'cm' },
    controlledVariables: ['豆苗品种', '水量'],
    materials: ['豆苗', '刻度尺'],
    procedure: ['设置两组光照', '每天固定时间测量'],
    repeatCount: 3,
    safetyNotes: ['异常时停止并告知教师'],
  };
  const draftHash = stage2DraftHash(plan);
  const stage2Data: StageData = {
    stage1: { confirmed: true, snapshot: '已确认研究问题', researchQuestion: plan.researchQuestion },
    stage2: {
      submitted: false,
      approved: null,
      planDraft: plan,
      draftHash,
      confirmedPlanHash: draftHash,
      experimentPlan: plan,
      schema: buildDataTableSchema(plan),
    },
  };
  const conversation = await db.conversation.create({
    data: { userId: student.id, messages: '[]', stageData: JSON.stringify(stage2Data), traceCoverage: 'COMPLETE' },
  });
  const studentAssignment = await db.studentAssignment.create({
    data: {
      assignmentId: assignment.id,
      studentId: student.id,
      conversationId: conversation.id,
      status: 'IN_PROGRESS',
      currentStage: 2,
    },
  });
  let uploadedDocUrl = '';

  try {
    const [studentCookie, teacherCookie] = await Promise.all([
      login(student.username, password),
      login(teacher.username, password),
    ]);
    check(Boolean(studentCookie && teacherCookie), '教师和学生正式账号均可建立会话');

    const submitted2 = await jsonRequest(`/api/conversations/${conversation.id}/submit-stage2`, studentCookie, { method: 'POST' });
    check(submitted2.response.ok && submitted2.data.status === 'PENDING_STAGE2', '学生提交 P2 后进入教师待审');

    const reviewed2 = await jsonRequest(`/api/teacher/review/${studentAssignment.id}`, teacherCookie, {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', stage: 2, feedback: '方案可执行' }),
    });
    check(reviewed2.response.ok && reviewed2.data.currentStage === 3, '教师通过 P2 后学生原子进入 P3');
    const detail3 = await jsonRequest(`/api/teacher/review/${studentAssignment.id}`, teacherCookie);
    check(detail3.data.currentStage === 3
      && detail3.data.stageData?.stage3?.safetyQuiz?.passed === false
      && Array.isArray(detail3.data.stageData?.stage3?.safetyQuiz?.options), 'P3 同步生成服务端安全题');

    const current = detail3.data.stageData as StageData;
    const platformSections: Stage5Sections = {
      purpose: '平台目的',
      hypothesis: '平台假设',
      materials: '平台材料',
      procedure: '平台步骤',
      dataSummary: '平台概述',
      analysis: '平台分析',
      conclusion: '',
      limitationsDiscussion: '',
      reflection: '',
    };
    await db.$transaction([
      db.conversation.update({
        where: { id: conversation.id },
        data: {
          stageData: JSON.stringify({
            ...current,
            stage3: { ...current.stage3!, rows: [{ trial: 1, result_a: 4, result_b: 8 }] },
            stage4: { analysisCount: 2 },
            stage5: { submitted: false, approved: null, sections: platformSections },
          } satisfies StageData),
        },
      }),
      db.studentAssignment.update({
        where: { id: studentAssignment.id },
        data: { status: 'IN_PROGRESS', currentStage: 5 },
      }),
    ]);

    const importedSections: Stage5Sections = {
      purpose: '导入目的',
      hypothesis: '导入假设',
      materials: '导入材料',
      procedure: '导入步骤',
      dataSummary: '导入数据概述',
      analysis: '导入数据分析',
      conclusion: '导入结论',
      limitationsDiscussion: '导入局限与讨论',
      reflection: '导入局限与讨论',
    };
    const form = new FormData();
    const docxBytes = new Uint8Array([...buildReportDocx({ sections: importedSections })]);
    form.append('file', new Blob([docxBytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }), '完整实验报告.docx');
    const imported = await jsonRequest(`/api/conversations/${conversation.id}/report/import`, studentCookie, {
      method: 'POST',
      body: form,
    });
    const previewHash = imported.data.stageData?.stage5?.importPreview?.previewHash;
    uploadedDocUrl = imported.data.stageData?.stage5?.uploadedDocUrl ?? '';
    check(imported.response.ok && imported.data.stageData?.stage5?.importPreview?.complete === true, '完整 Word 生成八章节导入预览');

    const confirmed = await jsonRequest(`/api/conversations/${conversation.id}/report/import/confirm`, studentCookie, {
      method: 'POST',
      body: JSON.stringify({ previewHash }),
    });
    check(confirmed.response.ok
      && confirmed.data.stageData?.stage5?.sections?.conclusion === importedSections.conclusion
      && confirmed.data.stageData?.stage5?.importPreview === undefined, '学生确认映射后写入权威报告字段');

    const submitted5 = await jsonRequest(`/api/conversations/${conversation.id}/submit-stage5`, studentCookie, { method: 'POST' });
    check(submitted5.response.ok && submitted5.data.status === 'PENDING_STAGE5', '完整导入报告通过现有 P5 提交门禁');

    const reviewed5 = await jsonRequest(`/api/teacher/review/${studentAssignment.id}`, teacherCookie, {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', stage: 5, score: 8, feedback: '请在反思中说明证据边界' }),
    });
    check(reviewed5.response.ok && reviewed5.data.currentStage === 6, '教师评分通过后学生进入 P6');
    const detail6 = await jsonRequest(`/api/teacher/review/${studentAssignment.id}`, teacherCookie);
    check(detail6.data.stageData?.stage5?.teacherScore === 8
      && detail6.data.stageData?.stage5?.teacherFeedback === '请在反思中说明证据边界', 'P6 保留并可读取教师评分与反馈');

    const completed = await jsonRequest(`/api/conversations/${conversation.id}/stage6-respond`, studentCookie, {
      method: 'POST',
      body: JSON.stringify({
        responseToTeacherFeedback: '我会限定结论只适用于本次样本。',
        learningReflection: '我学会了用重复测量和真实数据支持判断。',
      }),
    });
    check(completed.response.ok && completed.data.status === 'COMPLETED', '学生提交两段 P6 反思后完成作业');
  } finally {
    if (uploadedDocUrl.startsWith('/uploads/')) {
      await unlink(path.join(process.cwd(), 'public', uploadedDocUrl.slice(1))).catch(() => undefined);
    }
    await db.dataLabAuditLog.deleteMany({ where: { actorId: { in: [teacher.id, student.id] } } });
    await db.studentAssignment.deleteMany({ where: { assignmentId: assignment.id } });
    await db.conversation.deleteMany({ where: { userId: student.id } });
    await db.assignment.delete({ where: { id: assignment.id } });
    await db.classMember.deleteMany({ where: { classId: klass.id } });
    await db.class.delete({ where: { id: klass.id } });
    await db.user.deleteMany({ where: { id: { in: [teacher.id, student.id] } } });
  }

  console.log(`\nFormal flow E2E: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => db.$disconnect());
