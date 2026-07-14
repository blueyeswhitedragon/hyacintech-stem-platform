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
      minRows: 3,
      maxRows: 200,
    },
  },
};

console.log('canAdvance:');

// 3→4：即使数据完整，未通过服务端安全题也必须拒绝
{
  const sd: StageData = { ...schema2, stage3: { rows: [{ trial: 1, height: 7.2 }, { trial: 2, height: 7.5 }, { trial: 3, height: 7.8 }] } };
  check('3→4 未通过安全题被拒', canAdvance(3, 4, sd).ok === false);
}

// 3→4：行非空 + 必填齐 → ok
{
  const sd: StageData = { ...schema2, stage3: { rows: [{ trial: 1, height: 7.2 }, { trial: 2, height: 7.5 }, { trial: 3, height: 7.8 }] } };
  check('3→4 必填齐且安全题通过', canAdvance(3, 4, sd, { safetyQuizCompleted: true }).ok === true);
}
// 3→4：无行 → 拒绝
{
  const sd: StageData = { ...schema2, stage3: { rows: [] } };
  const r = canAdvance(3, 4, sd);
  check('3→4 无行被拒', r.ok === false && !!r.error);
}
// 3→4：未达到 schema.minRows → 拒绝
{
  const sd: StageData = { ...schema2, stage3: { rows: [{ trial: 1, height: 5 }, { trial: 2, height: 6 }] } };
  const r = canAdvance(3, 4, sd, { safetyQuizCompleted: true });
  check('3→4 未达到 minRows 被拒', r.ok === false && r.error?.includes('3 行') === true);
}
// 3→4：必填列缺值 → 拒绝
{
  const sd: StageData = { ...schema2, stage3: { rows: [{ trial: 1, height: '' }, { trial: 2, height: 5 }, { trial: 3, height: 6 }] } };
  check('3→4 必填缺值被拒', canAdvance(3, 4, sd).ok === false);
}
// 3→4：非必填列缺值 → 仍通过
{
  const sd: StageData = { ...schema2, stage3: { rows: [{ trial: 1, height: 5 }, { trial: 2, height: 6 }, { trial: 3, height: 7 }] } };
  check('3→4 非必填缺值仍通过', canAdvance(3, 4, sd, { safetyQuizCompleted: true }).ok === true);
}
// 4→5：分析不足 → 拒绝
{
  check('4→5 分析不足被拒', canAdvance(4, 5, {}).ok === false);
}
// 4→5：分析达到2轮 → 放行
{
  const sd: StageData = { stage4: { analysisCount: 2 } };
  check('4→5 分析2轮放行', canAdvance(4, 5, sd).ok === true);
}
// 非逐阶段：3→5 拒绝
{
  check('3→5 跳级被拒', canAdvance(3, 5, {}).ok === false);
}
// 1→2：无 stage1 数据 → 拒绝
{
  check('1→2 无数据被拒', canAdvance(1, 2, {}).ok === false);
}
// 1→2：已确认因素方向与现象方向 → 通过
{
  const sd: StageData = {
    stage1: { confirmed: true, snapshot: 'snap', factorDirection: '光照', phenomenonDirection: '发芽表现', variables: { independent: '光照' } },
  };
  check('1→2 已确认双方向通过', canAdvance(1, 2, sd).ok === true);
}
// 1→2：只有因素方向而没有现象/研究问题 → 拒绝
{
  const sd: StageData = {
    stage1: { confirmed: true, snapshot: 'snap', variables: { independent: '光照' } },
  };
  check('1→2 缺关注现象被拒', canAdvance(1, 2, sd).ok === false);
}
// 1→2：有确认但自变量为空 → 拒绝
{
  const sd: StageData = { stage1: { confirmed: true, snapshot: 'snap', variables: { independent: '' } } };
  check('1→2 缺自变量被拒', canAdvance(1, 2, sd).ok === false);
}
// 1→2：自变量仅空白字符 → 拒绝
{
  const sd: StageData = { stage1: { confirmed: true, snapshot: 'snap', variables: { independent: '   ' } } };
  check('1→2 自变量纯空白被拒', canAdvance(1, 2, sd).ok === false);
}
// 2→3 拒绝（由教师审核驱动）
{
  check('2→3 不走此操作被拒', canAdvance(2, 3, {}).ok === false);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
