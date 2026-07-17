# Tutor Calibration 12 执行记录（2026-07-15）

## Run

- 首次编译 run：`74f99b00-18e3-45d3-a9de-0070a129b5c5`
- Prompt：`tutor-language-prompt-v2`
- 固定场景：12 条，P1/P2/P4 各 4 条
- 编译硬错误：0
- 生成结果：Qwen A 12/12 因网络 `EHOSTUNREACH` 失败；DeepSeek B 12/12 已保存；未进入审核队列
- DeepSeek 已记录 token：12,042
- 该 run 已审计标记为 `SUPERSEDED`，案例、候选和失败记录全部保留

Qwen/OpenAI-compatible 配置中重复的 `/v1/v1` 已纠正为 `/v1`。纠正后预检仍显示运行节点无法连接 `llm.wtsht.cn:443`，因此后续批处理现在会先做双 provider `/models` 预检，任一 provider 不可用时在生成和计费前停止。

## DeepSeek B 只读校准发现

使用保存的 12 条 B 候选重跑更新后的确定性检查：

- `DIALOGUE_ANSWER_MENU`：5 条
  - P1 高概念代理
  - P1 方向确认
  - P1 模糊输入
  - P2 测量方式含糊
  - P2 一次给全
- `TOO_MANY_QUESTIONS`：1 条
  - P4 未引用数值
- 无确定性 warning：6 条

最重要的分类修正：P2 控制变量混乱候选只是复述学生已经提出的多个变化，用来解释为什么无法判断原因；它不再被误标为“答案菜单”。相反，“比如 A 还是 B”或列出多个观察指标让学生选择，会明确标为 `DIALOGUE_ANSWER_MENU`，并避免同时重复标记为机械的 `TOO_MANY_QUESTIONS`。

## Prompt v2.1

根据本次保存证据新增 `tutor-language-prompt-v2.1`，未覆盖历史 v2：

- 明确禁止“A 还是 B”式答案菜单；
- 最多给一个具体例子；
- 允许为解释控制变量、因果或安全问题而概括复述学生已经列出的多个条件；
- 生产 Tutor 仍保持 Prompt v1。

新的待生成 run：`013a6d35-b1f6-4a3c-aa07-0e251054bbcf`，包含 12 条 Prompt v2.1 Calibration 案例，当前全部为 `READY`。只有 Qwen 与 DeepSeek 双 provider 预检都通过后才会开始实际生成。

## Prompt v2.1 正式生成与首次审核

中转站配置修复后，run `013a6d35-b1f6-4a3c-aa07-0e251054bbcf` 完成双 provider 预检：

- A：`claude-opus-4-6`，family=`anthropic`
- B：`deepseek-v4-pro`，family=`deepseek`
- 12/12 案例完成 A/B 和双向 Critic
- 24/24 候选状态为 `GENERATED`
- hard failure：0
- 记录 token：24,618
- 确定性 warning：10
- blocking Critic warning：1
- Critic advisory：0

AI-assisted 首次审核已由 `data-admin` 提交，并在每条理由中明确要求独立 reviewer 实质确认：

- `NO_CHANGE`：10
- `MATERIAL_CORRECTION`：2
- 最终草稿确定性 hard error：0
- 最终草稿确定性 warning：0
- preference pair：10
- 当前状态：12 条 `AWAITING_CONFIRMATION`；12 个 `CONFIRM/PENDING`

两条人工编辑：

```json
{"dialogue":"“效果好不好”还不能让别人重复判断。你打算用什么具体方式记录溶解快慢，让每次结果都能直接比较？","interactionType":"clarification","focus":"measurement","hints":[]}
```

```json
{"dialogue":"先别直接删。比较第二次重复中第三组的 6 和另外两次的 7、7，看看这次延迟对应的数据是否明显偏离。","interactionType":"clarification","focus":"interpret_evidence","hints":[]}
```

候选层共有 11 个需要 reviewer 给出结构化结论的自动检查项；最终草稿本身均为 0 deterministic warning。最终确认必须由不同账号完成，不得由 `data-admin` 代替。

## 独立 Reviewer 结果与 warning 多维化（2026-07-16）

Reviewer 已提交 10 条直接确认，退回 1 条 P2 控制变量案例；P1 高概念代理仍是 `CONFIRM/IN_PROGRESS`，并未实际提交。退回理由是候选 B 直接给出“光源距离”和保持一致的参考答案，启发性弱于 A。

退回案例已按意见修订并重新送审：

```json
{"dialogue":"如果同时改变材料数量和记录时间，即使叶片出现差异，也很难判断是哪一个因素造成的。除了你要研究的条件，其他条件应该怎样处理？","interactionType":"clarification","focus":"controls","hints":[]}
```

Reviewer 备注证明旧版 warning 单选仍然不足。例如：

- 判断本身可能是误报，同时该片段也没有进入最终稿；
- 问题确实存在但程度较轻，同时只出现在未采用候选；
- 问题成立、已由编辑去除，因此对最终稿没有阻断影响。

新版 closure 改为三个独立维度：

1. `VALID / PARTIALLY_VALID / FALSE_POSITIVE`；
2. `PRESENT_IN_FINAL / REMOVED_BY_EDIT / ONLY_UNSELECTED_CANDIDATE`；
3. `BLOCKING / MINOR / NEGLIGIBLE`。

只有三个维度都填写才算关闭。若 `判断成立或部分成立 + 仍在最终稿 + BLOCKING`，服务端禁止确认。历史 boolean 和旧版单选 JSON 保持只读兼容。

同时，机械的 `TOO_MANY_QUESTIONS` 已替换为中性事实标签 `MULTIPLE_QUESTION_MARKS`：它只说明存在多个问号，不再直接断言存在多个核心任务；是否属于反问、递进支架或认知过载由 reviewer 在多维 closure 中判断。
