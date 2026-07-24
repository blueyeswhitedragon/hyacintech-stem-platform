/**
 * 确定性单测：canAdvance gating（无 LLM、无 DB）。
 * 运行: npx tsx scripts/test-stage-advance.ts
 */
import { canAdvance } from '../app/lib/stageAdvance';
import { confirmationDocumentBody, phaseConfirmationAction, shouldOfferPhaseConfirmation } from '../app/lib/confirmationFlow';
import type { StageData } from '../app/models/stageData';
import { recoverStageDataV3, researchQuestionHash } from '../app/lib/stageState';
import { updateServerAnalysis } from '../app/lib/serverTutorState';
import { validateStage3Rows } from '../app/lib/stage3Rows';

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

check('阶段1 checkpoint 显示先确认再推进按钮', phaseConfirmationAction(1, 'confirmation', false) === 'CONFIRM_AND_ADVANCE');
check('阶段1确认书完成后按钮直接推进', phaseConfirmationAction(1, 'confirmation', true) === 'ADVANCE');
check('只有阶段1确认回复显示推进按钮', shouldOfferPhaseConfirmation(1, 'confirmation') && !shouldOfferPhaseConfirmation(2, 'confirmation'));
check('紧凑确认状态只保留研究问题正文', confirmationDocumentBody('《探究问题确认书》\n研究问题：光照') === '光照');

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
// v3 只按不同证据指纹计数，不信任 analysisCount
{
  const base: StageData = {
    contractMeta: { stageContractVersion: 'stage-contract-v3', extractorVersion: 'student-fact-extractor-v2', revision: 1, stateHash: 'x', lastMutation: 'test' },
    stage4: {
      analysisCount: 2,
      evidenceRounds: [
        { observation: 'a', citations: ['a'], matchedValues: ['1', '2'], roundFingerprint: 'same' },
        { observation: 'b', citations: ['b'], matchedValues: ['1', '2'], roundFingerprint: 'same' },
      ],
    },
  };
  check('4→5 v3 重复证据指纹不计两轮', canAdvance(4, 5, base).ok === false);
  base.stage4!.evidenceRounds![1].roundFingerprint = 'other';
  check('4→5 v3 两个不同证据指纹放行', canAdvance(4, 5, base).ok === true);
}
// 非逐阶段：3→5 拒绝
{
  check('3→5 跳级被拒', canAdvance(3, 5, {}).ok === false);
}
// 1→2：无 stage1 数据 → 拒绝
{
  check('1→2 无数据被拒', canAdvance(1, 2, {}).ok === false);
}
// 1→2：只需研究问题 + 与该问题绑定的明确确认
{
  const researchQuestion = '不同光照时长是否影响发芽率？';
  const sd: StageData = {
    stage1: { confirmed: true, snapshot: 'snap', researchQuestion, confirmedQuestionHash: researchQuestionHash(researchQuestion) },
  };
  check('1→2 已确认研究问题通过', canAdvance(1, 2, sd).ok === true);
}
// 1→2：旧字段齐全但没有研究问题确认哈希 → 拒绝
{
  const sd: StageData = {
    stage1: { confirmed: true, snapshot: 'snap', factorDirection: '光照', phenomenonDirection: '发芽', variables: { independent: '光照' } },
  };
  check('1→2 缺研究问题被拒', canAdvance(1, 2, sd).ok === false);
}
// 1→2：有研究问题但没有显式确认 → 拒绝
{
  const sd: StageData = { stage1: { confirmed: false, snapshot: '', researchQuestion: '光照是否影响发芽？' } };
  check('1→2 未明确确认被拒', canAdvance(1, 2, sd).ok === false);
}
// 1→2：变量、水平、测量等阶段2字段全部缺失仍可通过
{
  const researchQuestion = '纸桥形状是否影响承重？';
  const sd: StageData = { stage1: { confirmed: true, snapshot: 'snap', researchQuestion, confirmedQuestionHash: researchQuestionHash(researchQuestion) } };
  check('1→2 不要求阶段2字段', canAdvance(1, 2, sd).ok === true);
}
// 1→2：确认必须仍绑定到当前问题；已有但失配的哈希不能被兼容恢复重新确认
{
  const sd: StageData = {
    contractMeta: { stageContractVersion: 'stage-contract-v3', extractorVersion: 'student-fact-extractor-v2', revision: 1, stateHash: 'stale', lastMutation: 'test' },
    stage1: {
      confirmed: true,
      snapshot: 'snap',
      researchQuestion: '温度是否影响发芽率？',
      confirmedQuestionHash: researchQuestionHash('光照是否影响发芽率？'),
    },
  };
  check('1→2 拒绝与当前问题失配的确认哈希', canAdvance(1, 2, sd).ok === false);
  const recovered = recoverStageDataV3(sd).stageData;
  check('P1 兼容恢复不会重新绑定失配确认', recovered.stage1?.confirmed === false && !recovered.stage1.confirmedQuestionHash);
}
// 2→3 拒绝（由教师审核驱动）
{
  check('2→3 不走此操作被拒', canAdvance(2, 3, {}).ok === false);
}

// P3 行写入严格遵守冻结 schema
{
  const schema = schema2.stage2!.schema;
  check('P3 拒绝方案外列', !validateStage3Rows([{ trial: 1, height: 2, invented: 3 }], [], schema).ok);
  check('P3 拒绝数值列字符串', !validateStage3Rows([{ trial: '1', height: 2 }], [], schema).ok);
  check('P3 接受合法行', validateStage3Rows([{ trial: 1, height: 2, note: '正常' }], [], schema).ok);
}

// P4 重复序号本身不是科学证据，重复相同证据也不能累计
{
  const state: StageData = {
    stage2: { submitted: true, approved: true, schema: { columns: [
      { key: 'trial', title: '重复序号', type: 'number', required: true },
      { key: 'low', title: '低水平结果', type: 'number', required: true },
      { key: 'high', title: '高水平结果', type: 'number', required: true },
    ], minRows: 2, maxRows: 200 } },
    stage3: { rows: [{ trial: 1, low: 2, high: 7 }, { trial: 2, low: 3, high: 6 }] },
  };
  const indexOnly = updateServerAnalysis(state, '重复序号1比2小');
  check('P4 重复序号比较不算证据', !indexOnly.accepted && !indexOnly.stageData.stage4);
  const first = updateServerAnalysis(state, '第1行低水平结果2比高水平结果7低');
  const repeated = updateServerAnalysis(first.stageData, '第1行低水平结果2比高水平结果7低');
  check('P4 真实单元格证据可接受', first.accepted && first.stageData.stage4?.analysisCount === 1);
  check('P4 相同证据轮次去重', !repeated.accepted && repeated.duplicate && repeated.stageData.stage4?.analysisCount === 1);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
