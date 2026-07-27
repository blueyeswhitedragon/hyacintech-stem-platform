# 外部微调模型上线实操清单（BaseURL + API Key → 学生端/教师端）

适用场景：模型在外部算力平台微调完成，本平台只拿到 **BaseURL + API Key + 远程模型名**，
没有本平台的 TrainingRun。目标是从注册走到 100% 上线，全程不依赖任何数据库直改。

全程需要 `admin` 角色。每一步都写了失败时的**中文报错原文**与处理办法。

## 0. 前置

- `.env` 中 `ENABLE_MODEL_DEPLOYMENT` 不得为 `false`，否则第 9 步报「模型部署功能已被环境开关关闭」。
- 若打算把 Key 存进数据库（`ENCRYPTED_DB`），必须先配 `DATA_LAB_CREDENTIAL_MASTER_KEY`；
  用 ENV 引用方式则不需要。
- 网关地址容易踩坑：部分转换网关的真实路径是 `/v1/v1`。连接测试失败先核对这一点。

## 1. 登记 AI 服务连接（`/data-lab/ai-services`）

填 BaseURL 与凭据来源。保存后点「测试连接」。

- 报「连接测试失败」且提示模型不存在：此时还没有 Endpoint，测试会退回网关返回的第一个模型。
  先做第 2 步再回来重测。
- 报超时：把 `LLM_TIMEOUT_MS` 调大（外部微调网关首字延迟常超默认值），重启服务后重测。

## 2. 登记 Endpoint（同页）

Endpoint 决定**实际请求地址、密钥与远程模型名**。远程模型名必须与外部平台一致，
大小写和后缀都不能改。登记完再点一次连接测试，这次会探测该 Endpoint 的真实模型。

## 3. 登记模型版本（`/data-lab/models` → 登记基础模型）

- **产物类型选「外部产物（外部平台微调）」（`EXTERNAL`）。**
- **必须填 Checkpoint ID 或 64 位权重 SHA-256**（`/^[a-f0-9]{64}$/`）。这是
  `verificationStatus = VERIFIED_IDENTITY` 的唯一来源。
- 只填 tag 不填身份 → 状态为「历史待核验」，第 9 步门禁永远不 PASS。

`EXTERNAL` 与 `BASE` 同区显示、同规则判定训练血缘：平台不为外部训练过程背书，只核验权重身份，
因此**不需要**本平台 TrainingRun。

## 4. 关联 Endpoint（`/data-lab/ai-services`）

把第 2 步的 Endpoint 挂到第 3 步的模型上。模型卡片「服务 Endpoint」显示「尚未关联」时不能建组合。

## 5. 建 `FORMAL_TUTOR` 运行组合（`/data-lab/runtime-bundles`）

组合 = 模型 + Endpoint + PromptPolicyVersion + 三个合同版本。用途选 `FORMAL_TUTOR`
（`DATA_LAB_CANDIDATE_A/B` 只用于案例生成，不能上线学生端）。

> **归因提醒：** 组合同时携带模型与 Prompt。直接部署「新模型 + v2.3」会让模型效果与 Prompt 效果
> 不可分。推荐次序是先部署「现模型 + v2.3」拿到基线，再只换模型。
> `runtimeBundleChangeSummary()` 会把变更标成 `MODEL_ONLY / PROMPT_ONLY / MODEL_AND_PROMPT`，
> 部署页可直接看到本次改了哪一个变量。

## 6. 兼容性评测（`/data-lab/runtime-bundles`）

组合卡片上点「开始兼容性评测」（状态为「待兼容性评测」或「不兼容」时才会出现），必须 `PASS`。

- 失败通常是远程模型不支持 `response_format: json_object`，或返回 Markdown 围栏包裹的 JSON。
  先用 `npx tsx scripts/probe-json-schema.ts` 确认网关能力。
- 组合状态非 `AVAILABLE`/`DEPLOYED` 时，第 9 步的 `compatibilityReady` 为假，门禁不 PASS。

## 7. 采集离线 A/B transcript

```
npx tsx scripts/blind-eval.ts collect --tag "<组合名>:v<版本号>" --stages coverage --prompt-version <组合冻结的 Prompt 版本>
```

`--stages coverage` 会按 `expectedCoverageCells()` 的 **16 格**逐格产出回合，
含 `STAGE_TRANSITION`(P2/P4)、`STAGE_ENTER`(P3)、`REPORT_BOOTSTRAP`(P5) —— 这些格旧的 persona
路径根本产不出来。A、B 各跑一次（基线一次、候选一次）。

结束时脚本会自检并打印：

- `结构覆盖：16 格齐全（门禁按 phase/triggerType/focus 判定）` → 可以进下一步。
- `警告：仍缺 N 个结构覆盖格，部署门禁会判 INSUFFICIENT：` → **不要**继续判定，
  否则白跑一轮裁判。按打印出的 `P{阶段} / {触发类型} / {focus}` 清单排查。

## 8. 裁判并导入（`/data-lab/evaluations`）

```
npx tsx scripts/blind-eval.ts judge "<基线组合名>:v<版本号>" "<候选组合名>:v<版本号>"
```

verdict 的 `summary` 必须含 `phase`、`trigger`、`focus` 三组桶，每桶带
`A / B / tie / inconsistent / criticalErrors` 与 A/B 解析计数。导入后确认
`artifactValidation.complete === true`。

- 报 `TRIGGER_SUMMARY_INCOMPLETE` / `FOCUS_SUMMARY_INCOMPLETE`：verdict 是旧版脚本产的，重跑 judge。
- 报「评测产物中的 A/B 模型身份与两份 transcript 或已冻结运行组合不一致」：
  transcript tag 必须等于 `${组合名}:v${版本号}`，混用批次会直接被拒。

## 9. 刷新部署门禁（`/data-lab/evaluations`）

导入产物后，在同一页的部署控制区选中该组合并刷新门禁，目标是 `PASS`。
评测记录卡片里的「查看部署门禁结论」会把失败项分成「产物不完整」与「质量未达标」两栏。

- `INSUFFICIENT` + `TRIGGER_MISSING:` / `FOCUS_MISSING:` / `PHASE_MISSING:`：缺格，回第 7 步。
  门禁对缺格**只会**给 `INSUFFICIENT`，不存在旁路开关。
- `INSUFFICIENT` 且 `trainingReady` 为假：模型身份没核验（回第 3 步补 checkpoint/SHA-256），
  或兼容性评测不是 `PASS`（回第 6 步）。
- `FAIL`：某一阶段候选退化，或存在 critical 违规。看门禁报告里的阶段明细。

## 10. 灰度 10% → 30% → 100%

只有 `ELIGIBLE` 模型能部署。新会话按稳定哈希分桶，
`resolveConversationModel()` 首次调用时把模型与组合一起钉死，**已有会话永不静默切换**。

灰度按钮、观察表单、暂停与回滚都在 `/data-lab/evaluations` 的部署控制区，**没有单独的部署页**。
观察窗口目前**手工填报**（8 个指标）：

| 阶段 | 最少时长 | 最少会话 |
|---|---|---|
| 10% | 48 小时 | 50 |
| 30% | 72 小时 | 150 |

回归红线，触任一条即回滚：

- 结构失败率比基线高 1 个百分点以上
- 教师驳回率比基线高 3 个百分点以上
- 提前终止率比基线高 3 个百分点以上
- 线上出现任一 critical（安全/越权/无依据断言）

未满足窗口就点 30%/100% 会被中文报错拦住，要求先补足观察窗口。回滚会新建一个 100% 基线部署，
并把仍钉在失败候选上的会话重新指向基线。
