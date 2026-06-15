# Hyacintech STEM 平台 · 实施 Roadmap

> 目标：从当前「单用户匿名六阶段 AI 聊天原型」演进到框架2(v3.0)要求的
> 「账号 / 班级 / 作业 / 教师审核 / 数据表 / 图表 / 报告 / 双模式」完整全栈平台。
> 当前实现度约 10~15%。本 roadmap 按依赖顺序排列，**上层里程碑依赖下层完成**。

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

- [ ] 安装依赖：`prisma @prisma/client iron-session bcryptjs openai recharts`（文件上传可用 Next 内置 `Request.formData()`，不强依赖 formidable）
- [ ] 创建 `prisma/schema.prisma`（6 张表：User / Class / ClassMember / Assignment / StudentAssignment / Conversation，按框架2第三章）
- [ ] `npx prisma migrate dev --name init` 生成 `dev.db`
- [ ] 在 `app/lib/db.ts` 封装单例 PrismaClient（避免 dev 热重载多实例）
- [ ] 在 `app/lib/session.ts` 封装 iron-session 配置（读 `SESSION_SECRET`）
- [ ] `app/models/stageData.ts`：把框架2的 `StageData`(stage1~6) TS 接口落地，供前后端共用
- [ ] 更新 `.env.example`：补 `DATABASE_URL`、`SESSION_SECRET`
- [ ] `prisma/seed.ts`：创建演示教师 + 1 个班级，方便测试

**验收**：`npm run dev` 能起，`dev.db` 自动生成，seed 能写入数据。

---

## M1 · 认证体系（依赖 M0）

- [ ] `POST /api/auth/register`（含 role 字段，bcrypt 加密）
- [ ] `POST /api/auth/login`（校验密码，写 iron-session `{id,username,role,displayName}`）
- [ ] `POST /api/auth/logout`、`GET /api/auth/me`
- [ ] `app/lib/auth.ts`：`requireUser()` / `requireRole('teacher')` 守卫工具
- [ ] 页面：`/auth/login`、`/auth/register`
- [ ] 首页 `/` 改造：[直接体验] + [登录] 双入口

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
