# Hyacintech STEM 教育平台

AI驱动的科学探究学习平台，基于上海市初中科学课程标准。AI 教师引导学生完成「选题定向 → 方案设计 → 过程执行 → 数据分析 → 成果成型 → 结果反思」六个阶段，全程安全监护。支持**正式账号**（班级/作业/教师审核）和**直接体验**（无需注册、浏览器内运行）两种模式。

## 第一次安装

```bash
npm install                      # postinstall 会自动运行 prisma generate
cp .env.example .env             # 按下方说明填写环境变量
npx prisma migrate dev --name init   # 创建 SQLite 数据库 + 运行种子脚本
```

### 环境变量（`.env`）

```env
DATABASE_URL="file:./dev.db"              # SQLite 数据库路径
SESSION_SECRET="至少32字符的随机字符串"      # 生成方式：openssl rand -base64 32
OPENAI_API_KEY="sk-..."                    # 或 DEEPSEEK_API_KEY="sk-..."
# 可选：
# LLM_PROVIDER=openai|deepseek            # 自动检测，无需设置
# LLM_MODEL=gpt-4o|deepseek-chat          # 默认 gpt-4o / deepseek-chat
```

## 运行

```bash
npm run dev        # 开发模式 → http://localhost:3000
npm run build      # 生产构建
npm run start      # 生产启动
npm run lint       # ESLint（当前零报错）
npm run db:studio  # 打开 Prisma Studio 查看/编辑数据库
npm run db:seed    # 重新运行种子脚本（幂等）
```

## 种子演示账号

首次迁移后自动创建：

| 账号 | 密码 | 角色 |
|---|---|---|
| `teacher1` | `demo1234` | 教师 |
| `student1` | `demo1234` | 学生 |
| `student2` | `demo1234` | 学生 |

演示班级「七年级(1)班」已建好，学生已加入，含一个演示作业。

## 两种使用方式

### 正式模式
登录 → 教师创建班级/发布作业 → 学生用邀请码加入 → 进入六阶段探究 → AI 引导 + 结构化数据（表格/图表/报告） → 教师审核 → 完成

### 直接体验（无需注册）
首页点击「直接体验」或访问 `/experience` → 完整六阶段 → 数据仅保存在当前浏览器标签页，刷新后清空。

## 技术栈

- **框架**：Next.js 16 (App Router) + TypeScript
- **数据库**：SQLite + Prisma ORM
- **会话**：iron-session（加密 Cookie）
- **样式**：Tailwind CSS
- **图表**：Recharts
- **AI**：OpenAI / DeepSeek（兼容 API，自动检测）

## 项目结构

```
app/
  api/          # Route Handlers（auth/classes/assignments/conversations/guest/teacher/uploads）
  auth/         # 登录/注册页
  student/      # 学生端：dashboard/assignments/[id]
  teacher/      # 教师端：dashboard/classes/assignments/review
  experience/   # 体验模式
  components/   # 共享 UI 组件（ConversationChat/DataTableEditor/ChartViewer/ReportViewer…）
  lib/          # 服务端逻辑（db/session/auth/queries/conversation/llm/stageAdvance/review…）
  models/       # TypeScript 类型定义
  prompts/      # 六阶段 AI 提示词
prisma/
  schema.prisma # 数据库模型（6 张表）
  seed.ts       # 种子脚本
scripts/        # 单测（test-stage-extraction/test-stage-advance/test-review/test-guest-ratelimit）
public/uploads/ # 学生上传的实验图片（Git 忽略，仅保留 .gitkeep）
```

完整架构文档见 [`CLAUDE.md`](./CLAUDE.md)，实施路线见 [`ROADMAP.md`](./ROADMAP.md)。
