# M9 模型迭代闭环：详细实施设计

状态：已完成。M9A、M9B、M9C、M9D 均于 2026-07-13 完成并通过回归。

关联文档：[`model-improvement-loop.md`](./model-improvement-loop.md)。

## 1. 设计范围

本设计覆盖：

- 五种导师回复风格从任务目标到训练、在线推理和评测的完整消费；
- 正式教学会话的生成轨迹、授权、脱敏、候选提名和 Data Lab 回流；
- SFT 与偏好数据资格判定；
- 模型版本、父子血缘、外部训练、评测门禁、灰度部署和回滚记录。

本设计不要求平台直接执行 GPU 训练。外部训练仍可在主办方或云平台完成，但必须在本平台登记输入数据、父模型、输出模型和结果，才能继续评测与部署。

## 2. 当前系统可复用部分与缺口

### 可直接复用

- `Conversation`、`StudentAssignment`：正式会话和六阶段状态；
- 教师阶段 2/3/5 审核：教育场景信号和候选提名入口；
- `DatasetBatch`、`DatasetSample`：不可变数据导入；
- 双人标注、工作量审核、匿名仲裁：人工纠正和质量门禁；
- `DatasetRelease`：冻结发布与文件校验；
- `TrainingRun`、`EvaluationRun`：外部训练和双盲结果登记；
- `DataLabAuditLog`：管理操作审计。

### M9A 已补齐

- 作业与会话持久化版本化导师风格，`auto` 在会话创建时稳定解析；
- 正式聊天提示词消费会话固化风格；
- 标注任务、人工修订、发布条目和 manifest 保留目标风格血缘；
- 冻结版本同时生成 canonical `clean` 与模型可见风格指令的 `training` 导出；
- 双盲 transcript/verdict 固化目标风格，后台按风格分别汇总。

### M9B1 已补齐

- 当前运行模型以稳定标签登记到 `ModelVersion`，保留 provider、外部模型 ID、父模型和训练登记关系；
- 启动器幂等创建当前生产模型的只读部署基线，不读取或保存 API Key；
- 每次正式聊天成功后创建不可变 `GenerationTrace`，固化模型、提示词/请求/响应指纹、风格、生成参数和契约检查；
- 展示消息、结构化阶段数据、阶段推进和生成轨迹在同一数据库事务中提交；
- 新会话标记 `COMPLETE`，迁移前或未显式启用追踪的会话保持 `LEGACY_UNVERIFIED`；
- Guest 模式仍不创建数据库会话或 GenerationTrace，因此不会进入后续生产候选回流入口。

### M9B2 已补齐

- 教师发布作业时可选择是否开放学生自愿数据授权，默认关闭；
- 学生可以同意、拒绝或撤回，所有选择不影响作业状态和成绩；
- 教师只能按 `GenerationTrace.assistantMessageId` 提名已授权、完整追踪的正式导师回复；
- 提名时在本机确定性删除姓名、账号、班级、邮箱、手机号、证件号、URL 和附件路径，不调用外部模型；
- 候选与现有数据执行精确指纹和字符 shingle 近重复检查；精确重复不能通过；
- 管理员只能查看脱敏快照，通过后转换为 `sourceType=production_trace` 的隔离批次；
- 撤回候选会从新标注活动和冻结发布入口排除；Guest 没有轨迹，因此无法被提名。

### M9C 已补齐

- 标注者声明四级变换类型，服务端按文本与结构差异计算指标并阻止夸大；
- 生产原回答和轻微润色仅供监测，实质纠正/人工重写才可能进入 SFT；
- 工作量审核与匿名仲裁都阻止用户处理自己参与修订的样本；
- 冻结版本 schema v3 同时生成 canonical clean、资格过滤后的 training 和 chosen/rejected preference；
- 训练登记绑定父模型，并按当前授权、候选状态、泄漏和人工修正重新计算资格。

### M9D 已补齐

- 评测标签自动关联稳定模型版本，候选模型聚合全部相关评测；
- 门禁要求训练血缘合格、总体不退化、五种风格分别有结果且不退化；
- 只有 `ELIGIBLE` 模型能够按 10% → 30% → 100% 顺序晋级；
- 新会话稳定分桶并固化模型版本，普通灰度不会让对话中途换模型；
- 部署使用注册模型的 provider/externalModelId 执行正式调用；
- 回滚恢复上一生产模型，并让仍绑定故障模型的会话切回安全基线。

### 后续仍需补齐

- 没有 SFT/偏好数据资格策略；
- 训练登记没有父模型和策略检查；
- 评测结果没有关联稳定模型版本，也不能控制部署晋级；
- 没有模型部署、灰度和回滚记录。

## 3. 关键设计决策

### D1：自动风格必须在会话创建时解析并冻结

教师可选择具体风格或 `auto`。`auto` 在创建学生会话时通过稳定哈希解析为一个具体风格，并写入 `Conversation.resolvedStyleFamily`；同一会话中不随轮次漂移。

初版自动策略为 `balanced-static-v1`，按 `assignmentId + studentId` 在启用风格中稳定分桶。后续若增加动态适配，必须新建策略版本，不能改变已有会话。

### D2：双标的是同一个目标，不是两个不同风格

活动启动时先为样本分配一个目标风格，然后该样本的所有独立标注槽位共享这个风格。复审者看不到作者和来源模型，但必须看到目标风格和对应规范，才能判断风格是否达标。

如果确实需要把同一内容改写成多种风格，应创建多个带不同目标风格的样本变体，而不是把它们作为同一 ReviewCase 的竞争版本。

### D3：线上生成轨迹追加写入，不能依赖现有消息 JSON 反推

每次正式聊天成功时，在保存展示消息的同一事务中创建一条不可变 `GenerationTrace`。它保存完整结构化响应和来源指纹。旧会话没有这些信息，只标记为 `LEGACY_UNVERIFIED`，默认不具备训练资格。

### D4：生产原回答永不直接成为 SFT 正样本

生产候选必须经过人工实质纠正、工作量审核和最终仲裁。初版采用保守策略：

- `NO_CHANGE`：只用于监测统计，不进入生产回流 SFT；
- `LIGHT_EDIT`：可形成分析记录，默认不进入 SFT；
- `MATERIAL_CORRECTION`：复核通过后可进入 SFT，并与原回答组成偏好对；
- `HUMAN_REWRITE`：复核通过后可进入 SFT，并与原回答组成偏好对；
- `REJECTED`：不进入训练。

人工选择类型只是一项证据；服务端还要计算结构差异和文本差异，异常时要求复审者确认，防止通过随意改字绕过策略。

### D5：Data Lab 只接收脱敏快照，不直接读取生产会话

生产会话保留在教学域。候选转换时生成不可变、脱敏的 ShareGPT 快照并导入 `sourceType=production_trace` 的批次。标注者和复审者只访问快照，不获得学生账号、班级、附件路径、来源模型或原会话链接。

### D6：冻结版本是训练唯一入口

训练登记只能选择冻结版本。创建训练任务前执行纯函数资格检查，输出不可变策略报告；存在阻断项时禁止登记为 `SUBMITTED` 或 `RUNNING`。

## 4. 风格协议

### 4.1 稳定标识

沿用：

- `socratic_concise`；
- `warm_companion`；
- `engineering_mentor`；
- `evidence_analyst`；
- `classroom_coach`。

增加 `auto` 仅作为作业配置值，不作为训练样本目标值。

### 4.2 版本化规范

新增 `app/lib/stylePolicy.ts`，导出：

```ts
interface StylePolicy {
  family: StyleFamily;
  version: string;
  label: string;
  summary: string;
  systemInstruction: string;
  annotationRubric: string[];
  forbiddenPatterns: string[];
}
```

初版统一使用 `style-v1`。任何会改变训练或输出行为的文字修改都必须升级版本，旧版本仍可查询和复现。

### 4.3 训练与推理一致

- 在线：`getPromptForPhase()` 接收已解析风格和规范版本，把 `systemInstruction` 注入阶段提示词；
- 标注：页面展示目标风格的摘要、评分标准和禁止行为；
- 修订：保存 `styleFamily`、`stylePolicyVersion`；
- 发布：canonical record 的 metadata 保存风格；训练适配器把相同版本的风格指令转成模型可见的 system 内容；
- 评测：按风格分别汇总质量、安全、结构和风格遵循结果。

不能只把风格存在 metadata 中然后交给训练平台忽略。每个训练导出 profile 必须证明风格指令进入了模型输入。

## 5. 数据模型变更

以下是字段级设计；实际迁移按第 11 节拆分。

### 5.1 现有模型新增字段

#### Assignment

- `assistantStyleFamily String @default("auto")`；
- `stylePolicyVersion String @default("style-v1")`；
- `dataContributionMode String @default("DISABLED")`：`DISABLED | CONSENT_REQUIRED`；
- `dataPolicyVersion String?`。

#### StudentAssignment

- `dataConsentStatus String @default("NOT_APPLICABLE")`：`NOT_APPLICABLE | PENDING | GRANTED | DECLINED | WITHDRAWN`；
- `dataConsentPolicyVersion String?`；
- `dataConsentDecidedAt DateTime?`。

#### Conversation

- `resolvedStyleFamily String @default("classroom_coach")`；
- `stylePolicyVersion String @default("style-v1")`；
- `traceCoverage String @default("LEGACY_UNVERIFIED")`：新会话为 `COMPLETE`。

#### AnnotationCampaign

- `styleAssignmentMode String @default("WEIGHTED_BY_SAMPLE")`：生产回流批次默认 `PRESERVE_SOURCE`。

#### AnnotationRevision

- `styleFamily String?`；
- `stylePolicyVersion String?`；
- `transformationType String @default("UNCLASSIFIED")`；
- `transformationMetricsJson String @default("{}")`。

#### DatasetRelease

- `preferencePath String?`、`preferenceSha256 String?`；
- `eligibilityReportJson String @default("{}")`。

#### DatasetReleaseItem

- `styleFamily String?`；
- `stylePolicyVersion String?`；
- `trainingEligibility String @default("SFT_ALLOWED")`；
- `eligibilityReasonJson String @default("[]")`。

#### TrainingRun

- `parentModelVersionId String?`；
- `eligibilityReportJson String @default("{}")`；
- `policyVersion String @default("training-policy-v1")`。

#### EvaluationRun

- `modelAVersionId String?`、`modelBVersionId String?`；
- `gateResult String @default("NOT_EVALUATED")`；
- `gateReportJson String @default("{}")`。

### 5.2 新模型

#### ModelVersion

记录稳定模型身份，而不是依赖可变的 `.env` 字符串：

- `id`、唯一 `tag`、`provider`、`externalModelId`；
- `parentModelVersionId?`；
- `trainingRunId?`；
- `promptPolicyVersion`、`contractVersion`；
- `status`：`DRAFT | TRAINED | EVALUATED | ELIGIBLE | DEPLOYED | RETIRED | BLOCKED`；
- 创建人和时间。

#### ModelDeployment

- `modelVersionId`、`previousModelVersionId?`；
- `environment`：初版只允许 `PRODUCTION`；
- `rolloutPercent`：0—100；
- `status`：`DRAFT | ACTIVE | PAUSED | ROLLED_BACK | COMPLETED`；
- `evaluationRunId?`、`startedAt`、`endedAt`、创建人；
- 同一环境最多一个 `ACTIVE` 部署记录。

#### GenerationTrace

- `conversationId`、唯一 `assistantMessageId`、`userMessageId`；
- `stage`、`modelVersionId`、模型标签快照；
- `promptVersion`、`promptSha256`；
- `styleFamily`、`stylePolicyVersion`；
- `requestMessageSha256`、`responseJson`、`responseSha256`；
- `generationParamsJson`、`contractVersion`、`contractCheckJson`；
- `createdAt`。

不保存 API Key，也不在审计 payload 中写入完整学生内容。

#### ProductionCandidate

- 唯一 `generationTraceId`；
- `status`：见第 6 节；
- `triggerType`：`TEACHER_NOMINATION | CONTRACT_ALERT | SAFETY_ALERT | ADMIN_SAMPLE`；
- `triggerNote`、`signalJson`；
- 授权状态及政策版本快照；
- `redactedRecordJson`、`redactionReportJson`；
- `contentSha256`、`familyKey`、`leakageCheckJson`；
- `nominatedById?`、`processedById?`、`rejectionReason`；
- `convertedSampleId?`；
- 创建和更新时间。

生产候选只关联一轮导师响应，但脱敏快照可以包含满足当前判断所需的有限前序上下文。

## 6. 生产候选状态机

```text
FLAGGED
  ├─ 未授权 → CONSENT_BLOCKED
  └─ 已授权 → REDACTION_PENDING
                  → REDACTION_REVIEW
                  → ELIGIBLE
                  → CONVERTED

任意未冻结状态 → REJECTED
已授权状态 → WITHDRAWN（按撤回政策处理）
```

允许的迁移：

| 当前状态 | 操作人 | 下一状态 | 条件 |
|---|---|---|---|
| FLAGGED | 系统 | CONSENT_BLOCKED | 未授权或已拒绝 |
| FLAGGED | 系统 | REDACTION_PENDING | 授权有效 |
| REDACTION_PENDING | 系统 | REDACTION_REVIEW | 完成本地规则脱敏与附件剥离 |
| REDACTION_REVIEW | 管理员 | ELIGIBLE | 人工确认无身份信息且无评测泄漏 |
| REDACTION_REVIEW | 管理员 | REJECTED | 无法安全脱敏或无改进价值 |
| ELIGIBLE | 管理员 | CONVERTED | 转入不可变生产回流批次成功 |
| 非冻结状态 | 授权主体/管理员 | WITHDRAWN | 授权撤回 |

状态迁移必须由单一服务函数完成并写审计日志，API 不直接更新状态字符串。

## 7. 训练资格策略

新增纯函数 `evaluateTrainingEligibility()`，输入来源、模型血缘、授权、泄漏检查、人工变换和审核结果，输出：

```ts
type TrainingEligibility =
  | 'SFT_ALLOWED'
  | 'PREFERENCE_ALLOWED'
  | 'MONITORING_ONLY'
  | 'BLOCKED';
```

### 初版规则

1. 授权无效、未脱敏、附件残留、评测集命中：`BLOCKED`。
2. 生产原回答或 `NO_CHANGE`：`MONITORING_ONLY`。
3. `LIGHT_EDIT`：默认 `MONITORING_ONLY`；可作为人工分析证据，不进入训练。
4. `MATERIAL_CORRECTION/HUMAN_REWRITE` + 工作量通过 + 仲裁选中：`SFT_ALLOWED`。
5. 第 4 条同时保留原回答时：原回答为 rejected，修订回答为 chosen，`PREFERENCE_ALLOWED`。
6. 无法确定来源模型或提示词版本的历史线上数据：`BLOCKED`。
7. 外部人工构造/蒸馏数据沿用现有规则，但必须保留来源并经过当前结构验证。
8. 目标父模型与来源模型存在祖先关系本身不禁止人工纠正样本；未经人工实质变换则始终禁止。

发布 manifest 写入每条资格和理由。训练任务创建时重新按目标父模型计算，不能只信任发布时结果。

## 8. 权限与职责

不新增登录身份，先复用现有五种角色；“模型工程人员”和“评测人员”由 admin 承担，但审计中使用不同操作类型。

| 操作 | student | teacher | annotator | reviewer | admin |
|---|---:|---:|---:|---:|---:|
| 选择本人数据授权 | 是 | 否 | 否 | 否 | 仅政策性处理 |
| 选择作业导师风格/回流模式 | 否 | 本班作业 | 否 | 否 | 否 |
| 提名线上问题轮次 | 否 | 本班会话 | 否 | 否 | 任意合规会话 |
| 查看未脱敏原会话 | 本人 | 本班 | 否 | 否 | 默认否；紧急查看需审计 |
| 审核脱敏候选并转换批次 | 否 | 否 | 否 | 否 | 是 |
| 修订候选 | 否 | 否 | 分配到本人 | 否 | 不建议兼任 |
| 工作量审核 | 否 | 否 | 否 | 否 | 是 |
| 匿名仲裁 | 否 | 否 | 否 | 是 | 可兼任但应避免同条自审 |
| 冻结版本/登记训练/部署 | 否 | 否 | 否 | 否 | 是 |

平台必须阻止同一用户对自己的标注执行工作量审核或最终仲裁，即使其角色后来被改成管理员或复审者。

## 9. 页面设计

### 教师发布作业

在现有表单增加：

- “AI 导师回复风格”：自动适配 + 五种固定风格，显示简短说明；
- “是否允许提名脱敏对话用于模型改进”：默认关闭；开启后显示数据政策说明，学生仍需确认。

### 学生端

- 首次开始允许回流的作业时显示简短授权卡；拒绝不影响完成作业；
- 工作区显示当前导师风格；
- 提供撤回入口。撤回不会删除教学记录，但阻止其进入未来训练版本；已训练模型无法通过技术手段“反训练”，必须在说明中明确。

### 教师审核页

- 每个导师轮次增加“提名为模型改进候选”；
- 填写问题类型和说明；
- 不提供“直接加入训练集”按钮。

### Data Lab：线上候选

新增 `/data-lab/candidates`：

- 状态、阶段、目标风格、触发原因、来源模型标签；
- 默认只显示脱敏内容；
- 脱敏报告、授权状态、重复/泄漏检查；
- 通过、拒绝、转换为生产回流批次；
- 所有敏感内容查看操作写审计。

### 标注与仲裁

- 标注页展示目标风格的可执行规范；
- 提交时选择变换类型并填写理由；
- 仲裁页显示目标风格，但继续隐藏作者、来源模型和候选等级；
- 生产回流样本必须判断“是否发生实质人工修正”。

### 模型与部署

新增高级管理页面：

- `/data-lab/models`：模型版本、父版本、训练数据和资格状态；
- `/data-lab/deployments`：评测门禁、灰度比例、当前部署和回滚目标。

## 10. API 与服务边界

### 教学域 API

- `POST /api/assignments`：增加风格和回流模式；
- `POST /api/student/assignments/[id]/data-consent`：授权、拒绝、撤回；
- `POST /api/teacher/review/[studentAssignmentId]/candidates`：按 `assistantMessageId` 提名；
- 正式 chat route：读取会话固化风格，并在同一事务创建 `GenerationTrace`。

### Data Lab API

- `GET /api/data-lab/candidates?status=`；
- `POST /api/data-lab/candidates/[id]/redact`：重跑本地脱敏；
- `POST /api/data-lab/candidates/[id]/review`：通过或拒绝；
- `POST /api/data-lab/candidates/convert`：批量转换为不可变批次；
- `POST /api/data-lab/models`；
- `POST /api/data-lab/training-runs`：增加父模型和资格校验；
- `POST /api/data-lab/deployments`、`POST /api/data-lab/deployments/[id]/rollback`。

所有动态 Route Handler 继续使用 Next.js 16 `RouteContext<...>` 并 `await ctx.params`。

### 服务模块

- `app/lib/stylePolicy.ts`：风格解析、注入和标注规范；
- `app/lib/modelRegistry.ts`：模型版本、当前部署和父子血缘；
- `app/lib/generationTrace.ts`：不可变生成记录；
- `app/lib/productionCandidates.ts`：提名、状态迁移、转换；
- `app/lib/redaction.ts`：本地确定性脱敏；
- `app/lib/datasetLeakage.ts`：精确、familyKey 和近重复检测；
- `app/lib/trainingEligibility.ts`：纯函数资格策略；
- Data Lab service 继续承载标注、仲裁、冻结业务，但调用上述策略模块。

## 11. 迁移与上线顺序

### Migration A：风格与模型基础

- 添加 Assignment/Conversation 风格字段；
- 添加 `ModelVersion`、`ModelDeployment`、`GenerationTrace`；
- 现有作业回填 `auto`，现有会话回填 `classroom_coach + LEGACY_UNVERIFIED`；
- 创建当前环境模型的基线 `ModelVersion`，不读取或写入 API Key。

### Migration B：生产候选与授权

- 添加 StudentAssignment 授权字段和 `ProductionCandidate`；
- 所有现有作业回流模式为 `DISABLED`；
- 不自动扫描或导入历史会话。

### Migration C：修订、发布和训练资格

- 添加 AnnotationRevision、Release、ReleaseItem 和 TrainingRun 字段；
- 旧冻结版本标记 `policyVersion=legacy`，继续可下载，但不能被误标为通过新策略；
- 新版本开始生成 preference 文件和资格报告。

### Migration D：评测门禁与部署

- 评测关联模型版本；
- 部署功能初始由 `ENABLE_MODEL_DEPLOYMENT=false` 关闭；
- 先运行只读门禁报告，再开启灰度操作。

每次迁移前由启动器执行备份。启动器需要新增“安全升级数据库”：先备份，再 `npm run db:migrate`，失败时保留备份并停止启动。

## 12. 脱敏、授权与保留策略

- 回流默认关闭，拒绝授权不影响正常学习；
- 脱敏优先使用本地确定性规则，不把未脱敏学生内容发送给第三方模型；
- 剔除用户名、显示名、班级名、手机号、邮箱、身份证模式、精确地址及附件 URL；
- 图片、Word 和其他附件默认完全排除，只保留“曾有附件”的非内容标记；
- Data Lab 只保存脱敏快照，原始教学会话继续受原有教师/学生权限保护；
- 候选未冻结前撤回：进入 `WITHDRAWN`，不得转换；
- 已冻结后撤回：加入后续版本排除清单并阻止新训练任务使用；界面必须说明已完成训练无法直接撤销模型参数影响；
- 审计日志不写完整对话、密码、API Key 或附件内容。

## 13. 评测门禁与部署规则

一个 ModelVersion 晋级 `ELIGIBLE` 至少满足：

- 结构契约错误率不高于当前生产基线；
- 六阶段推进和教师审核回归测试全部通过；
- 安全回归无阻断项；
- 双盲总体结果达到预设阈值；
- 五种风格分别达到最低遵循阈值，不能只看总体平均；
- 训练集与评测集泄漏检查通过；
- 训练资格报告无 `BLOCKED` 条目。

部署顺序固定为：`DRAFT → 10% → 30% → 100%`。每次提升都创建新记录或审计事件，并保留 `previousModelVersionId`。任何阻断指标触发时可以一键回滚到上一 ACTIVE 版本。

初版不做学生级随机 A/B；灰度按服务器稳定分桶，并确保同一会话始终使用同一模型版本，避免对话中途切换模型。

## 14. 测试矩阵

### 纯函数测试

- `resolveStyleFamily()`：稳定、均衡、版本不漂移；
- `buildStyleInstruction()`：五种风格和版本；
- `candidateTransition()`：所有允许/禁止状态迁移；
- `redactProductionRecord()`：身份信息和附件剥离；
- `detectDatasetLeakage()`：精确、familyKey、近重复；
- `evaluateTrainingEligibility()`：自产出、人工纠正、授权、血缘和泄漏组合；
- `deploymentGate()`：总体及分风格门槛。

### 数据库闭环测试

- 作业固定风格/auto 创建会话并固化；
- chat 成功时消息、stageData 和 GenerationTrace 原子写入；失败时三者均不写；
- 未授权候选不能脱敏或转换；
- 标注者看不到原身份和来源模型；
- 同一用户不能审核/仲裁自己的修订；
- 双标槽位共享目标风格；
- production `NO_CHANGE` 无法进入 SFT；
- material correction 可生成 SFT 和 chosen/rejected 对；
- 训练父模型改变后资格重新计算；
- 未通过门禁无法部署，回滚恢复上一模型。

### 浏览器验收

- 教师发布固定/自动风格作业；
- 学生授权和拒绝均不影响作业流程；
- 教师按具体轮次提名；
- 管理员审核脱敏候选并转换批次；
- 标注、工作量审核、仲裁、冻结、下载 preference；
- 登记训练、导入分风格评测、灰度部署和回滚；
- 手机端授权卡、风格提示和标注规范无横向溢出。

## 15. 分批开发计划

### M9A1：风格协议与在线消费

- [x] 风格规范、作业选择、会话固化、提示词注入；
- [x] 修正双标槽位风格一致性；
- [x] 标注与仲裁展示共同目标风格规范；
- [x] UI、纯函数、数据库持久化和现有闭环回归测试。

### M9A2：风格进入数据和评测

- [x] 修订/发布/manifest 固化风格字段与实际入选分布；
- [x] 生成独立 `training` profile，以首条 system 消息写入版本化风格指令，同时保留 canonical `clean`；
- [x] 采集和裁判产物记录目标风格，禁止混合不同风格比较，后台按风格汇总；
- [x] 为历史冻结版本保留原下载能力，但不伪造缺失的风格训练导出；
- [x] Prisma 迁移、纯函数、数据库闭环、Data Lab 全套回归、lint 和生产构建通过（2026-07-13）。

### M9B1：模型注册与生成轨迹

- [x] ModelVersion、ModelDeployment 基础表和管理员只读血缘页；
- [x] 启动器幂等登记当前运行模型与生产部署基线；
- [x] 每轮 GenerationTrace 与消息、stageData、阶段推进原子写入；
- [x] 新会话 `COMPLETE`、历史会话 `LEGACY_UNVERIFIED` 隔离策略；
- [x] 隐私、唯一性、事务回滚、完整回归和真实 DeepSeek 路由验收。

### M9B2：授权、脱敏与候选页

- [x] 作业回流选项、学生授权/拒绝/撤回、教师按生成轨迹提名；
- [x] 本地确定性脱敏、精确与近重复检查、管理员候选页；
- [x] 转换为不可变 `production_trace` 隔离批次并保留候选—样本追溯；
- [x] 撤回后阻断新活动和冻结发布，Guest 技术上无法提名；
- [x] 纯函数、数据库闭环、全套回归、lint 和生产构建通过。

### M9C：人工纠正与训练资格

- [x] transformationType、服务端差异指标和同人自审/仲裁限制；
- [x] canonical、SFT training、chosen/rejected preference 三类导出；
- [x] 发布项资格及理由、版本资格报告；
- [x] 训练登记绑定父模型并重新计算资格；
- [x] 纯函数、数据库闭环、111 项 Data Lab 回归、lint 和生产构建通过。

### M9D：评测门禁、灰度与回滚

- [x] 模型版本评测关联和候选模型聚合；
- [x] 训练血缘、总体结果和五风格独立门禁报告；
- [x] 10% → 30% → 100% 顺序灰度、稳定分桶和会话黏性；
- [x] 部署模型实际进入正式 LLM provider 调用；
- [x] 一键回滚、故障会话切回基线和全量审计；
- [x] 126 项 Data Lab 回归、会话安全、真实路由、lint 和生产构建通过。

每个子阶段独立迁移、独立测试、可以单独回滚。不得在同一次迁移中同时上线生产候选回流和自动部署。

## 16. 完成定义

只有同时满足以下条件，才能声明平台闭环完成：

- 教师选择的风格能追溯到在线提示词、标注修订、训练输入和分风格评测；
- 每条新正式模型回答都有完整且不可变的生成轨迹；
- 未授权、未脱敏、历史不可验证、评测泄漏和未经人工实质纠正的数据在技术上无法进入 SFT；
- 原回答与人工纠正回答可以导出为有血缘的偏好对；
- 训练任务明确父模型、冻结数据版本、资格报告和输出模型；
- 未通过评测门禁的模型无法部署；
- 部署可以灰度、保持会话黏性并回滚；
- 任意模型输出都可追溯至模型版本、提示词版本和训练数据，任意训练样本都可追溯至来源、授权、人工纠正与仲裁。
