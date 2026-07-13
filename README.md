# Hyacintech STEM 教育平台

AI驱动的科学探究学习平台，基于上海市初中科学课程标准。AI 教师引导学生完成「选题定向 → 方案设计 → 过程执行 → 数据分析 → 报告成型 → 结果反思」六个阶段，全程安全监护。支持**正式账号**（班级/作业/教师审核）和**直接体验**（无需注册、浏览器内运行）两种模式。

## 第一次安装

```bash
npm install                      # postinstall 会自动运行 prisma generate
cp .env.example .env             # 按下方说明填写环境变量
npm run db:migrate               # 应用 SQLite / Prisma 迁移
npm run db:seed                  # 创建演示教学账号
```

### 环境变量（`.env`）

```env
DATABASE_URL="file:./dev.db"              # SQLite 数据库路径
SESSION_SECRET="至少32字符的随机字符串"      # 生成方式：openssl rand -base64 32
OPENAI_API_KEY="sk-..."                    # 或 DEEPSEEK_API_KEY="sk-..."
# 可选：
# LLM_PROVIDER=openai|deepseek            # 自动检测，无需设置
# LLM_MODEL=gpt-4o|deepseek-v4-pro        # 默认 gpt-4o / deepseek-v4-pro

# Data Lab 管理员（运行 npm run data-lab:init 时需要）
ADMIN_USERNAME="data-admin"
ADMIN_PASSWORD="请替换为至少8字符的强密码"
ADMIN_DISPLAY_NAME="数据平台主管"
```

## 运行

```bash
npm run dev        # 开发模式 → http://localhost:3000
npm run build      # 生产构建
npm run start      # 生产启动
npm run lint       # ESLint（当前零报错）
npm run db:studio  # 打开 Prisma Studio 查看/编辑数据库
npm run db:seed    # 重新运行种子脚本（幂等）
npm run data-lab:init   # 创建管理员并导入 489 条 dataset-base-v1
npm run data-lab:pilot  # 创建 2 位演示标注者、1 位复审者和 12 条试运行活动
npm run data-lab:test   # Data Lab 纯函数与数据库闭环测试
```

## 种子演示账号

首次迁移后自动创建：

| 账号 | 密码 | 角色 |
|---|---|---|
| `teacher1` | `demo1234` | 教师 |
| `student1` | `demo1234` | 学生 |
| `student2` | `demo1234` | 学生 |

演示班级「七年级(1)班」已建好，学生已加入，含一个演示作业。

## Data Lab 数据闭环

管理员、标注者和复审者登录后进入 `/data-lab`。后台角色不能自助注册，只能通过管理员 Seed 或账号管理页创建。

```text
ShareGPT/manifest 导入
  → 自动结构与语义质检
  → 双人独立标注 / Silver 单审
  → 匿名复审仲裁
  → Human Gold + Reviewed Silver 冻结发布（clean + 风格可控 training）
  → 主办方训练任务登记
  → transcript/verdict 双盲结果导入
```

当前基线为 `dataset-base-v1`：489 条严格 clean 样本，312 条 gold candidate、177 条 silver。候选等级不等于人工 Gold，只有完成标注和仲裁的版本才能进入冻结发布。M9A 已打通五种回复风格从作业、在线推理、标注修订到模型可见训练导出和分风格双盲评测的血缘。

M9B1 已建立模型注册表和正式聊天生成轨迹：每条新导师回复都关联稳定模型版本，并与消息及阶段数据原子落库；历史不可验证会话不会自动获得训练资格。管理员可在“高级管理 → 模型与血缘”查看基线、父子关系和追踪覆盖率。

M9B2 已建立正式使用数据的安全入口：回流默认关闭，学生可自愿授权或撤回，教师只能提名有生成轨迹的具体回复；平台在本机脱敏、查重并交由管理员审核后，才转换为隔离的 `production_trace` 批次。通过候选仍必须接受后续人工纠正，不能直接用于训练。

M9C 已把候选接入人工纠正与训练资格：服务端验证修订是否真的达到实质纠正，阻止同人自审；冻结版本分别输出 SFT training 与 chosen/rejected preference，训练登记绑定父模型并重新检查当前资格。

M9D 已完成模型晋级闭环：双盲结果关联稳定模型版本，五种风格分别通过门禁后才能按 10% → 30% → 100% 灰度；正式会话稳定绑定模型，异常时可一键回滚并切回上一安全基线。至此 M9 全部完成。

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
  api/          # Route Handlers（教学业务 + data-lab）
  auth/         # 登录/注册页
  student/      # 学生端：dashboard/assignments/[id]
  teacher/      # 教师端：dashboard/classes/assignments/review
  data-lab/     # 数据导入、标注、仲裁、发布、训练与评测登记
  experience/   # 体验模式
  components/   # 共享 UI 组件（ConversationChat/DataTableEditor/ChartViewer/ReportViewer…）
  lib/          # 服务端逻辑（db/session/auth/queries/conversation/llm/stageAdvance/review…）
  models/       # TypeScript 类型定义
  prompts/      # 六阶段 AI 提示词
prisma/
  schema.prisma # 教学业务模型 + Data Lab 数据闭环模型
  seed.ts       # 种子脚本
scripts/        # 单测（test-stage-extraction/test-stage-advance/test-review/test-guest-ratelimit）
public/uploads/ # 学生上传的实验图片（Git 忽略，仅保留 .gitkeep）
```

完整架构文档见 [`CLAUDE.md`](./CLAUDE.md)，实施路线见 [`ROADMAP.md`](./ROADMAP.md)。

模型迭代的风格控制、生产数据安全回流、训练血缘与灰度部署设计见 [`docs/model-improvement-loop.md`](./docs/model-improvement-loop.md)。

## Data Lab 使用教程

- [标注员录屏讲稿](./docs/data-lab-annotator-recording-script.md)
- [团队内部管理与审核速查](./docs/data-lab-team-quick-guide.md)
- [旧版标注者与复审者详细教程（历史参考）](./docs/data-lab-annotator-reviewer-guide.md)
- [旧版管理员详细教程（历史参考）](./docs/data-lab-admin-guide.md)
- [临时公网隧道运维说明](./docs/data-lab-tunnel-runbook.md)
