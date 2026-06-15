/**
 * 确定性单测：canAdvance gating（无 LLM、无 DB）。
 * 运行: npx tsx scripts/test-stage-advance.ts
 */
import { canAdvance } from '../app/lib/stageAdvance';
import type { StageData } from '../app/models/stageData';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const schema2: StageData = {
  stage2: {
    submitted: false,
    approved: null,
    schema: {
      columns: [
        { key: 'trial', title: '次数', type: 'number', required: true },
        { key: 'height', title: '株高', type: 'number', required: true },
        { key: 'note', title: '备注', type: 'text', required: false },
      ],
      minRows: 1,
      maxRows: 200,
    },
  },
};

console.log('canAdvance:');

// 3→4：行非空 + 必填齐 → ok
{
  const sd: StageData = { ...schema2, stage3: { rows: [{ trial: 1, height: 7.2 }] } };
  check('3→4 必填齐通过', canAdvance(3, 4, sd).ok === true);
}
// 3→4：无行 → 拒绝
{
  const sd: StageData = { ...schema2, stage3: { rows: [] } };
  const r = canAdvance(3, 4, sd);
  check('3→4 无行被拒', r.ok === false && !!r.error);
}
// 3→4：必填列缺值 → 拒绝
{
  const sd: StageData = { ...schema2, stage3: { rows: [{ trial: 1, height: '' }] } };
  check('3→4 必填缺值被拒', canAdvance(3, 4, sd).ok === false);
}
// 3→4：非必填列缺值 → 仍通过
{
  const sd: StageData = { ...schema2, stage3: { rows: [{ trial: 1, height: 5 }] } };
  check('3→4 非必填缺值仍通过', canAdvance(3, 4, sd).ok === true);
}
// 4→5：放行
{
  check('4→5 放行', canAdvance(4, 5, {}).ok === true);
}
// 非逐阶段：3→5 拒绝
{
  check('3→5 跳级被拒', canAdvance(3, 5, {}).ok === false);
}
// 不属于按钮推进：1→2 拒绝
{
  check('1→2 不走此操作被拒', canAdvance(1, 2, {}).ok === false);
}
// 2→3 拒绝（由 chat 驱动）
{
  check('2→3 不走此操作被拒', canAdvance(2, 3, {}).ok === false);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
