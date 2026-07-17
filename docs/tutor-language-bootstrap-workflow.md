# Tutor Language 启动数据工作流

## 数据单元

每条训练数据是一个 `TutorTurnCase` 状态快照和一个 `TutorLanguageResponse`：

```json
{"dialogue":"...","interactionType":"clarification","focus":"measurement","hints":[]}
```

确认书、实验表、安全题、分析进度和报告框架由服务器生成，不进入 Tutor SFT target。

## Prompt 版本

- 正式教学 Tutor 当前继续使用 `tutor-language-prompt-v1`。
- Smoke 历史案例保留 `tutor-language-prompt-v2`；Data Lab 新编译案例使用 `tutor-language-prompt-v2.1`，明确禁止“A 还是 B”式答案菜单，并区分“复述学生已有多个条件”和“导师新列多个选项”。先通过 Calibration/Trial 后再单独提升生产版本。
- Prompt 快照、版本和 SHA-256 随案例保存；禁止用同一版本名覆盖规则变化。
- v1 校准 run 只保留为回归证据，标记 `MONITORING_ONLY`，不得进入 Release。

## 长豆芽 Behavior Demo

`app/lib/dataLab/bootstrap/demo.ts` 保存六阶段行为切片、针对性坏例和跨阶段规范。它不是事实模板；团队人工确认前 `humanApproval` 保持 `PENDING`。禁止复制豆芽事实、固定句式、固定表扬、固定轮数和确认台词。

## 管理流程

1. 管理员创建或双模型编译 TopicCard。也可以用「一键生成」让平台默认模型原创话题卡草稿（`POST /api/data-lab/topic-cards/generate`）：可选主题方向、活动模式和情境模块，服务端注入近 80 张已有卡片标题避免重复，产物固定为 `internalArchetype=ai_ideation_v1`、`source.kind=AI_IDEATION` 的 V2 DRAFT，仍走同一套结构校验、Critic 审查和人工批准，未通过校验的直接落为 REJECTED 供参考。
2. 管理员批准 TopicCard；未批准卡不能生成案例。
3. 先生成 Prompt v2 的 Smoke 6：P1/P2/P4 各 2 条。
4. 每个案例使用两个不同模型家族独立生成；随后 A 批评 B、B 批评 A。
5. A/B 一经生成立即保存；Critic 失败时使用“仅重试 Critic”，不得重复付费生成 A/B。
6. Annotator 首次审核：选择、合并、编辑、重新生成、转 regression/negative 或拒绝，并填写理由。
7. Reviewer 在模型身份隐藏的界面独立确认；不能确认自己编辑的案例。每条自动 warning 必须分别记录三个维度：检查是否成立、与最终草稿的关系、问题严重程度。一个 warning 可以同时是“判断成立 + 较轻 + 只在未采用候选”。任一维度未填写时不能确认；若严重问题仍在最终稿中则必须退回或拒绝。历史 boolean/单选 closure 只读兼容，不覆盖。
8. Smoke 通过后先创建定向 `CALIBRATION_12`，复测 warning closure、Critic 误报、答案菜单和相邻 challenge；Calibration 通过后才能创建 36 案例试验。未通过时创建新 run，不覆盖历史。
9. `FinalizedTutorTurn` 通过资格检查后才可进入数据版本。Preference 只有明确 chosen/rejected、两者均无硬错误且有人工比较理由时才导出。

## Smoke 6 门槛

- 6/6 完成双审且直接确认；
- 硬错误、内部泄漏、无来源具体事实为 0；
- 至少 4/6 为 `NO_CHANGE` 或 `LIGHT_EDIT`；
- `MATERIAL_CORRECTION` 不超过 2 条；
- exact duplicate 为 0，近重复率和模板化重复率均低于 10%。

## Calibration 12 门槛

- 固定覆盖 P1/P2/P4 各 4 条，并包含 Smoke 暴露出的控制变量解释、测量答案菜单、因果判断和异常数据场景；
- 12/12 完成双审，直接确认率 ≥90%；允许少量有价值的退回修订，不因一次退回永久判死整个 run；
- 硬错误、内部泄漏为 0；`NO_CHANGE/LIGHT_EDIT` ≥75%；`MATERIAL_CORRECTION` ≤3；
- warning 必须全部使用结构化结论，不允许继续写入新的 boolean closure；
- 确定性 warning 的 `误报/部分成立` 作为规则校准信号记录，不再用单一数量直接阻断；Critic 误报不超过 1 条，且 Critic warning 达到 4 条以上时误报率不得超过 25%；
- exact duplicate 为 0，近重复率和模板化重复率均低于 10%。

## 36 → 180 门槛

`/api/data-lab/bootstrap-runs/trial-quality` 只统计最新或指定的 `TRIAL_36` run：硬错误/内部泄漏为 0，NO_CHANGE/LIGHT_EDIT ≥75%，直接确认率 ≥85%，exact duplicate 为 0，三字符 shingle Jaccard ≥0.82 的近重复率 <10%，模板化重复率 <10%。团队仍须逐条复盘主题漂移和伪学生表达。

PILOT 一律为 `MONITORING_ONLY`，不能创建 Release。只有 36 条试验通过自动指标并完成人工签署后，才可生成 `FULL_180 / TRAIN`。

## 部分失败状态

- `NEEDS_REGEN`：Tutor A 或 B 未成功生成，需要重新生成完整 A/B attempt。
- `NEEDS_CRITIC`：A/B 已保存，但至少一个 Critic 失败；只重试 Critic。
- `PARTIAL_FAILED` run 保留成功产物、token、错误阶段和重试审计，不进入审核队列。

## 历史流程

旧 DatasetBatch、AnnotationCampaign、五风格标注和仲裁只保留读取、导出和审计。创建/启动 API 返回 HTTP 410。授权生产候选改为转换成 `TutorTurnCase(source=PRODUCTION_TRACE)`。

## 2026-07-16：Annotator 初审 + 正式 Human Reviewer

新批次不再使用“一审/二审”语义：

1. 管理员批准 TopicCard、创建案例批次，并选择 `HUMAN_ANNOTATOR_REQUIRED` 或逐批显式授权的 `AI_DIRECT_TO_REVIEWER`。
2. Annotator 负责 Tutor A/B 选稿、合并、完整结构化编辑和 preference 理由。Full 默认每条必须由人类 Annotator 提交。
3. Reviewer 是正式人工质量门，可修改 `dialogue`、`interactionType`、`focus`、`hints` 后直接定稿。
4. `RETURN_TUTOR` 回 Annotator；`RETURN_CASE` 进入管理员学生案例质量队列。
5. 管理员批准学生问题修改时创建新 case revision，旧 A/B 和审核任务不会被复用。
6. 自动 warning 只作为机器信号。Reviewer 可以纠正类别；与最终稿的关系由服务端根据选稿和最终输出计算。
7. Release 导出记录 `draftProvenance` 和 Reviewer edit metrics；SFT target 仍只包含 `TutorLanguageResponse`。

## TopicCard V2 工程探究兼容层

从 2026-07-16 起，新 TopicCard 默认使用 V2。TutorLanguageResponse 和学生端六阶段合同没有改变；Bootstrap Case 编译器把工程语义映射为现有内层证据合同：

- 设计参数 → independent variable；
- 性能指标 → dependent variable；
- 固定测试条件 → controlled variables；
- 设计预测 → hypothesis；
- P6 → 下一版设计证据选择。

V1 Case 保持旧逻辑以便历史回放。Full 180 只接受 V2，Trial/Calibration 对 V1 仅提示。
