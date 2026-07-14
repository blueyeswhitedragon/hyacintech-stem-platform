# Dataset schema v3：重启蒸馏与导入操作手册

## 1. 边界

- 历史 489 条全部是 `LEGACY_QUARANTINED`，不能作为正向 SFT、不能创建新标注活动、不能冻结为训练发布。
- 可复用的是场景和问题类型，不复用旧导师答案。
- 新数据的学生模拟器、生产 Tutor 和质量评估器输入彼此分离；只有评估器能看到 `evaluatorOnly`。
- 模型评估通过只产生候选。最终 Gold 必须经过 Data Lab 人工标注、工作量审核和仲裁。

## 2. 部署前准备

先备份真实 SQLite 文件，再在项目目录执行：

```bash
npm ci
npm run db:deploy
npm run db:seed
npm run data-lab:init
```

`data-lab:init` 只维护管理员账户，不会再自动导入 489 条旧数据。

## 3. 构造 30 条校准计划

```bash
npm run data-lab:build-v3-plan -- --target 30 --out data/sft/v3/plans/calibration-30.json --disposition-out data/sft/v3/legacy-489-disposition.json
npm run data-lab:validate-v3 -- --kind plan --file data/sft/v3/plans/calibration-30.json
npm run data-lab:distill-rollout -- --plan data/sft/v3/plans/calibration-30.json --run-id calibration-30 --limit 30 --dry-run
```

预期分布是每阶段 5 条、每风格 6 条。校验失败时不要调用模型。

## 4. 配置三种角色

Tutor 默认使用平台的 `LLM_PROVIDER` / `LLM_MODEL`。如需角色分离，可额外设置：

```env
TUTOR_LLM_PROVIDER=deepseek
TUTOR_LLM_MODEL=<导师模型>
STUDENT_LLM_PROVIDER=deepseek
STUDENT_LLM_MODEL=<学生模拟模型>
EVALUATOR_LLM_PROVIDER=openai
EVALUATOR_LLM_MODEL=<独立评估模型>
```

对应 Provider 的 API Key 仍使用已有 `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`。不要把密钥写入计划、候选或 manifest。若 Tutor 与 Evaluator 是同一 Provider + Model，输出会自动标为 `needs_review`，不能成为自动 gold candidate。

DeepSeek V4 Pro 保持思考模式。M10H0 推荐预算如下，避免思考链挤占最终 JSON：

```env
LLM_THINKING=enabled
LLM_REASONING_EFFORT=high
TUTOR_LLM_MAX_TOKENS=16000
TUTOR_LLM_TIMEOUT_MS=180000
STUDENT_LLM_MAX_TOKENS=10000
STUDENT_LLM_TIMEOUT_MS=180000
EVALUATOR_LLM_MAX_TOKENS=20000
EVALUATOR_LLM_TIMEOUT_MS=300000
```

脚本会保留 `finish_reason`、输出/思考字符数和 token usage 等非敏感诊断。JSON、空 content、截断和传输失败最多重试三次；重试不会关闭思考模式，也不会改用启发式文本抽取。DeepSeek JSON mode 若返回仅含空白的 `content`，下一次会移除 API 的 `response_format` 标志，但最终内容仍必须通过同一个严格 JSON 解析器。

## 5. 生成与断点恢复

```bash
npm run data-lab:distill-rollout -- --plan data/sft/v3/plans/calibration-30.json --run-id calibration-30 --limit 30
```

输出位于 `data/sft/v3/runs/calibration-30/`：

- `candidates.json`：通过硬契约与评估器的候选；
- `rejected.json`：失败、拒绝及原因；
- `manifest.json`：角色模型身份、进度、阶段/风格/等级分布，不含密钥。

同一命令默认恢复：已写入 candidates/rejected 的 task 会跳过。需要重新开始时使用新的 `--run-id`，不要覆盖旧运行。

可用 `--phase 4`、`--styles evidence_analyst,classroom_coach`、`--offset`、`--limit` 缩小范围。

六阶段各抽一个苏格拉底格子的 M10H0 复验命令：

```bash
npm run data-lab:distill-rollout -- --plan data/sft/v3/plans/calibration-30-h0.json --run-id calibration-30-h0-r3 --styles socratic_concise --limit 6 --max-attempts 3
```

P2 学生模拟器通过 `fact_1...fact_n` 选择尚未确认的结构化事实，训练消息使用该 id 对应原文；最终表格由平台从完整方案生成。P5 六字段由平台从 StageData 生成。自动规则仅硬拦截无来源数字、无效事实引用、结构冲突和新增高风险对象；普通同义改写必须进入人工复核，不得用同义词枚举替代语义审核。

M10H1 进一步规定：问号数量、普通文本同义改写、可能的多任务负担、未知设备风险和风格表现只能产生 `warning`；只有可确定的来源、结构和状态机冲突产生 `error`。Data Lab 的只读预检、正式提交、工作量审核和匿名仲裁使用同一服务端校验链。黄色可以提交但必须双人人工复核，红色不能提交，绿色也不自动等于 Human Gold。

### M10H0 六格抽样记录（2026-07-14）

- P1/P3/P6：`calibration-30-h0-r3`；
- P2：`calibration-30-h0-r7-p2` 第一次记录经步骤序号误报修复后，以当前门禁复验为 0 error / 0 warning，Evaluator 通过；旧运行文件保持原样，不回写历史结果；
- P4：`calibration-30-h0-r4-p4`，0 error，保留 `P4_PROGRESS_PARAPHRASE_REVIEW` 人工语义复核；
- P5：`calibration-30-h0-r5-p5`，0 error / 0 warning。

人工抽查促成的最后修正包括：发芽率操作定义完整写入领域规格、P4 Tutor 不得首次指出异常、P5 不得诱导回填未记录规格、步骤编号不作为实验候选数字。六条均仍是 `needs_review`，不得直接导入或称为 Human Gold。

脚本默认输出关键进度：当前格子与尝试次数、Tutor/学生模拟器轮次、动作与结构化成果、确定性门禁、Evaluator 状态、累计候选与拒绝数。日志不会打印 API Key、完整 Prompt 或对话正文；自动化环境如需安静输出可添加 `--quiet`。

## 6. 校验和导入 Data Lab

```bash
npm run data-lab:validate-v3 -- --kind candidates --file data/sft/v3/runs/calibration-30/candidates.json
npm run data-lab:import -- --file data/sft/v3/runs/calibration-30/candidates.json --batch dataset-v3-calibration-30 --source-type ROLE_SEPARATED_ROLLOUT
```

随后由管理员创建小规模活动，标注员逐条修订，团队成员完成工作量审核和匿名仲裁。先检查 30 条中各阶段的拒绝原因、P4 数值落地、P5 上下文来源和五种风格表现；确认没有系统性漂移后，再把 `--target` 扩大到 400 或更高。

## 7. 发布前门禁

逐条审核以 [六阶段导师文本验收标准](./six-phase-text-acceptance-criteria.md) 为统一文字依据；规则命中必须保存阶段、轮次、规则码、问题原文和事实来源，不能只记录“通过/不通过”。

- 批次必须为 `ACTIVE`；
- `sourceKind` 必须是 `stage_contract_rollout` 或 `human_authored`；
- 记录必须声明当前 `stageContractVersion`；
- 结构校验、人工工作量审核、最终仲裁全部通过；
- 生产回流数据还必须具备授权、脱敏、无泄漏和实质人工纠正；
- 生产回流轨迹必须保存授权生效后当轮 Tutor 实际看到的完整系统上下文，并在提名时携带该轮此前的模型可见对话历史；字段为空的旧轨迹不得补猜或提名；
- 训练登记绑定父模型，双盲评测覆盖五种风格，通过后才允许 10% → 30% → 100% 灰度。
