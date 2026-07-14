# Dataset v3 calibration-30 结果

运行时间：2026-07-14（Asia/Shanghai）  
计划：`plans/calibration-30.json`  
输出：`runs/calibration-30/`

## 完整性

- 计划任务：30
- 已完成 taskId：30（唯一 30，缺失 0）
- 候选：25
- 拒绝：5
- 候选文件通过 `data-lab:validate-v3 --kind candidates`
- 运行结束后无残留写锁

## 候选分布

| 维度 | 数量 |
|---|---:|
| P1 选题定向 | 3 |
| P2 方案设计 | 2 |
| P3 过程执行 | 5 |
| P4 数据分析 | 5 |
| P5 报告成型 | 5 |
| P6 结果反思 | 5 |
| 苏格拉底简洁型 | 5 |
| 温和陪伴型 | 5 |
| 工程导师型 | 4 |
| 证据分析型 | 6 |
| 课堂教练型 | 5 |

## 拒绝概况

- P1 两条：Tutor 连续两次不能满足开放式提问/结构契约，未生成可用完整记录。
- P2 一条：评估器发现 Tutor 在学生未确认时自行补入温度、数量和重复次数，并伴随风格违规。
- P2 两条：在动态轮数上限内未能形成完整、当前合同合法的数据表。

拒绝项保留在 `rejected.json`，可用作结构回归或 rejected preference 候选，不能进入正向 SFT。

## 重要限制

本次 Tutor、Student Simulator 与 Evaluator 都使用 `deepseek:deepseek-v4-pro`，只是输入视图和角色提示彼此隔离。因此 manifest 的 `evaluatorIndependent=false`，25 条通过项全部是 `needs_review`，不是 Gold，也不能绕过 Data Lab 人工标注、工作量审核和仲裁。

扩大生成前，团队应优先人工复核 P1/P2 的全部候选，并抽查：P3 安全题是否只引用已审核方案；P4 引用值是否确实存在于表格；P5 是否只整理已有分析；P6 是否没有引入未确认材料或新实验。
