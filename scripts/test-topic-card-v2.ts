#!/usr/bin/env tsx
import type { TopicCard } from '@prisma/client';
import { readFileSync } from 'fs';
import { validateTopicCardInput, type TopicCardInput } from '../app/lib/dataLab/bootstrap/contracts';
import { compileCases } from '../app/lib/dataLab/bootstrap/caseCompiler';
import { normalizeResourceTitle, topicResourceFamilyKey } from '../app/lib/dataLab/bootstrap/topicCardV2';
import { tutorTopicCardDiversityFailures } from '../app/lib/dataLab/bootstrap/service';

let passed = 0; let failed = 0;
function check(condition: unknown, label: string) { if (condition) { passed += 1; console.log(`PASS ${label}`); } else { failed += 1; console.error(`FAIL ${label}`); } }

const bridge = (label: string, factor: string, question: string) => ({
  label,
  retainedFeature: '自动判断环境状态并触发遮光',
  researchQuestion: question,
  factor,
  phenomenon: '正确响应率',
  testScaffold: { levels: ['低阈值', '中阈值', '高阈值'], measurement: '进行10次明暗状态测试并计算正确响应比例', unit: '%', metricKind: 'PERCENTAGE' as const, safeValueRange: [40, 100] as [number, number], controlledConditions: ['同一传感器位置', '同一光源距离'] },
  returnToDesign: `根据${factor}对应的正确响应率和误触发记录选择下一版设置`,
});

const input: TopicCardInput = {
  displayTitle: '教室西晒时怎样让遮光装置判断得更准',
  studentOpening: '下午太阳照进来时，窗帘拉早了会太暗，拉晚了又很热，我想做一个能自己判断的装置。',
  internalArchetype: 'engineering_v2', subject: 'engineering', gradeBand: '初中', coreMechanism: '环境光传感器读数与触发阈值共同决定执行器响应',
  acceptableDirections: [], forbiddenDirections: ['使用220V市电'], curriculumAnchors: ['光传感器', '工程迭代'], source: { title: '智能遮光系统课程资源' },
  schemaVersion: 2, activityMode: 'ENGINEERING_DESIGN', contextModule: 'INTELLIGENT_INFORMATION', disciplineAnchors: ['physics', 'information_technology', 'engineering'],
  authenticNeed: '教室西晒时需要在不过暗的前提下及时遮光', stakeholder: '教室里的学生和教师', engineeringGoal: '制作能够按环境光状态稳定触发的低压遮光模型',
  constraints: ['低压供电', '桌面尺度测试'], performanceCriteria: ['正确响应率较高', '误触发和漏触发可记录'], inquiryBridges: [
    bridge('触发阈值', '光照触发阈值', '光照触发阈值是否影响遮光装置的正确响应率？'),
    bridge('传感器位置', '传感器位置', '传感器位置是否影响遮光装置的正确响应率？'),
  ],
};

check(validateTopicCardInput(input).length === 0, '完整工程 TopicCard V2 通过校验');
check(validateTopicCardInput({ ...input, engineeringGoal: '', constraints: [], performanceCriteria: [] }).length >= 3, '工程 V2 缺少目标、约束和性能标准时拒绝');
check(normalizeResourceTitle('跨学科实践活动1 自制简易净水器 学习任务单') === normalizeResourceTitle('跨学科实践活动1 自制简易净水器 微课视频'), '课件、视频和任务单后缀归入同一规范标题');
check(topicResourceFamilyKey('自制净水器 课件') === topicResourceFamilyKey('自制净水器 学习任务单'), '规则 familyKey 对资源变体稳定');
const sourceCatalog = JSON.parse(readFileSync('data/topic-source-catalog.json', 'utf8')) as { items: Array<{ title: string; status: string; familyKey: string }> };
const statusCounts = sourceCatalog.items.reduce<Record<string, number>>((result, item) => ({ ...result, [item.status]: (result[item.status] ?? 0) + 1 }), {});
check(statusCounts.SHORTLISTED === 46 && statusCounts.NEW === 32 && statusCounts.REJECTED === 42, '120 条目录首轮筛选分为 46 入选、32 待判断和 42 排除');
check(new Set(sourceCatalog.items.filter((item) => item.status === 'SHORTLISTED').map((item) => item.familyKey)).size === 20, '46 条首轮入选资源合并为 20 个项目家族');
check(sourceCatalog.items.find((item) => item.title === '制作太阳能净水器')?.status === 'SHORTLISTED' && sourceCatalog.items.find((item) => item.title === '全球STEM教育发展的关键一步')?.status === 'REJECTED', '工程项目入选且 STEM 报道类资源被排除');

const now = new Date();
const card: TopicCard = {
  id: 'topic-v2-engineering', displayTitle: input.displayTitle, studentOpening: input.studentOpening, internalArchetype: input.internalArchetype,
  subject: input.subject, gradeBand: input.gradeBand, coreMechanism: input.coreMechanism, acceptableDirectionsJson: JSON.stringify(input.inquiryBridges!.map((item) => item.researchQuestion)),
  forbiddenDirectionsJson: JSON.stringify(input.forbiddenDirections), curriculumAnchorsJson: JSON.stringify(input.curriculumAnchors), sourceJson: JSON.stringify(input.source), compilerEvidenceJson: '{}',
  schemaVersion: 2, revision: 1, revisionOfId: null, activityMode: input.activityMode!, contextModule: input.contextModule!, disciplineAnchorsJson: JSON.stringify(input.disciplineAnchors),
  authenticNeed: input.authenticNeed!, stakeholder: input.stakeholder!, engineeringGoal: input.engineeringGoal!, constraintsJson: JSON.stringify(input.constraints), performanceCriteriaJson: JSON.stringify(input.performanceCriteria),
  inquiryBridgesJson: JSON.stringify(input.inquiryBridges), sourceCandidateId: null, status: 'APPROVED', rejectionReason: '', createdById: null, approvedById: null, approvedAt: now, createdAt: now, updatedAt: now,
};
const cases = compileCases([card], { 1: 2, 2: 2, 4: 6, 6: 4 }, 'PILOT');
check(cases.every((item) => !JSON.stringify(item.stageState).includes('条件一') && !JSON.stringify(item.stageState).includes('记录单位')), 'V2 Case 不生成条件一或记录单位占位符');
check(cases.filter((item) => item.phase === 1).every((item) => item.studentMessage.includes('装置') || item.studentMessage.includes('遮光')), 'V2 P1 保留真实工程情境');
check(cases.filter((item) => item.phase === 4).every((item) => /低阈值|中阈值|高阈值/.test(item.studentMessage)), 'V2 P4 使用真实测试水平和性能数据');
check(cases.filter((item) => item.phase === 6).some((item) => item.studentMessage.includes('下一版')), 'V2 P6 将证据返回下一版设计');

const modules = ['LIFE_HEALTH', 'ENERGY_ENVIRONMENT', 'INTELLIGENT_INFORMATION', 'AEROSPACE', 'DEEP_EARTH_OCEAN'];
const subjects = ['biology_ecology', 'chemistry', 'physics', 'engineering', 'high_concept_interdisciplinary'];
const fullCards = Array.from({ length: 15 }, (_, index) => ({ id: `card-${index}`, subject: subjects[index % 5], schemaVersion: 2, contextModule: modules[Math.floor(index / 3)], activityMode: index % 3 === 0 || index === 1 ? 'HYBRID' : 'SCIENTIFIC_INQUIRY', sourceCandidate: { familyKey: `family-${index}`, familyOverrideKey: '' } }));
check(tutorTopicCardDiversityFailures(fullCards).length === 0, 'Full 180 V2 五模块与工程配额通过');
check(tutorTopicCardDiversityFailures([...fullCards.slice(0, 14), { ...fullCards[14], sourceCandidate: fullCards[0].sourceCandidate }]).some((item) => item.includes('DUPLICATE_PROJECT_FAMILY')), 'Full 180 阻断重复项目家族凑配额');

console.log(`\nTopicCard V2 tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
