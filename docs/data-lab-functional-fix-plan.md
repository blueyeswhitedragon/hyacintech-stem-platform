# Data Lab 功能性修复计划（交接给实现方）

> 起草日期：2026-07-25。基于四段「新手管理员真实动线」审计（冷启动 / 生产侧数据收集 / A-B 生成+双审+导出 / 登记模型+Prompt+灰度）。
> **本文档只覆盖功能性改动，不含视觉风格重构。** 视觉气质调整（暖调、留白、状态色收敛）待本计划完成、页面复审后另行决定。
>
> 所有行号基于 2026-07-25 的 master（`1f64570`）。实现前请先复核对应代码，行号可能已漂移。

## 背景约束（决定了什么该修、什么不该修）

1. 本项目服务器**不能训练也不能托管模型**。训练/推理部署在外部算力平台完成，Data Lab 的身份是**数据出口 + 结果登记簿**，不是训练操作台。
2. 目标模型是比赛方提供的 Qwen3.5-35B 网关（`.env.example` 里"该模型停服"的注释**已过时，服务已恢复**）。网关真实 base URL 形如 `/v1/v1`，需要 `LLM_TIMEOUT_MS=180000`。
3. 团队规模 1–3 人。任何"必须两个自然人"的设计都会成为实际阻塞。
4. 目标用户是**懂后训练与版本管理、但没读过本仓库代码**的人。判定标准：他不看源码能不能走完。

## 优先级总览

| # | 问题 | 性质 | 优先级 |
|---|---|---|---|
| A1 | 生产回流案例拿不到「生成双候选」按钮 | 结构性死路 | P0 |
| A2 | 部署门禁要求的字段，评测脚本从不产出 | 结构性死路 | P0 |
| B1 | 单人团队唯一通路藏在下拉里，且文案反向误导 | 走得通但没人找得到 | P1 |
| B2 | `AUTHORIZED_AGENT` 是空实现，静默退化 | 假功能 | P1 |
| B3 | `/data-lab/candidates` 活流程被标为「历史数据」 | 入口错置 | P1 |
| B4 | 授权时序陷阱：先聊后授权 = 永不可提名 | 静默失效 | P1 |
| C1 | 冷启动无法自助完成，密钥两处维护 | 上手阻塞 | P1 |
| C2 | Prompt 无法在 UI 内真正新建 | 能力边界未表达 | P2 |
| C3 | 遗留页无角色守卫，可写入冻结流程 | 越权 | P1 |
| D1 | 观察指标只写不读，重存清零 | 数据丢失 | P1 |
| D2 | `artifactValidation` 硬编码恒真 | 空转校验 | P2 |
| D3 | 门禁失败甩英文码 | 文案 | P2 |
| E* | 一批小修（见第 6 节） | 杂项 | P2/P3 |

---

## 1. P0 — A1：生产回流案例的生成入口

### 现象

`/data-lab/candidates` 转换出的案例永久卡在 `READY`，进不了初审、进不了 Release，同时在概览「待生成案例」上刷一个永远消不掉的数字。

### 根因链（已逐条验证）

1. `app/lib/productionCandidates.ts:356` 创建 `TutorTurnCase{ dataSource:'PRODUCTION_TRACE', split:'TRAIN' }`，**`generationRunId` 为 null**。
2. `app/components/dataLab/CaseGenerationManager.tsx:208` 分组时，无 run 的案例 `profile` 落为 `'CUSTOM'`，分组 key 为 `source-<caseId>`（`:204`）。
3. `:229` 的 `latestByProfile` 用 `isProfile()`（`:116`）过滤掉 `CUSTOM`，于是这些案例只出现在 `historyRuns`。
4. `historyRuns` 的渲染区（`:588` 起，标题「历史批次记录」）**只渲染统计、标记已替代、删除、展开查看**——「生成双候选」按钮只存在于五个 profile 的 stepper 卡片内（`:558` 附近）。
5. 即便按钮能点，`generateAll` 发的是 `body: '{}'`（`:333`），而 `app/lib/dataLab/bootstrap/service.ts:990` 在案例未冻结运行组合时抛「案例未冻结运行组合，modelA 和 modelB 必填」。
6. 概览计数 `app/lib/dataLab/bootstrap/service.ts:1259` 明确把 `generationRunId: null` 计入 `casesReady`——所以数字会涨，但没有任何界面能消化它。

注：`generateAll` 的错误文案里已有 `'生产回流案例'` 兜底（`:334`、`:335`），说明这条路径被设计时想到过，只是入口没接上。

### 修法（推荐：方案 A）

**方案 A — 给生产回流案例一个一等公民的独立区块。** 这与「Data Lab 是数据出口」的定位一致：生产回流本就不属于 Smoke/Cal/Trial 四级扩产体系，不该硬塞进 profile stepper。

具体：

1. 在 `CaseGenerationManager` 中新增一个 `productionRuns` memo：从 `groupedRuns` 里筛出 `profile === 'CUSTOM'` 且 `cases.some(c => c.dataSource === 'PRODUCTION_TRACE')` 的组，**从 `historyRuns` 中排除它们**（修改 `:238` 的 `historyRuns` 过滤）。
2. 在页面主体、四级 stepper **之后**、「历史批次记录」**之前**，新增 `<section id="production-reflow">`：
   - 标题「生产回流案例」，副标题说明「来自已授权的真实师生会话，不受四级扩产门禁约束，可直接生成双候选进入初审」。
   - 每条案例一行，显示阶段、来源 Prompt/合同版本、学生消息摘要、状态。
   - 顶部一个「为全部 N 条生成双候选」按钮 + 每行一个单条生成按钮。
   - 复用现有的 `ConfirmDialog`，consequence 写明「预计 N×4 次模型调用」。
   - 空状态：「暂无生产回流案例。教师提名并由管理员在[线上候选审核](/data-lab/candidates)通过后，会出现在这里。」
3. **模型选择**：生产回流案例没有冻结的 bundle。在该区块顶部复用页面已有的 A/B 运行组合选择器状态（`candidateARuntimeBundleId` / `candidateBRuntimeBundleId`），生成时把它们放进请求体：
   ```ts
   body: JSON.stringify({
     modelA: { runtimeBundleId: candidateARuntimeBundleId },
     modelB: { runtimeBundleId: candidateBRuntimeBundleId },
   })
   ```
   这需要 `generateAll` 接受一个可选的 model 覆盖参数（当前写死 `'{}'`，`:333`）。
4. **服务端**：`app/api/data-lab/tutor-cases/[id]/candidates/route.ts` 已经接受 `modelA`/`modelB`（`:11`），无需改。但 `generateTutorCandidates`（`service.ts:975` 起）当前只在 `frozenA || frozenB` 时用 `resolveRuntimeBundleConfig` 补全 provider/model/family/tag。**当传入的 `modelA/modelB` 只有 `runtimeBundleId` 而无其它字段时，也要走一遍 `resolveRuntimeBundleConfig`**，否则 `assertIndependentModelFamilies`（`:991`）会因 `family` 为 undefined 而误判。
5. 按钮的 disabled 前置条件写在按钮**上方**（不是点了才报错）：需要 A/B 两个 `AVAILABLE` 且模型家族不同的运行组合。复用页面已有的 `runtimeSelectionReady` 判断。

**方案 B（备选，改动更小但语义更脏）**：在转换时就为生产回流案例创建一个 `kind:'CASE_COMPILATION'`、`parametersJson` 含 `"profile":"CUSTOM"` 的 run。这样它能被现有 CUSTOM 逻辑识别，但仍然进不了 stepper，且会污染 `deleteGenerationRun` 的语义。**不推荐**，仅在方案 A 工期不允许时退守。

### 顺带修：CUSTOM 组的删除按钮必定 400

`:589` 的删除按钮在 `counts.ready + counts.blocked === cases.length` 时渲染，CUSTOM 组满足该条件，但传入的 `group.id` 是 `source-<caseId>` 而非真实 run id，`deleteGenerationRun`（`service.ts:1232`）校验 `run.kind !== 'CASE_COMPILATION'` 必然抛「案例编译批次不存在」。**修法**：把删除/标记已替代按钮的渲染条件加上 `isProfile(group.profile)`（`group.profile !== 'CUSTOM'` 已用于「标记为已替代」，删除按钮漏了）。

### 验收

- [ ] 走完 教师提名 → 管理员审核通过 → 转换，案例出现在「生产回流案例」区块而非「历史批次记录」。
- [ ] 点「生成双候选」成功产出 A/B 候选，案例进入初审队列。
- [ ] 生成后概览「待生成案例」计数正确下降。
- [ ] 未选 A/B 运行组合时按钮 disabled，且上方以中文写明缺什么。
- [ ] CUSTOM 组不再出现必定 400 的删除按钮。

---

## 2. P0 — A2：部署门禁字段与评测脚本产出对不上

### 现象

管理员走完九步表单，最后点「计算部署资格」，恒得 `INSUFFICIENT`，UI 甩出 `部署资格未通过：PHASE_MISSING:P1、PHASE_MISSING:P2、…、PARSE_SUCCESS_METRICS_MISSING`。**这不是模型质量不达标，是平台自己发货的评测脚本从不产出门禁要的字段。**

### 根因（已验证）

`app/lib/deploymentGate.ts` 要求 `run.summary.phase` 是一个 `Record<'P1'..'P6', CountSummary>`，其中 `CountSummary` 含 `A/B/tie/inconsistent/criticalErrors/parseSuccessA/parseTotalA/parseSuccessB/parseTotalB`（`:5-15`）。

- `:101` `if (decisive === 0) failures.push('PHASE_MISSING:P${phase}')`
- `:118` `else failures.push('PARSE_SUCCESS_METRICS_MISSING')`

而唯一发货的评测脚本 `scripts/blind-eval.ts:1516` 产出的 verdict `summary` 只有：
```ts
summary: {
  scenario: countSummary(scenarioVerdicts),
  turn: countSummary(turnVerdicts),
  dimensions: dimensionSummary(scenarioVerdicts),
}
```
**没有 `phase`，没有 parse 指标。** `:88` 的 scope 回退 `/(?:phase|P)[-_ :]?(\d)/i` 也救不了——该脚本的 scope 只会是 `'smoke'|'full'`。

结论：这条路在生产上不可能走通，只有 `scripts/test-*.ts` 手工构造的合规 summary 才能 PASS。

### 修法

**两端都要动，缺一不可。**

**(a) 让 `blind-eval.ts` 产出逐阶段与 parse 指标。**

1. `scenarioVerdicts` / `turnVerdicts` 的每条记录需要带上它属于哪个阶段。检查现有 `ScenarioRecord` 是否已有 phase 字段（transcript 侧 `collectSummary` 附近，`:986`）；若无，从场景定义或 turn 元数据里带出来。
2. 新增 `phaseSummary(verdicts)`：按 P1–P6 分桶，每桶复用现有 `countSummary` 逻辑产出 `{A, B, tie, inconsistent}`。
3. parse 指标：transcript 侧已有 `parseOk` 概念（`:1074` 的 console 输出证实 `transcript.summary.parseOk` 存在）。把 A/B 两侧的 parse 成功/总数按阶段汇总为 `parseSuccessA/parseTotalA/parseSuccessB/parseTotalB` 写进对应桶。
4. 最终 `summary` 变为：
   ```ts
   summary: {
     scenario: countSummary(scenarioVerdicts),
     turn: countSummary(turnVerdicts),
     dimensions: dimensionSummary(scenarioVerdicts),
     phase: phaseSummary(scenarioVerdicts, turnVerdicts, parseStats), // 新增
   }
   ```
   **保持旧字段不变**，只做增量，避免破坏已有 verdict 文件的可读性。

**(b) 让导入端能诊断，而不是甩码。**

`app/api/data-lab/evaluations/import/route.ts` + `app/lib/dataLab/service.ts` 的导入逻辑：在写入前校验 `summary.phase` 是否存在且六阶段齐全，若不齐，**在导入成功的同时**记录一条结构化的「产物不完整」诊断，供 UI 展示"缺的是产物字段，不是模型质量"。

**(c) 提供样例与格式说明。**

`EvaluationImportForm.tsx:130` 当前只说「选择基线对话、候选对话和裁决结果三个文件」。补上：
- 三个文件各自的必需字段清单（中文）。
- 一个可下载的最小合规样例（放 `public/samples/` 或由一个 GET 路由生成）。
- 明确写出「verdict 的 `summary.phase` 必须含 P1–P6，否则部署资格无法计算」。

### 验收

- [ ] 用 `blind-eval.ts` 跑一次真实 A/B，产出的 verdict 含 `summary.phase` 且六阶段齐全、含 parse 指标。
- [ ] 导入该 verdict 后点「计算部署资格」，得到 `PASS` 或 `FAIL`（**而非 `INSUFFICIENT`**）。
- [ ] 故意导入缺 phase 的旧 verdict，UI 明确提示「评测产物缺少逐阶段字段，请用新版 blind-eval 重新生成」并给出修复指引。

---

## 3. P1 — 小团队通路与入口错置

### B1：让「单人可走」成为明示路径

**现状**：三处代码强制双人——
- `app/lib/dataLab/bootstrap/service.ts:1315` CONFIRM 领取查询要求存在 `submissionMode: 'AI_DIRECT_ADMIN_AUTHORIZED'` **或** `operatorId: { not: user.id }` 的已提交初审；
- `:1813` 「不能批准自己提交的导师草稿」；
- `:1764` `draftPreparedById === humanReviewerId` 时打 `DRAFT_AND_FINAL_SAME_HUMAN`，**永久失去训练资格**。

唯一逃生舱是 `AI_DIRECT_ADMIN_AUTHORIZED`，三处都为它开了口子。但它藏在 `CaseGenerationManager.tsx:525` 一个叫「初审执行方式」的普通下拉里，默认值是 `'HUMAN'`（`:181`），且旁边的说明文字「无论哪种方式，正式定稿都保留独立人工质量门」**反向暗示还需要第二个人**。

新管理员的必然结局：选默认的「人工初审」→ 自己初审 → 去定稿工作台看到空队列 → **没有任何错误信息告诉他"这条任务被你自己的初审身份排除了"**。

**修法**：

1. 在批次设置区把这个下拉提升为一个**显式的团队规模选择**，放在最显眼处，而不是埋在一堆字段里：
   - 选项一「我是单人/双人小组」→ 映射 `PLATFORM_AI`（即 `AI_DIRECT_TO_REVIEWER`），说明「AI 完成初审草稿，你只做最终定稿。这是小团队唯一可行的方式。」
   - 选项二「有独立标注员」→ 映射 `HUMAN`，说明「需要 annotator 与 reviewer 两个不同账号；同一个人不能既初审又定稿，否则该条数据将失去训练资格。」
2. 改掉误导文案「无论哪种方式，正式定稿都保留独立人工质量门」——它在 AI 初审模式下不成立（定稿人就是管理员本人）。改为按所选模式动态显示上述说明。
3. **定稿工作台空队列时给出归因**。`/data-lab/final-confirmation` 队列为空时，查一下是否存在「因 `operatorId === 本人` 而被排除」的 AWAITING_CONFIRMATION 任务，若有则提示：「有 N 条任务因为初审是你本人提交的而无法由你定稿。请换用 AI 初审模式，或让另一个账号定稿。」这是本条里**收益最高的一处**。
4. 在批次创建成功后的反馈里带上「本批次初审方式：X，接下来去 Y」。

### B2：`AUTHORIZED_AGENT` 是空实现

全仓引用只有四处（`CaseGenerationManager.tsx:181`、`:525` 的 `<option>`、`app/api/data-lab/tutor-cases/route.ts:17` 的类型、`service.ts:647` 的类型）。`:273` 的映射 `firstReviewMode === 'PLATFORM_AI' ? 'AI_DIRECT_TO_REVIEWER' : 'HUMAN_ANNOTATOR_REQUIRED'` 意味着选它**等同于选人工初审**，而它自称「导出授权代理初审包」——不存在任何导出功能。

**修法**：直接从 `<option>` 移除该选项（类型与 DB 字段保留，历史记录可能已用到）。假功能比缺功能更伤——它让人以为有第三条路。若将来要实现，再加回来。

### B3：`/data-lab/candidates` 入口错置

这是**活流程**（M9B2 生产回流的必经关口），但：
- 不在 `app/data-lab/layout.tsx` 侧边导航；
- 不在 `app/data-lab/page.tsx` 的六段流水线，也不在「完整交接路径」八步里；
- 全仓唯一链接在 `app/data-lab/history/page.tsx:5`，标签「线上候选历史」，紧邻「旧数据批次」「旧标注活动」——**活流程被摆进了冻结流程的陈列柜**。

**修法**：

1. `layout.tsx` 的「数据生产」组新增 `{ href: '/data-lab/candidates', label: '线上候选审核', count: <待审数> }`。需要在 `tutorWorkflowCounts()` 里补一个待审候选计数。
2. 概览页 `page.tsx` 的六段流水线：生产回流是「数据从哪来」的第二个源头（与话题卡并列）。建议在「话题库」卡片旁并列一张「线上回流」卡，而不是硬塞进现有六段。
3. 从 `history/page.tsx` 移除该链接，或改为指向新位置。
4. 概览「当前工作量」卡片组补一张「待审线上候选」。

### B4：授权时序陷阱

`trainingSystemPromptSnapshot` 只在对话发生**那一刻** `dataConsentStatus === 'GRANTED'` 才写入（`app/api/conversations/[id]/chat/route.ts:152`、`:219`）。提名要求它非空（`app/lib/productionCandidates.ts:155`）。

后果：**学生先聊完、后授权 → 所有历史 trace 快照为空 → 全部不可提名。** 而 `CandidateNominationPanel` 照样列出每条 trace 和蓝色「提名这一条」按钮，点下去才报「该生成轨迹未保存经授权的完整训练上下文」。`traceCoverage !== 'COMPLETE'` 同样静默。

**修法**（不改数据模型，只改可见性——补写历史快照会违反"授权当时才捕获"的合规前提，不要做）：

1. 提名面板对每条 trace 预先计算可提名性，不可提名的**置灰并就地写明原因**：
   - 「学生在这条对话之后才授权，此回合未保存完整训练上下文，不可提名」
   - 「这条对话产生于系统升级前，轨迹覆盖不完整」
2. `DataConsentCard` 增加一句时序提示：「授权后的对话才能用于模型改进，之前的对话不受影响也不会被采集。」让学生和教师都建立正确预期。
3. 教师端作业列表/评阅页显示「本作业可提名回合：N」，为 0 时说明原因。

---

## 4. P1 — C1：冷启动自助化

### 现状（已验证）

| 步骤 | 能否网页完成 |
|---|---|
| 写入 provider key 到 `.env` | ❌ 必须命令行。缺 key 时 `app/lib/modelRegistry.ts:58` 抛错，**学生打不开任何作业** |
| `npm run db:deploy` | ❌ |
| 首个 admin 账号 | ❌ 只能 `npm run data-lab:init`；`app/api/auth/register/route.ts:26` 只放行 student/teacher |
| `npm run model:bootstrap` | ❌（首个学生会话会隐式触发） |
| `DATA_LAB_CREDENTIAL_MASTER_KEY` | ❌ 且 **`.env.example` 里没有这一项**，缺失时 UI 的「数据库加密凭据」选项必然报错（`app/lib/dataLab/providerCredentials.ts:12-15`） |
| 登记服务连接 / Endpoint / RuntimeBundle | ✅ |

**最伤的一点**：即便管理员把全部端点和密钥通过网页登记完毕、组合评测通过、角色绑定完成，**学生端 Tutor 依然一行都不会用到这些 DB 凭据**。原因是首次启动创建的 baseline `ModelDeployment` 的 `runtimeBundleId` 为 null（`modelRegistry.ts:74-96`），`resolveConversationModel` 返回裸 `ModelVersion`，`chat.ts` 回落到 `createLLMProvider()` 读 env。要让 DB 凭据接管生产会话必须走 `createOrPromoteRuntimeDeployment`，而它要求部署门禁 PASS——**一个刚部署、没有任何训练产物的团队结构上不可能满足**。

于是现实是：**同一份密钥必须在 `.env` 和 UI 各维护一遍，而 UI 完全没有提示这一点。**

此外这些角色永远只读 env，DB 注册表对它们无效：Extractor（`app/lib/stateExtractor.ts:449`）、AI Curator（`bootstrap/service.ts:1586`）、TopicCard 生成/批评/autofill、Stage5 评分、Guest 体验模式。而 `RuntimeBundleManager.tsx:161` 的「角色默认组合」下拉写入的 `defaultRuntimeBundleId`，**全库只有写入、没有任何运行时读取**——是纯死记录。

### 修法

**(a) 新增冷启动检查清单页** `/data-lab/setup`（或在 `/data-lab` 概览顶部条件渲染）。逐项检测并给出状态：

```
□ 数据库已迁移              ✓
□ 会话密钥已配置            ✓
□ 至少一个 provider key     ✗  必须写入 .env（学生端 Tutor 与 Extractor 只读环境变量）
                               OPENAI_API_BASE=https://<网关>/v1/v1
                               OPENAI_API_KEY=...
                               LLM_TIMEOUT_MS=180000
□ 凭据主密钥                ✗  DATA_LAB_CREDENTIAL_MASTER_KEY=<openssl rand -base64 32>
□ 管理员账号                ✓
□ 运行时模型已登记          ✓
□ AI 服务连接（Data Lab 用）✗  → 去登记
```

每项标注【网页可完成】/【需命令行】，命令可一键复制。全部就绪后该页折叠为一行「环境就绪」。

**(b) 在 AI 服务页顶部明确说明双轨事实**，一句话即可：

> 这里登记的连接供 Data Lab 的案例生成、批评与评测使用。**学生端 Tutor、Extractor、话题卡编译、报告评分仍读取 `.env` 环境变量**，两者需分别配置。待候选模型通过部署门禁并灰度上线后，学生端才会切换到这里登记的运行组合。

**(c) 补 `.env.example`**：加入 `DATA_LAB_CREDENTIAL_MASTER_KEY`，并**更新那条已过时的「Qwen 模型停服」注释**。

**(d) 「角色默认组合」二选一**：要么实现运行时读取，要么在 UI 上标注「登记用途，暂不影响运行时」。当前状态（看起来能配、实际无效）最坏。同理，`AIServiceManager` 的「测试连接」只 GET `/models`（`runtimeRegistry.ts:460`），不验证 `/chat/completions` 或 JSON mode——建议测试时额外发一次最小 chat 请求并检查 `response_format` 支持，否则会出现"测试通过、生成全崩"。这对 `/v1/v1` 这类非标准网关尤其重要。

---

## 5. P1/P2 — 其余确认项

### C3（P1）：遗留页无角色守卫

`app/data-lab/annotate/page.tsx` 与 `app/data-lab/review/page.tsx` **完全没有角色守卫**（已确认全文，只有 4–5 行，直接渲染组件），而 `first-review`、`final-confirmation`、`workload` 都有。其 claim API 仍然可用：`app/api/data-lab/tasks/claim/route.ts:6` 放行 `annotator|reviewer|admin`。

**后果**：任何后台角色手输 URL 就能进入已冻结的旧五风格工作台并**写入数据**。

**修法**：两页顶部加角色 `redirect`；或更彻底——既然旧流程已冻结，让这两页 `redirect` 到对应新工作台，并让 `tasks/claim`、`tasks/[id]/draft`、`tasks/[id]/submit` 与已经 410 的 `batches/import` 保持一致返回 410。

顺带：`app/data-lab/campaigns/page.tsx:66` 写着「历史数据，只读」，却仍渲染 `CampaignLifecycleActions`、`ExpiredTaskManager` 等活控件——自相矛盾，按只读定位收掉写入控件。

### D1（P1）：观察指标只写不读

`DeploymentControls.tsx:44` 把 observation 表单初始化为**全 0**，且 `active.observationJson` 只被读出 `promotionPaused` 一个字段（`:51`）。**已保存的指标和已过去的观察时长从不显示，再次保存会静默把它们覆盖成 0。**

**修法**：
1. 从 `observationJson` 反序列化已保存值作为表单初值。
2. 展示观察窗进度：「10% 灰度已运行 31 / 48 小时 · 已观察 22 / 50 会话」（阈值来自 `deploymentGate.ts:126-127`）。
3. 保存时做增量语义说明，或明确标注"覆盖上次记录"。

### D2（P2）：`artifactValidation` 硬编码恒真

`app/lib/dataLab/service.ts:1719` 在导入时直接写死：
```ts
artifactValidation: { complete: true, invalidArtifacts: 0, scenarioIdsComplete: true, modelIdentitiesVerified: true, scenarioCount: scenarioIds.length }
```
于是 `deploymentGate.ts:92` 的那项检查是空转。**修法**：真实校验 transcript 的 scenarioId 与 verdict 引用是否一一对应、模型标识是否与登记的 tag 一致。与 A2(b) 一起做最省事。

### D3（P2）：门禁失败文案

`DeploymentControls.tsx:84` 直接渲染 `PHASE_MISSING:P1` 一类英文码。`labels.ts` 已有 `gateFailureLabel`（约 `:211-229`）但**这里没用上**。同类问题：`evaluations/page.tsx:48` 直接 `<pre>{run.gateReportJson}</pre>`。

**修法**：全部经 `gateFailureLabel` 映射，并区分两类语义——「产物不完整（去补数据）」vs「质量未达标（去改模型）」。这是管理员最容易误判的一处。

### C2（P2）：Prompt 无法在 UI 内新建

「创建新版修订」能写 DB 行，但预览（`runtimeRegistry.ts:277`）与批准（`:245`）都要求版本已在代码注册表 `TUTOR_LANGUAGE_PROMPT_VERSIONS` 内，否则抛「该策略尚未进入代码注册表，不能批准为可执行策略」。

这是**合理的架构约束**（prompt renderer 是代码），不该硬改。但当前让管理员走到最后一步才发现。**修法**：在「创建新版修订」表单上方就说明「新 Prompt 版本需要先在代码中实现 renderer 并部署；此处用于登记、比对与审批已实现的版本」。把能力边界提前告知，而非事后拒绝。

---

## 6. P2/P3 — 小修清单

| 位置 | 问题 | 修法 |
|---|---|---|
| `labels.ts:251` `EXPORT_KIND_META` | 含现成中文文件用途说明，**全库零引用** | 接进 `ReleaseManager.tsx:129-130`，替换裸 `{kind}.json` |
| `TopicCardManager.tsx:417` | 「批准」按钮在"需人工确认"状态下仍可点，必然吃 400 | 按同卡已计算出的 `:414-415` 条件 disable，原因写按钮下方 |
| `TopicCardManager.tsx:417` | 单卡「删除」无二次确认（同排「批量批准」反而有） | 接 `ConfirmDialog` |
| `TopicCardManager.tsx:181` | 四步表单+实时预览被 `manualOpen` 守卫，只在被降级的「高级：手工建卡」里可用 | 让草稿审核路径也能开预览；「查看」与「编辑」拆成两个动作（当前点「修改」会 `setEditingId` 并在保存时把卡打回待审核） |
| `TopicSourcePool.tsx` | 已按提案改好，但**没有任何页面 import 它**，是死代码 | 按提案 §1 在话题库页加「素材池 / 话题卡」两个 tab |
| `PromptPolicyManager.tsx:146,147` | 两个按钮跑同一段代码 | 合并或实现差异 |
| `RuntimeBundleManager.tsx:185,188` | 「查看评测证据」与「查看影响范围」打开同一对话框 | 同上 |
| `RuntimeBundleManager.tsx:161` | 裸 `<select onChange>` 直接改写角色生产默认，无确认 | 加 `ConfirmDialog` |
| `PromptPolicyManager.tsx:149-151` | 「设为 Data Lab 默认」等影响全局的动作点击即生效 | 加确认 + 后果说明 |
| `TutorReviewWorkbench.tsx` | **无草稿保存**：候选选择、手编 JSON、理由全在 React state，租约过期全丢（旧的 `AnnotationWorkbench.tsx:146` 反而有保存草稿） | 加 PATCH draft 端点 + 自动保存 |
| `TutorReviewWorkbench.tsx:335` | 提交成功后立刻硬跳转，成功提示来不及渲染 | 先展示结果再跳，或原地领取下一条 |
| `TutorReviewWorkbench.tsx:584` | `REJECT` / `RETURN_CASE` 单击即执行，无确认 | 接已有 `ConfirmDialog` |
| `TutorReviewWorkbench.tsx:474` | 显示裸 `HUMAN`/`PLATFORM_AI`/`AUTHORIZED_AGENT` | 补 label 字典 |
| `labels.ts:7-50` | 缺 `RETURNED_TO_ANNOTATOR`、`CASE_REJECTED`，渲染成"状态待确认" | 补齐 |
| `ModelGovernanceControls.tsx:35` | 裸渲染 `DRAFT/SUBMITTED/RUNNING/...`（兄弟组件 `TrainingRunForm.tsx:60` 正确用了字典） | 用 `DATA_LAB_STATUS_LABELS` |
| `RuntimeBundleManager.tsx:167,178,194`、`evaluations/page.tsx:46` | 裸渲染 `verificationStatus` / `endpoint.status` / `compatibilityStatus` / `run.scope` | 同上 |
| `TrainingRunForm.tsx:61` | 「训练参数 JSON」`defaultValue="{}"`，无期望字段说明 | 给示例（`RuntimeBundleManager.tsx:51` 已有好范例） |
| `ModelVersionForm.tsx:71-86` | `provider`/`externalModelId` 与 ai-services 的 Endpoint 重复录入，且实际调用只用 endpoint 侧 | 至少加说明；理想是从 Endpoint 下拉选择 |
| `deployment.ts:44,126` | `ENABLE_MODEL_DEPLOYMENT=false` 时 UI 无禁用态，点了才弹错 | 服务端把开关状态传给 UI，禁用并说明 |
| 全站 | 无按会话溯源 trace 的界面，回答"这条回复来自哪个 Prompt+模型+Release"必须查 SQLite | 加一个只读溯源视图（血缘 FK 链在 schema 层是完整的） |

---

## 7. 建议实施顺序

1. **第一批（解锁流程）**：A1 + A2。这两条不通，后面一切都是纸上谈兵。
2. **第二批（让人找得到、走得完）**：B1、B3、C1(a)(b)(c)、C3。
3. **第三批（防丢数据、防误判）**：D1、B4、B2、D3、`TutorReviewWorkbench` 草稿保存。
4. **第四批（收尾）**：D2、C2、第 6 节小修。

每批完成后请通知，我会复审页面再决定下一步是继续推进功能还是转入视觉气质重构。

## 8. 全局约束（实现时务必遵守）

- 遵守 `AGENTS.md`：Next.js 16 路由 `ctx.params` 是 Promise；所有路由用 `requireUser()`/`requireRole()`；沙箱**无 npm 源，不能装新依赖**。
- 阶段产物、确认哈希、安全校验、证据指纹、状态流转一律**服务端所有**，不信客户端声明。
- 已冻结的 Release 与 GenerationTrace 是**不可变历史数据**，不得改写或重新打标。
- 不要为了让门禁通过而放宽门禁阈值——A2 要修的是产物字段缺失，**不是降低标准**。
- 术语一律走 `app/lib/dataLab/labels.ts`，不要在组件里散落中文映射。
- 无测试框架；纯函数改动请在 `scripts/` 下加 `test-*.ts`，用 `npx tsx` 运行。`deploymentGate` 的改动尤其需要测试覆盖。
