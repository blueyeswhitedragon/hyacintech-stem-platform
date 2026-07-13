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
npm run data-lab:init   # 只创建/更新 Data Lab 管理员，不自动导入任何训练数据
npm run data-lab:import -- --file <候选集.json> --batch <唯一批次名>  # 显式导入新批次
npm run data-lab:pilot  # 创建 2 位演示标注者、1 位复审者和 12 样本试运行活动（双标后为 22 条任务）
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

历史 `dataset-base-v1` 共 489 条，已因六阶段状态机漂移整体标记为 `LEGACY_QUARANTINED`，不能创建新标注活动、冻结为训练版本或导出 SFT。它们只保留为新 rollout 的场景种子、rejected preference 与回归案例；新的正向数据必须使用 dataset schema v3、当前阶段合同和角色分离的逐轮生成，经自动校验与人工审核后才能进入训练。

M9B1 已建立模型注册表和正式聊天生成轨迹：每条新导师回复都关联稳定模型版本，并与消息及阶段数据原子落库；历史不可验证会话不会自动获得训练资格。管理员可在“高级管理 → 模型与血缘”查看基线、父子关系和追踪覆盖率。

M9B2 已建立正式使用数据的安全入口：回流默认关闭，学生可自愿授权或撤回，教师只能提名有生成轨迹且保存了当轮模型可见上下文的具体回复；完整提示词只在授权生效后固化，提名时同时保存该轮此前的模型可见对话历史，旧轨迹或未授权轨迹不能进入正向训练候选。平台在本机脱敏、查重并交由管理员审核后，才转换为隔离的 `production_trace` 批次。通过候选仍必须接受后续人工纠正，不能直接用于训练。

M9C 已把候选接入人工纠正与训练资格：服务端验证修订是否真的达到实质纠正，阻止同人自审；冻结版本分别输出 SFT training 与 chosen/rejected preference，训练登记绑定父模型并重新检查当前资格。

M9D 已完成模型晋级闭环：双盲结果关联稳定模型版本，五种风格分别通过门禁后才能按 10% → 30% → 100% 灰度；正式会话稳定绑定模型，异常时可一键回滚并切回上一安全基线。至此 M9 全部完成。

M9E 已补齐批量标注活动的安全收尾：管理员可以结束并归档不再需要的活动，未完成任务会停止分发，已提交内容、工作量审核、仲裁和发布血缘全部保留；只有从未启动且没有业务记录的草稿活动允许永久删除。

六阶段数据重构已补齐：P2 保存完整实验方案与重复次数，P3 安全题由服务端判定且未通过前不能录数/推进，P4 只有学生本轮引用真实表格值时才累计分析证据；逐轮训练导出不再混入中途 system 消息。v3 蒸馏、恢复、校验和导入步骤见 [`docs/dataset-v3-runbook.md`](./docs/dataset-v3-runbook.md)。

首轮 v3 校准资产位于 `data/sft/v3/`：30 条计划已全部执行，得到 25 条 `needs_review` 候选和 5 条拒绝。由于本机只有一个可用的 DeepSeek V4P 运行时，manifest 明确记录 `evaluatorIndependent=false`；这些文件用于人工复核，不是可直接训练的 Gold。

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
