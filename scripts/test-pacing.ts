/**
 * 确定性单测：pacing 节奏判定（无 LLM、无 DB）。
 * 运行: npx tsx scripts/test-pacing.ts
 */
import { shouldNudgeConvergence, shouldShowEscapeHatch, PACING_THRESHOLDS } from '../app/lib/pacing';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

console.log('shouldNudgeConvergence:');
const t1 = PACING_THRESHOLDS[1];
check('阶段1 未达阈值不提示', shouldNudgeConvergence(1, t1 - 1) === false);
check('阶段1 达阈值提示', shouldNudgeConvergence(1, t1) === true);
check('阶段1 超阈值提示', shouldNudgeConvergence(1, t1 + 3) === true);
check('阶段2 达阈值提示', shouldNudgeConvergence(2, PACING_THRESHOLDS[2]) === true);
check('阶段3 无阈值不提示', shouldNudgeConvergence(3, 99) === false);
check('阶段4 无阈值不提示', shouldNudgeConvergence(4, 99) === false);

console.log('shouldShowEscapeHatch（仅阶段1）:');
check('阶段1 超阈值显示逃生', shouldShowEscapeHatch(1, t1) === true);
check('阶段1 未达阈值不显示', shouldShowEscapeHatch(1, t1 - 1) === false);
check('阶段2 不显示逃生', shouldShowEscapeHatch(2, 99) === false);
check('阶段3 不显示逃生', shouldShowEscapeHatch(3, 99) === false);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
