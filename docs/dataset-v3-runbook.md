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

## 6. 校验和导入 Data Lab

```bash
npm run data-lab:validate-v3 -- --kind candidates --file data/sft/v3/runs/calibration-30/candidates.json
npm run data-lab:import -- --file data/sft/v3/runs/calibration-30/candidates.json --batch dataset-v3-calibration-30 --source-type ROLE_SEPARATED_ROLLOUT
```

随后由管理员创建小规模活动，标注员逐条修订，团队成员完成工作量审核和匿名仲裁。先检查 30 条中各阶段的拒绝原因、P4 数值落地、P5 上下文来源和五种风格表现；确认没有系统性漂移后，再把 `--target` 扩大到 400 或更高。

## 7. 发布前门禁

- 批次必须为 `ACTIVE`；
- `sourceKind` 必须是 `stage_contract_rollout` 或 `human_authored`；
- 记录必须声明当前 `stageContractVersion`；
- 结构校验、人工工作量审核、最终仲裁全部通过；
- 生产回流数据还必须具备授权、脱敏、无泄漏和实质人工纠正；
- 生产回流轨迹必须保存授权生效后当轮 Tutor 实际看到的完整系统上下文，并在提名时携带该轮此前的模型可见对话历史；字段为空的旧轨迹不得补猜或提名；
- 训练登记绑定父模型，双盲评测覆盖五种风格，通过后才允许 10% → 30% → 100% 灰度。
