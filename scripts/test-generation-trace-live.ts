#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../app/lib/db';

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000';

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const username = `trace-live-${suffix}`;
  const password = `trace-${suffix}-pass`;
  const assignment = await db.assignment.findFirst({
    include: { class: { select: { id: true } } },
  });
  if (!assignment) throw new Error('缺少可用于真实路由测试的作业');

  const student = await db.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'student',
      displayName: `轨迹验收 ${suffix}`,
    },
  });
  await db.classMember.create({
    data: { classId: assignment.class.id, studentId: student.id },
  });

  let conversationId: string | undefined;
  try {
    const login = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!login.ok) throw new Error(`登录失败：${login.status} ${await login.text()}`);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('登录响应没有会话 Cookie');

    const started = await fetch(
      `${BASE_URL}/api/student/assignments/${assignment.id}/start`,
      { method: 'POST', headers: { Cookie: cookie } }
    );
    if (!started.ok) throw new Error(`创建会话失败：${started.status} ${await started.text()}`);
    const startData = (await started.json()) as { conversationId: string };
    conversationId = startData.conversationId;

    const chat = await fetch(`${BASE_URL}/api/conversations/${conversationId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ message: '我想研究不同光照时长对绿豆苗生长的影响，应该先明确哪些变量？' }),
    });
    if (!chat.ok) throw new Error(`真实聊天失败：${chat.status} ${await chat.text()}`);

    const [conversation, traces] = await Promise.all([
      db.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
      db.generationTrace.findMany({
        where: { conversationId },
        include: { modelVersion: true },
      }),
    ]);
    if (conversation.traceCoverage !== 'COMPLETE') {
      throw new Error(`新会话追踪状态错误：${conversation.traceCoverage}`);
    }
    if (traces.length !== 1) throw new Error(`预期 1 条轨迹，实际 ${traces.length}`);
    if (traces[0].modelTagSnapshot !== traces[0].modelVersion.tag) {
      throw new Error('模型标签快照与稳定模型版本不一致');
    }
    if (traces[0].requestMessageSha256.length !== 64 || traces[0].promptSha256.length !== 64) {
      throw new Error('请求或提示词指纹不合法');
    }

    console.log(
      JSON.stringify(
        {
          status: 'PASS',
          conversationId,
          traceId: traces[0].id,
          modelTag: traces[0].modelTagSnapshot,
          styleFamily: traces[0].styleFamily,
          successfulAttempt: JSON.parse(traces[0].generationParamsJson).successfulAttempt,
        },
        null,
        2
      )
    );
  } finally {
    const studentAssignment = await db.studentAssignment.findFirst({
      where: { assignmentId: assignment.id, studentId: student.id },
    });
    if (studentAssignment) {
      await db.studentAssignment.delete({ where: { id: studentAssignment.id } });
    }
    if (conversationId) {
      await db.conversation.deleteMany({ where: { id: conversationId } });
    }
    await db.classMember.deleteMany({ where: { studentId: student.id } });
    await db.user.delete({ where: { id: student.id } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
