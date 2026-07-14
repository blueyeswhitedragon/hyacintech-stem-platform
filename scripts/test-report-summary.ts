/** Deterministic structured prior-summary tests. */
import { buildPriorSummary } from '../app/lib/reportSummary';
import type { StageData } from '../app/models/stageData';

let passed = 0, failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

console.log('buildPriorSummary:');

{
  const summary = buildPriorSummary({
    stage1: {
      confirmed: true,
      snapshot: '研究问题：光照方向是否影响发芽表现',
      factorDirection: '光照方向',
      phenomenonDirection: '发芽表现',
      variables: { independent: '光照方向' },
    },
  });
  check('阶段1使用因素方向而非正式变量操作化', summary.includes('拟改变因素方向：光照方向') && summary.includes('关注现象方向：发芽表现'));
  check('阶段1摘要不出现 undefined', !summary.includes('undefined'));
}

{
  const summary = buildPriorSummary({
    stage1: { confirmed: true, snapshot: '旧确认书', variables: { independent: '温度' } },
  });
  check('旧记录自变量作为因素方向兼容', summary.includes('拟改变因素方向：温度'));
  check('旧记录不伪造现象测量', summary.includes('关注现象方向：待第二阶段确认'));
}

const structured: StageData = {
  stage1: {
    confirmed: true,
    snapshot: '研究问题',
    factorDirection: '温度',
    phenomenonDirection: '溶解表现',
    variables: { independent: '温度' },
  },
  stage2: {
    submitted: true,
    approved: true,
    experimentPlan: {
      independentVariable: { name: '水温', levels: ['低温', '高温'] },
      dependentVariable: { name: '溶解时间', measurement: '秒表记录秒数' },
      controlledVariables: ['水量'],
      materials: ['烧杯', '秒表'],
      procedure: ['加入等量水', '记录溶解时间'],
      repeatCount: 3,
      safetyNotes: ['避免烫伤'],
    },
    schema: {
      columns: [
        { key: 'trial', title: '次数', type: 'number', required: true },
        { key: 'low_temp_seconds', title: '低温秒数', type: 'number', required: true },
        { key: 'high_temp_seconds', title: '高温秒数', type: 'number', required: true },
      ],
      minRows: 3,
      maxRows: 200,
    },
  },
  stage3: { rows: [{ trial: 1, low_temp_seconds: 35, high_temp_seconds: 20 }, { trial: 2, low_temp_seconds: 33, high_temp_seconds: 19 }, { trial: 3, low_temp_seconds: 36, high_temp_seconds: 21 }] },
  stage4: {
    analysisCount: 2,
    observations: ['高温组用时更短'],
    evidenceCitations: ['第1次35秒与20秒'],
    anomalies: ['第3次差距较小'],
    interpretations: ['温度可能与溶解时间相关'],
  },
};
{
  const summary = buildPriorSummary(structured);
  check('包含结构化变量水平与测量方式', summary.includes('水平：低温、高温') && summary.includes('秒表记录秒数'));
  check('包含真实数据行数', summary.includes('共3行'));
  check('包含有效分析进度与证据', summary.includes('有效分析轮次：2') && summary.includes('第1次35秒与20秒'));
}

{
  const stage5: StageData = {
    ...structured,
    stage5: {
      submitted: true,
      approved: true,
      teacherScore: 8,
      teacherFeedback: '结论需要限定适用范围',
      sections: {
        purpose: '目的', hypothesis: '假设', materials: '材料', procedure: '步骤',
        dataSummary: '数据概述', analysis: '分析', conclusion: '学生结论', reflection: '学生反思',
      },
    },
  };
  const summary = buildPriorSummary(stage5);
  check('阶段6上下文包含学生报告', summary.includes('【学生报告】') && summary.includes('学生结论'));
  check('阶段6上下文包含教师评价', summary.includes('教师评分：8') && summary.includes('限定适用范围'));
}

check('空数据兜底', buildPriorSummary({}).includes('暂无结构化摘要'));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
