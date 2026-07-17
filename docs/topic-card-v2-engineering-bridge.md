# TopicCard V2：工程探究桥与素材治理

> 生效日期：2026-07-16。适用于 Data Lab TopicCard 编译、审批和 Tutor Case Bootstrap；学生端六阶段合同本轮不变。

## 1. 核心原则

工程实践不被去情境化为普通控制变量实验。平台保留真实需求、工程目标、约束和性能标准，只把其中一个可验证的不确定性送入六阶段：

```text
真实需求 → 一个设计参数/机制 → 可测性能 → 六阶段证据循环 → 下一版设计决策
```

第一版每轮只验证一个探究桥，不支持同轮多指标优化或多原型版本管理。

## 2. TopicCard V2

V2 在兼容 `subject` 的同时新增：

- `activityMode`：科学探究、工程设计或混合；
- `contextModule`：生命健康、能源环境、智能信息、航空航天、深地深海；
- `disciplineAnchors`：可多选学科锚点；
- `authenticNeed/stakeholder/engineeringGoal`；
- `constraints/performanceCriteria`；
- 至少两个结构化 `inquiryBridges`。

工程或混合型的每个桥必须说明：保留机制、研究问题、设计参数、性能指标、真实测试水平、测量方式、单位、固定测试条件，以及证据如何返回设计。

`acceptableDirectionsJson` 继续保留给旧 Case/Reviewer，但由桥的研究问题自动同步。

## 3. 素材池

管理员在 `/data-lab/topic-cards` 中：

1. 导入内置 120 条国家智慧教育平台目录，或通过 API 导入授权资源；
2. 按规则 `familyKey` 查看同项目的课件、视频、任务单和课时资源；
3. 人工合并或拆分项目家族；
4. 确认授权并补写至少 20 字摘要；
5. 选择一个或多个同家族资源送双模型编译。

`basic.smartedu.cn.har` 不在 Web 请求中实时解析。运行：

```bash
npm run data-lab:build-topic-sources
```

生成轻量 `data/topic-source-catalog.json`。旧 `questionStem`、变量和工程转换被标记为 `LEGACY_DERIVED_HINTS_ONLY`，不能冒充来源事实。

## 4. 双模型编译与审批

模型先判断资源是否为学生科学探究、学生工程项目或混合项目。教师资源、科普资源和信息不足资源直接拒绝并保存原因。

A/B 独立生成 V2，另一模型检查资源类型误判、工程情境丢失、课堂代理漂移、通用模板、缺少可测性能、无法返回设计、唯一答案、安全和项目重复。

结构错误直接进入 `REJECTED`。高置信度语义问题阻断批准；管理员必须编辑并填写人工覆盖说明，操作写入审计日志。

## 5. 修订与案例生成

已用于案例的批准卡不得原地覆盖：

- “创建 V2 修订”产生新 DRAFT；
- 新修订批准前旧卡继续 APPROVED；
- 新修订批准后旧卡变为 SUPERSEDED；
- 历史 Case、A/B、审核和 Release 始终保留旧引用。

V2 Case 使用桥中的真实水平、指标和单位，按卡 ID/variant 确定性生成可复现测试数据，不再使用“条件一”“效果好不好”“记录单位”等通用占位。工程类 P6 引导证据返回下一版设计。

## 6. Full 180 门槛

Trial/Calibration 只显示覆盖提示。Full 180 要求：

- 至少 15 张且全部为 V2；
- 旧五个 `subject` 各至少 3 张；
- 五个情境模块各至少 3 张；
- 工程设计或混合型至少 6 张；
- 每个情境模块至少 1 张工程/混合卡；
- 同一项目 `familyKey` 不能重复满足配额。

## 7. 内置 120 条目录的首轮筛选

首轮人工筛选结果保存在 `data/topic-source-curation-v1.json`：

- `SHORTLISTED`：46 条资源载体，合并后为 20 个项目家族；
- `NEW`：32 条，标题有潜力但原始摘要不足，暂不编译；
- `REJECTED`：42 条，主要是探究方法教学、教师复习课件、科普人物/公开课、展示网站或过宽标题。

`SHORTLISTED` 不是“已经是 TopicCard”，只表示值得管理员继续核对原资源、补摘要和授权。默认素材池只显示首轮入选项；管理员可切换查看待判断和排除项。
