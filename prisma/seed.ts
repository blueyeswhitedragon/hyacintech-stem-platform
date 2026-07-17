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

  const adminUsername = process.env.ADMIN_USERNAME?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminDisplayName = process.env.ADMIN_DISPLAY_NAME?.trim();
  if (adminUsername || adminPassword || adminDisplayName) {
    if (!adminUsername || !adminPassword || !adminDisplayName) {
      throw new Error('ADMIN_USERNAME、ADMIN_PASSWORD、ADMIN_DISPLAY_NAME 必须同时设置');
    }
    if (adminPassword.length < 8) throw new Error('ADMIN_PASSWORD 至少 8 个字符');
    const adminPasswordHash = await bcrypt.hash(adminPassword, 10);
    await prisma.user.upsert({
      where: { username: adminUsername },
      update: { passwordHash: adminPasswordHash, displayName: adminDisplayName, role: 'admin' },
      create: {
        username: adminUsername,
        passwordHash: adminPasswordHash,
        displayName: adminDisplayName,
        role: 'admin',
      },
    });
    console.log(`   管理员: ${adminUsername}`);
  }

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
    update: { assistantStyleFamily: '', stylePolicyVersion: '' },
    create: {
      id: 'demo-assignment-1',
      classId: klass.id,
      title: '探究不同光照时长对绿豆苗株高的影响',
      topicDirection: '植物生长与光照',
      assistantStyleFamily: '',
      stylePolicyVersion: '',
    },
  });

  // Data Lab 启动 TopicCard 草稿：覆盖五个领域，必须由管理员人工审批后才能生成案例。
  const topicCards = [
    { id: 'bootstrap-topic-biology-1', displayTitle: '窗边和室内的叶片有什么不同', studentOpening: '我发现同一种植物放在窗边和房间里面，叶子状态不太一样。', internalArchetype: 'fuzzy_interest', subject: 'biology_ecology', coreMechanism: '环境条件会影响植物的早期生长表现', acceptable: ['比较不同光照时长下的幼苗表现', '比较不同距离光源下的叶片变化'], forbidden: ['使用高压强光设备'], anchors: ['植物生长需要适宜环境', '控制变量'] },
    { id: 'bootstrap-topic-chemistry-1', displayTitle: '怎样让厨房材料溶解得更快', studentOpening: '我冲饮料时发现有时候粉末很快就没了，有时候会结成小块。', internalArchetype: 'everyday_mechanism', subject: 'chemistry', coreMechanism: '接触、温度或搅拌条件会影响溶解过程', acceptable: ['比较搅拌方式与溶解时间', '比较安全温度范围内的溶解时间'], forbidden: ['使用强酸强碱或未知粉末'], anchors: ['溶解现象', '公平比较'] },
    { id: 'bootstrap-topic-physics-1', displayTitle: '纸飞机为什么有时飞得远有时转弯', studentOpening: '我折的纸飞机有一架飞得很直，另一架总是往旁边拐。', internalArchetype: 'misconception', subject: 'physics', coreMechanism: '形状、质量分布和投掷条件会影响运动表现', acceptable: ['比较机翼形状与飞行距离', '比较配重位置与偏转程度'], forbidden: ['从高处或人群中投掷'], anchors: ['力与运动', '重复测量'] },
    { id: 'bootstrap-topic-engineering-1', displayTitle: '怎样让纸桥承受更多书本', studentOpening: '我搭纸桥时发现有的形状很容易塌，想知道怎样能更稳。', internalArchetype: 'engineering_design', subject: 'engineering', coreMechanism: '结构形状会改变受力与承重表现', acceptable: ['比较不同折叠截面的承重', '比较桥面层数与承重'], forbidden: ['使用危险切割工具'], anchors: ['结构稳定性', '工程迭代'] },
    { id: 'bootstrap-topic-interdisciplinary-1', displayTitle: '封闭小空间里怎样照顾植物', studentOpening: '如果植物放在一个封闭的小空间里，我想知道哪些环境条件最值得先观察。', internalArchetype: 'high_concept_proxy', subject: 'high_concept_interdisciplinary', coreMechanism: '封闭环境中的条件需要被监测和人工控制', acceptable: ['用安全光照条件模拟人工环境', '比较通风方式与可观察状态'], forbidden: ['把火星基地等内部案例标签写进学生文本'], anchors: ['系统与模型', '生物与工程交叉'] },
  ];
  for (const card of topicCards) {
    await prisma.topicCard.upsert({
      where: { id: card.id },
      update: {},
      create: {
        id: card.id,
        displayTitle: card.displayTitle,
        studentOpening: card.studentOpening,
        internalArchetype: card.internalArchetype,
        subject: card.subject,
        gradeBand: '初中',
        coreMechanism: card.coreMechanism,
        acceptableDirectionsJson: JSON.stringify(card.acceptable),
        forbiddenDirectionsJson: JSON.stringify(card.forbidden),
        curriculumAnchorsJson: JSON.stringify(card.anchors),
        sourceJson: JSON.stringify({ kind: 'seed_draft', reviewedLicense: true }),
        status: 'DRAFT',
      },
    });
  }

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
