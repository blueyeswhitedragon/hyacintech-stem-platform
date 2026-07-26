/** 确定性单测：P2 分类变量/计数指标兜底与假设误命中哨兵。 */
import { applyDeterministicExtractionFallbacks } from '../app/lib/stateExtractor';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
}

const categorical = applyDeterministicExtractionFallbacks(
  2,
  [],
  '我想比较方形截面和圆形截面两种纸桥的承重差异。',
);
const levels = categorical.accepted.find((fact) => fact.field === 'stage2.independentVariable.levels');
const independent = categorical.accepted.find((fact) => fact.field === 'stage2.independentVariable.name');
check('分类水平保留学生原词', JSON.stringify(levels?.value) === JSON.stringify(['方形截面', '圆形截面']));
check('分类水平推导到截面形状变量', independent?.value === '截面形状');

const historicalCategorical = applyDeterministicExtractionFallbacks(
  2,
  [],
  '我觉得可能是正方形截面的最厉害，圆形截面的最不厉害。我想比较两者差异',
);
check(
  '历史纸桥措辞也能识别截面形状与两个水平',
  historicalCategorical.accepted.some((fact) => fact.field === 'stage2.independentVariable.name' && fact.value === '截面形状')
    && JSON.stringify(historicalCategorical.accepted.find((fact) => fact.field === 'stage2.independentVariable.levels')?.value)
      === JSON.stringify(['正方形截面', '圆形截面']),
);

const explicitIndependent = applyDeterministicExtractionFallbacks(2, [], '只改变不同的桥梁形状，其他条件一致。');
check(
  '不同的非数值条件可识别为自变量',
  explicitIndependent.accepted.some((fact) => fact.field === 'stage2.independentVariable.name' && fact.value === '桥梁形状'),
);

const counted = applyDeterministicExtractionFallbacks(2, [], '记录桥塌下时的砝码数量。');
check(
  '计数型因变量保留砝码数量',
  counted.accepted.some((fact) => fact.field === 'stage2.dependentVariable.name' && fact.value === '砝码数量'),
);

const countedUntilCollapse = applyDeterministicExtractionFallbacks(2, [], '数据记录表每次加5G的砝码直到倒塌。');
check(
  '逐次加砝码直到倒塌可识别为砝码数量',
  countedUntilCollapse.accepted.some((fact) => fact.field === 'stage2.dependentVariable.name' && fact.value === '砝码数量'),
);

const meta = '我认为四环节应该已经完成了，请你确认。';
const metaAccepted = applyDeterministicExtractionFallbacks(2, [
  { field: 'stage2.hypothesis', value: '四环节应该已经完成了', sourceQuote: meta },
], meta);
check('元对话不得写成假设', !metaAccepted.accepted.some((fact) => fact.field === 'stage2.hypothesis'));

const trend = '我认为方形截面比圆形截面承重更多。';
const trendAccepted = applyDeterministicExtractionFallbacks(2, [], trend);
check(
  '带比较方向的明确预测仍可写入假设',
  trendAccepted.accepted.some((fact) => fact.field === 'stage2.hypothesis' && String(fact.value).includes('承重更多')),
);

// 反向哨兵：确认测试数据本身确实包含原先会误命中的“认为”。
check('哨兵：元对话包含旧规则触发词', /认为/.test(meta));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
