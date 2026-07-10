# Benchmark：Qwen3.5-35B-A3B（未微调原始基线）

- 日期：2026-07-08
- 端点：`https://llm.wtsht.cn/v1/v1`（注意：平台标注的 `/v1` 是网关前缀，会被剥掉，真实 OpenAI 路由需要双写 `/v1/v1`）
- 模型：`Qwen3.5-35B-A3B`（vLLM 0.18，TP=2，enable_thinking=false）
- 运行配置：`LLM_TIMEOUT_MS=180000`、`LLM_MAX_TOKENS=1600`（网关单请求延迟约 20–30s，默认 30s 超时会失败）
- 测试脚本：`scripts/test-llm-quality-multiturn.ts`（4 个学生画像 × 阶段1→2 + 阶段4×2轮 + 阶段5首轮，6 类自动规则检查）
- Prompt 版本：含动态选题案例库 + 工程转探究规则 + 最新排版纪律（加粗≤2处指令）

## 结果

| 指标 | Qwen3.5-35B-A3B (raw) | DeepSeek-V4-Pro (raw, 同脚本前一版prompt) |
|---|---|---|
| JSON 解析成功 | 28/28 (100%) | 28/28 (100%) |
| 零违规轮次 | 24/28 (86%) | 22/28 (79%) |
| 阶段1收敛（全部画像） | ✅ 全部在剧本轮内给出确认书 | ✅ |
| 阶段2产表（全部画像） | ✅ 全部产出 data_table_schema | ✅ |
| 工程画像转探究 | ✅ 正确引导“湿度阈值→自变量、准确率→因变量” | ✅ |
| 阶段5首轮 report_sections 六节 | ✅ | ✅ |

## 违规明细（Qwen raw）

- `md-too-many-bold` ×3：模糊型 P2T3、工程项目型 P1T1、工程项目型 P2T3（加粗 5–6 处 > 4）
- `md-list-marker` ×2：模糊型 P2T4、工程项目型 P2T3（dialogue 内出现 `- ` 列表符）

无任何结构性违规（无冗余确认轮、无阶段越界、无 options 纪律违规、无 confirmation 缺产出）。

## 结论

1. 未微调的 Qwen3.5-35B-A3B 在该任务上的格式遵从度已与 DSV4-Pro 同级甚至略好（86% vs 79%，注意 Qwen 跑的是更严的 prompt 版本，不是严格对照）。
2. 剩余问题集中在排版细节（加粗数量、markdown 列表），恰好是 SFT 最容易修的表层风格问题——这是微调的主要提分空间。
3. 单轮脚本 `scripts/test-llm-quality.ts` 结果：7/7 JSON 解析成功，结构化字段（stage1_confirmed/snapshot/variables、report_sections）均正常产出。

## 复现命令

```bash
OPENAI_API_KEY=sk-... \
OPENAI_API_BASE=https://llm.wtsht.cn/v1/v1 \
LLM_PROVIDER=openai LLM_MODEL=Qwen3.5-35B-A3B \
LLM_TIMEOUT_MS=180000 LLM_MAX_TOKENS=1600 \
npx tsx scripts/test-llm-quality-multiturn.ts
```
