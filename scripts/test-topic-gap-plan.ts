#!/usr/bin/env tsx
import { planTopicCardGaps } from '../app/lib/dataLab/topicGaps';

let passed = 0;
let failed = 0;

function check(condition: unknown, label: string) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

const livePlan = planTopicCardGaps([
  'FULL_REQUIRES_ALL_V2_TOPIC_CARDS:25/30',
  'FULL_REQUIRES_3_TOPIC_CARDS_PER_SUBJECT:biology_ecology:1',
  'FULL_REQUIRES_3_TOPIC_CARDS_PER_SUBJECT:chemistry:2',
], { total: 30 }, { total: 15 });

check(livePlan.requests.length === 3, '现场覆盖数据规划 3 张定向补全卡');
check(
  livePlan.requests.filter((request) => request.subject === 'biology_ecology').length === 2
    && livePlan.requests.filter((request) => request.subject === 'chemistry').length === 1
    && livePlan.requests.every((request) => Boolean(request.subject)),
  '学科缺口定向为 biology_ecology x2 和 chemistry x1',
);

const allV2Only = planTopicCardGaps([
  'FULL_REQUIRES_ALL_V2_TOPIC_CARDS:25/30',
], { total: 30 }, { total: 15 });
check(allV2Only.requests.length === 0 && allV2Only.manualActions.length === 1, 'ALL_V2 只生成人工升级动作');

const existingGapTypes = planTopicCardGaps([
  'FULL_REQUIRES_3_TOPIC_CARDS_PER_CONTEXT_MODULE:AEROSPACE:2',
  'FULL_REQUIRES_ENGINEERING_OR_HYBRID_PER_CONTEXT_MODULE:LIFE_HEALTH:0',
  'FULL_REQUIRES_6_ENGINEERING_OR_HYBRID_TOPIC_CARDS:5',
], { total: 15 }, { total: 15 });
check(
  existingGapTypes.requests.some((request) => request.contextModule === 'AEROSPACE')
    && existingGapTypes.requests.some((request) => request.contextModule === 'LIFE_HEALTH' && request.activityMode === 'ENGINEERING_DESIGN')
    && existingGapTypes.requests.some((request) => !request.contextModule && request.activityMode === 'ENGINEERING_DESIGN'),
  '原有情境模块与工程模式缺口解析保持不变',
);

const duplicateOnly = planTopicCardGaps([
  'FULL_DUPLICATE_PROJECT_FAMILY:family-a:2',
], { total: 15 }, { total: 15 });
check(duplicateOnly.requests.length === 0 && duplicateOnly.manualActions.length === 1, '重复项目族只生成人工处理动作');

const buttonLabel = `一键补全 ${livePlan.requests.length} 张`;
check(buttonLabel === '一键补全 3 张', '按钮数字与同一 requests 数组长度一致');

const capped = planTopicCardGaps([
  'FULL_REQUIRES_3_TOPIC_CARDS_PER_SUBJECT:biology_ecology:0',
  'FULL_REQUIRES_3_TOPIC_CARDS_PER_SUBJECT:chemistry:0',
], { total: 0 }, { total: 15 });
check(capped.requests.length === 5, '自动补全请求上限仍为 5');

const complete = planTopicCardGaps([], { total: 30 }, { total: 15 });
check(complete.requests.length === 0, '无缺口时不生成兜底请求');

console.log(`\nTopic gap plan tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
