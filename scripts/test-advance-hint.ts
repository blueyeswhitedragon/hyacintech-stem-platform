/** 确定性单测：advanceHint 复用 canAdvance，并覆盖六阶段与 GJQ 恢复形态。 */
import { advanceHint } from '../app/lib/advanceHint';
import { recoverStageDataV3 } from '../app/lib/stageState';
import type { StageData } from '../app/models/stageData';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
}

const legacy: StageData = {
  extractedFacts: {
    'stage1.researchQuestion': { value: '食物如何转化成让人活动的能量', sourceQuote: '食物如何转化成让人活动的能量' },
    'stage1.confirmed': { value: true, sourceQuote: '我确认这个研究问题' },
  },
  roundCounts: { 1: 18 },
};
check('未恢复的旧 P1 形态仍被门禁拒绝', !advanceHint({ currentStage: 1, stageData: legacy }).ok);
const recovered = recoverStageDataV3(legacy);
const p1 = advanceHint({ currentStage: 1, stageData: recovered.stageData });
check('GJQ 形态恢复后服务器就绪', recovered.recovered && p1.ok && p1.to === 2);

const p2 = advanceHint({ currentStage: 2, stageData: {} });
check('P2 不走学生 advance 操作', !p2.ok && p2.to === 3 && Boolean(p2.reason));

const stage3: StageData = {
  stage2: {
    submitted: true,
    approved: true,
    schema: { columns: [{ key: 'value', title: '结果', type: 'number', required: true }], minRows: 2, maxRows: 200 },
  },
  stage3: { rows: [{ value: 1 }, { value: 2 }], safetyQuiz: { question: 'q', options: ['a'], passed: true } },
};
check('P3 数据与安全门禁齐全时就绪', advanceHint({ currentStage: 3, stageData: stage3 }).ok);

const stage4: StageData = { stage4: { analysisCount: 2 } };
check('P4 两轮分析时就绪', advanceHint({ currentStage: 4, stageData: stage4 }).ok);
check('P5 由教师审核推进', !advanceHint({ currentStage: 5, stageData: {} }).ok);
check('P6 没有下一阶段 advance 操作', !advanceHint({ currentStage: 6, stageData: {} }).ok);

// 反向哨兵：拿掉安全通过后，同一份 P3 数据必须立刻变成未就绪。
check('哨兵：P3 安全未通过会阻断', !advanceHint({ currentStage: 3, stageData: { ...stage3, stage3: { ...stage3.stage3!, safetyQuiz: undefined } } }).ok);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
