# Hyacintech STEM 平台 · 实施 Roadmap

> 目标：从当前「单用户匿名六阶段 AI 聊天原型」演进到框架2(v3.0)要求的
> 「账号 / 班级 / 作业 / 教师审核 / 数据表 / 图表 / 报告 / 双模式」完整全栈平台。
> M0–M9 已完成，当前进入正式批量使用和运营加固阶段。本 roadmap 按依赖顺序保留历史实施记录，并持续反映当前状态。

图例：✅ 已有 · ⚠️ 部分 · ❌ 未做

---

## 依赖关系总览

```
M0 基建地基 ──┬─> M1 认证 ──┬─> M2 班级/作业 ──┐
              │             │                  ├─> M6 教师审核闭环
              └─> M3 会话持久化 ─> M4 阶段协议 ─┤
                                    │           ├─> M5 核心交互组件 ─> M7 体验模式
                                    └───────────┘                       │
                                                                 M8 收尾联调 <─┘
```

关键路径：**M0 → M1 → M3 → M4** 是一切的前提，必须先做。

---

## M0 · 基建地基（最高优先级，阻塞一切）

> 没有数据库 / 会话 / 加密，所有上层功能都无法开始。

- [x] 安装 Prisma、iron-session、bcryptjs、Recharts 等运行依赖；LLM 使用 OpenAI-compatible HTTP provider
- [x] 创建并持续扩展 `prisma/schema.prisma`
- [x] 建立 Prisma migrations 和 SQLite `dev.db`
- [x] 在 `app/lib/db.ts` 封装单例 PrismaClient（避免 dev 热重载多实例）
- [x] 在 `app/lib/session.ts` 封装 iron-session 配置（读 `SESSION_SECRET`）
- [x] `app/models/stageData.ts`：落地六阶段 `StageData` 类型
- [x] 更新 `.env.example`：包含 `DATABASE_URL`、`SESSION_SECRET` 和 LLM 配置
- [x] `prisma/seed.ts`：创建演示教师、学生、班级与作业

**验收**：`npm run dev` 能起，`dev.db` 自动生成，seed 能写入数据。

---

## M1 · 认证体系（依赖 M0）

- [x] `POST /api/auth/register`（bcrypt 加密；公开注册仅允许 student/teacher）
- [x] `POST /api/auth/login`（校验密码并写入 iron-session）
- [x] `POST /api/auth/logout`、`GET /api/auth/me`
- [x] `app/lib/auth.ts`：`requireUser()` / `requireRole()` 守卫工具
- [x] 页面：`/auth/login`、`/auth/register`
- [x] 首页 `/`：[直接体验] + [登录/工作台] 双入口

**验收**：能注册登录登出，受保护 API 未登录返回 401，role 越权返回 403。

---

## M2 · 班级 / 作业管理（依赖 M1）✅ 已完成

- [x] 班级：`POST/GET /api/classes`、`GET/DELETE /api/classes/[id]`、`POST /api/classes/[id]/join`（6 位邀请码）
- [x] 作业：`POST /api/assignments`、`GET /api/assignments?classId=`、`GET /api/student/assignments`
- [x] `POST /api/student/assignments/[id]/start`（不存在则建 StudentAssignment + Conversation，返回 conversationId；幂等）
- [x] 教师页：`/teacher/dashboard`、`/teacher/classes`、`/teacher/classes/[id]`、`/teacher/assignments`
- [x] 学生页：`/student/dashboard`、`/student/assignments`（状态卡片）
- [x] 登录/注册后按角色分流到对应 dashboard；`StudentAssignment` 加 `@@unique([assignmentId, studentId])`

**验收**：教师建班级发作业 → 学生用邀请码加入 → 学生作业列表出现该作业并能 start。✅ 端到端通过（含 DELETE 级联、403/404/409 错误路径）。

> 注：六阶段聊天的真正进入与持久化属 M3；M2 的 `start` 只建会话行并返回 `conversationId`，学生点「开始」暂跳首页。

---

## M3 · 会话持久化（依赖 M0–M2）✅ 已完成

> 把六阶段对话接进数据库（不再依赖匿名内存原型）。

- [x] `GET /api/conversations/[id]`（返回 messages + currentStage + status，用于恢复；归属校验）
- [x] 新增 `POST /api/conversations/[id]/chat`：读历史 → 调 AI → 追加 messages → 落库；`phase_complete` 时服务端推进 currentStage（封顶 6）。`callLLM` 抽到 `app/lib/llm/chat.ts` 与旧 `/api/chat` 共用
- [x] 新建 `ConversationChat`（DB 驱动、追加-only）+ `StageProgress`（props 版进度条）；保留 `/` 匿名原型不动
- [x] `app/student/assignments/[id]/page.tsx`：访问时 `ensureStudentConversation` find-or-create（共享 helper，`start` 端点也改用）+ 顶部进度条；`StartAssignmentButton` 改为跳会话页
- [x] 会话创建种入静态阶段1开场白（welcome），无需 LLM 即有内容

**验收**：✅ welcome 种子落库并经 GET 恢复；归属(非属者 404)、安全拦截(400)、空消息(400)、LLM 失败不半持久化(msgCount 不变)、幂等 resume 均通过。
> 注：LLM 成功后的「追加+阶段推进」与 welcome 种子走同一持久化代码路径，但因当前 deepseek key 余额不足(402)未能跑真实 LLM 往返，已类型/构建校验。`stageData` 的结构化解析属 M4，本期只存 messages + currentStage。

---

## M4 · 阶段结构化 AI 协议（依赖 M3）✅ 已完成

> 机制：扩展 `ChatResponse` JSON 加可选结构化字段（不用 `<!-- 标记 -->`/代码块），parser 透传 + 形状校验，纯函数 `extractStageData` 写入 `stageData`。

- [x] 阶段1：学生确认后输出 `stage1_confirmed`+`snapshot`+`variables` → 写 `stage1`、`currentStage=2`
- [x] 阶段1：支持 `topicDirection`（`getPromptForPhase(phase, context)` 动态注入）
- [x] 阶段2：输出 `data_table_schema` + `risks` → 写 `stage2.schema`/`aiRiskAnnotations`
- [x] 阶段3：首次进入输出 `safety_quiz`；`POST /api/conversations/[id]/safety-quiz` 置 `safetyQuizCompleted`
- [x] 阶段4：把 `stage3.rows` 渲染成文本表格注入提示词
- [x] 阶段5：「生成报告框架」输出 `report_sections` → 写 `stage5.sections`（conclusion/reflection 留空）
- [x] 复用 `parser.ts`；新增 `app/lib/stageExtraction.ts`（纯函数）+ fixture 单测 `scripts/test-stage-extraction.ts`
- [x] 前端最小化：`ConversationChat` 内联安全问答 + 数据表/报告框架轻提示

**验收**：✅ fixture 单测 18/18；真实 LLM 完整走通五阶段，逐阶段断言结构化字段产出 + `stageData` 落库（含阶段4 数据注入被 AI 引用、阶段3 答题后再进入不重复出题）。
> 注：阶段2/5 的教师审核截停仍属 M6（本期沿用 phase_complete 自由推进）；stage3 表格录入 UI（DataTableEditor）属 M5，本期验证用手动种入的 `stage3.rows`。

---

## M5 · 核心交互组件（依赖 M4）✅ 已完成

> 会话页改渲染 `ConversationWorkspace`（持有 `stage`+`stageData` 单一真相），按 `currentStage` 在聊天旁切换面板。

- [x] `DataTableEditor`（阶段3）：按 `stage2.schema` 动态生成表格，增/删行(minRows/maxRows)、必填校验
- [x] 文件上传：`POST /api/uploads`（≤5MB + 仅图片 PNG/JPG/WebP/GIF、`requireRole('student')`、存 `public/uploads/`）；`image` 列上传按钮，路径写 `fileAssociations`
- [x] `ChartViewer`（阶段4）：Recharts 按 `stage3.rows` 渲染折线/柱状（x=首列、y=数值列）
- [x] `ReportViewer`（阶段5）：AI 预填各节只读 + conclusion/reflection 编辑保存
- [x] 推进按钮：`POST /api/conversations/[id]/advance` + 纯函数 `canAdvance`（3→4 必填齐、4→5 放行）；学生录入落库 `PATCH /api/conversations/[id]/stage-data`（白名单字段）

**验收**：✅ `canAdvance` 单测 8/8；真实端到端：上传(201/超限400/非图400/越权403)、stage3 录入+图片落库、gating(无行 400→填齐 200，跳级 400)、4→5 推进、stage5 保存(AI 预填节受保护)、归属(非属者 404)。
> 注：阶段2/5 教师审核截停 + 提交 仍属 M6（ReportViewer 只「保存」不「提交」，stage2 面板只读预览）。

---

## M6 · 教师审核闭环（依赖 M2 + M4）✅ 已完成

> 行为变更：移除 chat 的 `phase_complete` 自动推进（保留 stage1 advanceTo）；2→3/5→6 改由教师审核驱动。状态机为纯函数 `app/lib/review.ts`。

- [x] 截停：`POST /submit-stage2`（→ PENDING_STAGE2）、`POST /submit-stage5`（→ PENDING_STAGE5 + 自动调 `generateReferenceScore` 生成 `aiReferenceScore`，失败不阻断）
- [x] 审核：`GET /api/teacher/review`、`GET/POST /api/teacher/review/[studentAssignmentId]`（approve/reject + score + feedback，班级归属校验）
- [x] 状态流转：通过→推进 currentStage（2→3 / 5→6）；驳回→`IN_PROGRESS`、`submitted=false`、保留数据 + `teacherFeedback`，可重提
- [x] 页面 `/teacher/review`、`/teacher/review/[id]`：展示方案/报告 + AI 参考评分；`app/components/ReviewActionForm`
- [x] 风险高亮：审核页对 `aiRiskAnnotations.columnKey` 对应列红色标注
- [x] 阶段6：`Stage6Panel` 展示教师评分/评语，`POST /stage6-respond` → `finalReadonly=true`、`status=COMPLETED`（防重复提交）
- [x] 学生端 `ConversationWorkspace` 加 `status`：PENDING 横幅 + 驳回反馈 + 提交按钮；教师 dashboard 待审核数

**验收**：✅ `applyReview` 单测 10/10；真实端到端：submit→列表→**reject(数据保留+反馈)→重提→approve→stage3**；stage5 submit→**真实 LLM 生成 aiReferenceScore(overall+五维+亮点+建议)**→approve(评分9+评语)→stage6→respond→**COMPLETED**；越权(教师B 403/学生 403)、错阶段提交 400、完成后重复提交 400。

---

## M7 · 直接体验模式（依赖 M4 + M5）✅ 已完成

> 复用正式模式富组件（ConversationChat 注入、DataTableEditor/ChartViewer/ReportViewer/Stage6Panel），纯函数 `extractStageData`/`canAdvance` 客户端同源。经验模式也生成 AI 参考评分自评。

- [x] `/experience` 路由：无登录、《GuestWorkspace》内存态六阶段（刷新即丢）
- [x] `POST /api/guest/chat`（免登录+IP 滑窗限流 20/min+消息长度 2000+安全黑名单）+ `POST /api/guest/score`（免登录 AI 评分）
- [x] 阶段2/5 截停模拟（点提交直接跳转），阶段3 安全问答每人进入强制，上传禁用
- [x] `ConversationChat` 解耦：注入 `send`+`onSafetyPassed`（正式/Guest 各传各的）
- [x] `DataTableEditor` `allowUpload` 控制；`Stage6Panel` `guestMode` 展示 AI 评分

**验收**：✅ guestRateLimit 单元测试 5/5；真实 LLM 往返 guest chat（dialogue 正常）+ guest score（整体+5维+亮点）；安全关键词 400；空消息 400；限流判定逻辑单测通过。

---

## M8 · 收尾与联调（依赖全部）✅ 已完成

- [x] `/` 改为落地页（直接体验/登录/注册三入口，登录后跳 dashboard）
- [x] 清理旧匿名原型：删除 `ChatInterface`/`PhaseIndicator`/`SafetyFilter`/`PhaseContext`/`/api/chat`/`PhaseData`/`ChatRequest`
- [x] `app/layout.tsx` 移除 `PhaseProvider`
- [x] seed 扩充（演示学生 student1/student2 + 演示作业 `demo-assignment-1`）
- [x] 正式模式回归：`ConversationChat` 注入改造后 chat 端点正常
- [x] CLAUDE.md/ROADMAP.md 已同步更新

---

## 整体进度

✅ **全部完成**（M0–M8，9 个里程碑）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 基建地基（Prisma/session/auth 封装/seed） | ✅ |
| M1 | 认证体系（register/login/logout/me + 守卫） | ✅ |
| M2 | 班级/作业管理（API + 教师/学生页面） | ✅ |
| M3 | 会话持久化（DB 版六阶段对话 + welcome 种子） | ✅ |
| M4 | 阶段结构化 AI 协议（ChatResponse 字段 + extractStageData + 提示词） | ✅ |
| M5 | 核心交互组件（DataTableEditor/ChartViewer/ReportViewer + 上传 + advance） | ✅ |
| M6 | 教师审核闭环（submit-stage2/5 + 审核 + AI 评分 + 阶段6 → COMPLETED） | ✅ |
| M7 | 体验模式（/experience + /api/guest/chat + 限流 + GuestWorkspace） | ✅ |
| M8 | 收尾联调（landing + 删旧原型 + seed 扩充 + 文档） | ✅ |

**当前项目状态**：完整可运行的 Next.js 全栈应用，覆盖账号/班级/作业/六阶段/结构化数据/富 UI/教师审核/体验模式。

---

## M9 · 模型迭代真实闭环（已完成）

> 设计基线见 [`docs/model-improvement-loop.md`](./docs/model-improvement-loop.md)，字段、API、页面、迁移和测试详案见 [`docs/model-improvement-loop-implementation-design.md`](./docs/model-improvement-loop-implementation-design.md)。线上模型原始回答只作为隔离候选和失败证据，未经独立人工纠正与复核不得成为其后继模型的 SFT 正样本。

- [x] M9A：打通回复风格的作业选择、会话固化、在线提示词、训练元数据和分风格评测。
  - [x] M9A1：五种版本化风格规范、教师作业选择、auto 稳定解析、会话固化、正式提示词消费、标注/仲裁规范展示，以及双标槽位共享目标风格。
  - [x] M9A2：修订和冻结版本保留风格，独立 `training` 导出写入模型可见 system 风格指令，manifest 记录实际分布，双盲结果按风格汇总。迁移和回归于 2026-07-13 完成。
- [x] M9B：建立正式会话的授权、脱敏、去重、来源模型血缘和隔离候选池；Guest 数据永不回流。
  - [x] M9B1：模型注册表、生产部署基线、正式聊天不可变 GenerationTrace、消息/阶段/轨迹原子写入和历史会话隔离。迁移与真实 LLM 验收于 2026-07-13 完成。
  - [x] M9B2：作业回流选项、学生授权/拒绝/撤回、教师按轨迹提名、本地脱敏、泄漏检查、管理员候选池和隔离批次转换。迁移与回归于 2026-07-13 完成。
- [x] M9C：把合格候选接入标注、工作量审核和匿名仲裁；验证人工实质修正，阻止同人自审，分别导出 SFT 与 chosen/rejected 偏好数据，并在训练登记时按父模型重查资格。迁移与回归于 2026-07-13 完成。
- [x] M9D：双盲评测关联稳定模型版本；总体及五风格门禁；10% → 30% → 100% 稳定分桶灰度；会话模型黏性；门禁限制和一键回滚。迁移与回归于 2026-07-13 完成。
- [x] M9E：补齐批量标注活动生命周期治理。管理员可安全结束并归档已启动活动，原子取消未完成任务但保留草稿、提交、工作量、仲裁和发布血缘；只有无业务记录的草稿可永久删除，并封住归档与领取/保存/提交并发及归档后重新开放任务的路径。回归于 2026-07-13 完成。

**验收**：可从线上失败轮次追溯到人工纠正、冻结数据、训练任务、双盲结果和部署版本；平台技术上阻止模型未经人工变换的自产出直接回灌自身后继版本。

**M9 完成状态**：✅ 风格消费、生成轨迹、授权脱敏、人工纠正、SFT/偏好导出、训练血缘、分风格评测门禁、灰度回滚与标注活动安全收尾均已形成可运行闭环。

## M10 · 六阶段数据合同 v3 重构（执行中）

> 起因见 [`docs/six-phase-prompt-dataset-audit.md`](./docs/six-phase-prompt-dataset-audit.md)。历史 489 条不再拥有正向 SFT 资格，保留其场景价值而不继承旧导师答案。

- [x] M10A：扩展 P2 结构化方案（变量、测量、控制、材料、步骤、重复次数、安全）和 P4 结构化证据轮次。
- [x] M10B：P3 安全题改为服务端权威判题；未通过时禁止数据录入和 3→4 推进。
- [x] M10C：P4 证据接受改为服务端核对学生本轮文本与真实数据表，阻止模型用隐藏上下文伪造进度。
- [x] M10D：历史 489 批次显式隔离；活动创建、冻结发布、训练登记三处共同阻断；旧数据只允许作为场景种子、反例和回归集。
- [x] M10E：建立 dataset schema v3 角色分离计划、生产 Tutor 逐轮 rollout、独立 Evaluator、断点恢复、硬校验与逐轮 SFT 导出。
- [x] M10F：加入 CI，对空数据库迁移、种子、lint、Data Lab 回归和生产构建做自动验收。
- [x] M10G：完成 30 条（六阶段 × 五风格）DeepSeek V4P 真实模型校准 rollout；25 条通过硬校验并标为 `needs_review`，5 条拒绝，taskId 无缺漏。
- [x] M10G1：生产回流轨迹只在学生授权后保存当轮模型可见完整上下文；未授权与旧轨迹不能提名，修复 P4/P5 训练记录缺少隐藏上下文的问题。
- [ ] M10H0：数据门禁加固。已完成多轮训练历史修正、DeepSeek 思考模式高预算与空白 JSON 降级重试、VisibleFacts 嵌套数据修复、P2 fact id 来源链和服务器表格、P5 服务器报告、确定性硬门禁与语义人工复核分层、领域化 30 格计划、六阶段过滤器、记录级风格验收、可观测蒸馏日志，以及统一的[六阶段导师文本验收标准](docs/six-phase-text-acceptance-criteria.md)。六阶段苏格拉底抽样已逐条人工复核：当前规则下全部 0 hard error，P4 保留 1 个语义改写人工复核 warning；所有候选仍为 `needs_review`，下一步是双人复核这 6 条后再扩展 30 格。
- [x] M10H1：完成“门禁语义分级与前后端统一”。只有确定性结构、来源和状态机冲突阻止提交；P1/P6 多问号、普通同义改写、未知设备风险、可能结论和风格表现改为持续显示的人工复核项。标注预检、正式提交、工作量审核和匿名仲裁共用服务端校验链；界面统一为绿/黄/红三态并支持定位具体导师轮次。同步修复 P2 否定句与索引列、P3 否定提醒、P4 等值证据/句段因果/真实 dataRows 转场、P5 否定完整报告等边界。无需数据库迁移；2026-07-14 在独立临时库通过全套 Data Lab 回归、lint、生产构建和黄色 warning 的真实 HTTP 提交验收。
- [ ] M10H：由团队人工复核 25 条候选，必要时将 5 条失败转为回归/偏好案例；确认各阶段与五风格质量后再扩大到 400+。

**当前状态**：原 `calibration-30` 的 25 条候选继续冻结为对照，不导入、不删除；M10H0 的生成门禁仍在推进，M10H1 已消除 Data Lab 前后端判定漂移和机械问号硬拒。因 Tutor、学生模拟器与 Evaluator 当前共用 DeepSeek V4P，任何新候选都必须保持 `needs_review`，在人工质量门禁完成前不得称为 Gold。
