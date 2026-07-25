#!/usr/bin/env tsx
import { tutorFocusPlan } from '../app/lib/serverTutorState';
import { buildTutorVisibleState } from '../app/lib/tutorLanguage';
import type { StageData } from '../app/models/stageData';

let passed = 0;
let failed = 0;
function check(condition: unknown, label: string) {
  if (condition) { passed++; console.log(`PASS ${label}`); }
  else { failed++; console.error(`FAIL ${label}`); }
}

const sections = {
  purpose: '目的',
  hypothesis: '假设',
  materials: '材料',
  procedure: '步骤',
  dataSummary: '概述',
  analysis: '已接受分析',
  conclusion: '结论',
  limitationsDiscussion: '局限',
  reflection: '局限',
};

const formal: StageData = {
  stage5: { submitted: true, approved: true, sections, teacherScore: 8, teacherFeedback: '结论需要限定范围' },
};
const formalVisible = buildTutorVisibleState(6, formal) as Record<string, unknown>;
check(formalVisible.评价来源 === '正式模式教师评价', '正式 P6 明确注入教师评价来源');
check(JSON.stringify(formalVisible).includes('结论需要限定范围'), '正式 P6 注入真实教师反馈');

const guest: StageData = {
  stage5: {
    submitted: true,
    approved: true,
    sections,
    aiReferenceScore: {
      overall: 7,
      dimensions: { completeness: 7, logic: 7, dataUsage: 7, innovation: 7, expression: 7 },
      highlights: ['引用了数据'],
      suggestions: [{ text: '限定结论', targetSection: '结论' }],
      safetyCompliance: true,
    },
  },
};
const guestVisible = buildTutorVisibleState(6, guest) as Record<string, unknown>;
check(guestVisible.评价来源 === '体验模式，无教师反馈', '体验 P6 明确标记无教师反馈');
check(JSON.stringify(guestVisible).includes('AI参考评价'), '体验 P6 注入 AI 参考评价');
check(String(guestVisible.阶段边界).includes('不得要求学生重新做 P4'), 'P6 可见状态明确禁止回退 P4');
check(tutorFocusPlan(6, guest).focusDescriptions.reflection_coaching.includes('不得要求重新引用单元格'), 'P6 focus 约束禁止重做数据分析');

console.log(`\nP6 context tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
