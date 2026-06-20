/**
 * 确定性单测：buildPriorSummary（无 LLM、无 DB）。
 * 重点验证因变量为空时的降级文案（第一阶段不再强制因变量）。
 * 运行: npx tsx scripts/test-report-summary.ts
 */
import { buildPriorSummary } from '../app/lib/reportSummary';
import type { StageData } from '../app/models/stageData';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

console.log('buildPriorSummary:');

// 1. 因变量为空 → 降级为「待第二阶段确定」，且不出现 undefined
{
  const sd: StageData = {
    stage1: { confirmed: true, snapshot: '研究问题：X', variables: { independent: '光照时长' } },
  };
  const s = buildPriorSummary(sd);
  check('含自变量', s.includes('自变量：光照时长'));
  check('因变量空→降级文案', s.includes('因变量：待第二阶段确定'));
  check('不出现 undefined', !s.includes('undefined'));
}

// 2. 因变量为空白字符 → 同样降级
{
  const sd: StageData = {
    stage1: { confirmed: true, snapshot: 's', variables: { independent: '温度', dependent: '   ' } },
  };
  check('空白因变量也降级', buildPriorSummary(sd).includes('因变量：待第二阶段确定'));
}

// 3. 因变量有值 → 正常展示
{
  const sd: StageData = {
    stage1: { confirmed: true, snapshot: 's', variables: { independent: '温度', dependent: '溶解速度' } },
  };
  const s = buildPriorSummary(sd);
  check('因变量正常展示', s.includes('因变量：溶解速度'));
}

// 4. 含控制变量 → 追加展示
{
  const sd: StageData = {
    stage1: { confirmed: true, snapshot: 's', variables: { independent: '温度', dependent: '速度', controlled: ['浓度', '体积'] } },
  };
  check('控制变量追加', buildPriorSummary(sd).includes('控制变量：浓度、体积'));
}

// 5. 含 stage2 schema + stage3 数据 → 含数据表区块
{
  const sd: StageData = {
    stage1: { confirmed: true, snapshot: 's', variables: { independent: '温度' } },
    stage2: { submitted: true, approved: true, schema: { columns: [{ key: 'day', title: '天数', type: 'number', required: true }], minRows: 1, maxRows: 200 } },
    stage3: { rows: [{ day: 1 }, { day: 2 }] },
  };
  const s = buildPriorSummary(sd);
  check('含数据表列', s.includes('天数'));
  check('含数据行数', s.includes('共2行'));
}

// 6. 空 stageData → 兜底文案
{
  check('空数据兜底', buildPriorSummary({}).includes('暂无结构化摘要'));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
