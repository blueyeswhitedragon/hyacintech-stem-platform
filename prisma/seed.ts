/**
 * 种子脚本：创建演示教师 + 1 个班级，方便本地测试。
 * 运行: npm run db:seed  (可重复执行，使用 upsert)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateUniqueInviteCode } from '../app/lib/inviteCode';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('demo1234', 10);

  // 演示教师（用户名唯一，可重复执行）
  const teacher = await prisma.user.upsert({
    where: { username: 'teacher1' },
    update: {},
    create: {
      username: 'teacher1',
      passwordHash,
      role: 'teacher',
      displayName: '演示教师',
    },
  });

  // 演示班级：若该教师尚无班级则创建一个
  const existing = await prisma.class.findFirst({
    where: { teacherId: teacher.id },
  });

  const klass =
    existing ??
    (await prisma.class.create({
      data: {
        name: '演示班级 · 七年级(1)班',
        inviteCode: await generateUniqueInviteCode(prisma),
        teacherId: teacher.id,
      },
    }));

  // 演示学生（upsert 幂等）
  const studentPasswordHash = await bcrypt.hash('demo1234', 10);
  const students = await Promise.all(
    [
      { username: 'student1', displayName: '演示学生·小明' },
      { username: 'student2', displayName: '演示学生·小红' },
    ].map((s) =>
      prisma.user.upsert({
        where: { username: s.username },
        update: {},
        create: { ...s, passwordHash: studentPasswordHash, role: 'student' },
      })
    )
  );

  // 加入班级
  for (const s of students) {
    await prisma.classMember.upsert({
      where: { classId_studentId: { classId: klass.id, studentId: s.id } },
      update: {},
      create: { classId: klass.id, studentId: s.id },
    });
  }

  // 发布一个演示作业
  const assignment = await prisma.assignment.upsert({
    where: { id: 'demo-assignment-1' },
    update: {},
    create: {
      id: 'demo-assignment-1',
      classId: klass.id,
      title: '探究不同光照时长对绿豆苗株高的影响',
      topicDirection: '植物生长与光照',
    },
  });

  console.log('✅ Seed 完成');
  console.log(`   教师: ${teacher.username} (密码 demo1234)`);
  console.log(`   学生: student1 / student2 (密码 demo1234)`);
  console.log(`   班级: ${klass.name} (邀请码 ${klass.inviteCode})`);
  console.log(`   作业: ${assignment.title}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed 失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
