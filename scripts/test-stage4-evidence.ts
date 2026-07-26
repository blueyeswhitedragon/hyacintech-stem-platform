/**
 * 确定性单测：P4 证据判定（无 LLM、无 DB）。
 * 运行: npx tsx scripts/test-stage4-evidence.ts
 *
 * 固化的事故用例来自一次体验模式实跑：纸桥承重实验，方形 vs 圆形各 3 次，
 * 整张表只有 10 和 15 两个取值。修正前 11 轮全拒、analysisCount 恒为 0。
 */
import { expressesComparison, updateServerAnalysis } from '../app/lib/serverTutorState';
import { validateAnalysisClaim } from '../app/lib/analysisClaimExtractor';
import { canAdvance } from '../app/lib/stageAdvance';
import { describeStage4LastRound, evaluateStage4Readiness } from '../app/lib/stage4Readiness';
import type { StageData } from '../app/models/stageData';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function paperBridgeState(): StageData {
  return {
    stage2: {
      submitted: true,
      approved: true,
      schema: {
        columns: [
          { key: 'trial', title: '重复序号', type: 'number', required: true },
          { key: 'result_a', title: '方形：最大承重（克）', type: 'number', required: true },
          { key: 'result_b', title: '圆形：最大承重（克）', type: 'number', required: true },
          { key: 'notes', title: '客观异常备注', type: 'text', required: false },
        ],
        minRows: 3,
        maxRows: 200,
      },
    },
    stage3: {
      submitted: true,
      rows: [
        { trial: 1, result_a: 10, result_b: 15, notes: '' },
        { trial: 2, result_a: 15, result_b: 15, notes: '' },
        { trial: 3, result_a: 10, result_b: 15, notes: '' },
      ],
    },
  };
}

// 1. expressesComparison 正例
console.log('\n[1] 比较判定 · 正例');
for (const text of [
  '圆形平均承重（15 克）大于方形平均承重（11.7 克）',
  '圆形的桥承重能力更强',
  '第二次的 15 超过第一次的 10',
  '两次结果一样',
  '方形 10 不如圆形 15',
  '第1行低水平结果2比高水平结果7低',
  '第5次记录中 13.6，8小时为 9.2，前者比后者高 4.4',
  '两组数据相同',
  '圆形承重是方形的 1.5 倍',
  '圆形比方形高',
]) {
  check(`命中：${text.slice(0, 22)}`, expressesComparison(text));
}

// 2. expressesComparison 反例（反向哨兵：裸「比」不再吃掉非比较句）
console.log('\n[2] 比较判定 · 反例');
for (const text of [
  '可能第二次叠的比较认真',
  '比如说这次纸桥搭得不太稳',
  '好比方形和圆形都是纸做的',
  '比方说这次纸桥搭得不太稳',
  '我记录了三次实验的数据',
  '不对，应该是11.7',
]) {
  check(`不命中：${text.slice(0, 22)}`, !expressesComparison(text));
}

// 3. 事故重放：11 条原话逐条判定
console.log('\n[3] 纸桥低基数表 · 11 条原话重放');
{
  const original = [
    '显然，圆形的桥承重能力更强',
    '最大承重都是15，但是圆形始终大于等于方形，应该是圆形更能抗一点',
    '第一次是10和15',
    '2    15    15    —',
    '3    3    10    15',
    '13.5 15，圆形平均承重更强',
    '不对，应该是11.7',
    '因为圆形平均承重（15 克）大于方形平均承重（11.7 克），所以圆形截面的纸桥承重能力更强。',
    '说明实验过程中不同的折叠动作可能导致了差异，实验数据有波动',
    '可能第二次叠的比较认真',
    '第二次是15，另外两次是10',
  ];
  // 修正前这 11 轮全部落在「无比较词」或「证据不足」上且不给任何解释；
  // 修正后第 2 条（真实的「大于」论证）计入，其余每条都能说清差在哪一半。
  const expected: Array<[boolean, string | null]> = [
    [false, 'NO_EVIDENCE'],
    [true, null],
    [false, 'NO_COMPARISON'],
    [false, 'NO_COMPARISON'],
    [false, 'NO_COMPARISON'],
    [false, 'NO_NEW_EVIDENCE'],
    [false, 'NO_EVIDENCE'],
    [false, 'NO_NEW_EVIDENCE'],
    [false, 'NO_EVIDENCE'],
    [false, 'NO_EVIDENCE'],
    [false, 'NO_COMPARISON'],
  ];
  let state = paperBridgeState();
  original.forEach((message, index) => {
    const result = updateServerAnalysis(state, message);
    state = result.stageData;
    const [wantAccepted, wantRejection] = expected[index];
    check(
      `第${index + 1}轮 ${wantAccepted ? '计入' : wantRejection}：${message.slice(0, 18)}`,
      result.accepted === wantAccepted && result.rejection === wantRejection,
    );
  });
  check('11 轮原话共计入 1 轮', state.stage4?.analysisCount === 1);
  check('仍未满足 4→5 门禁', !canAdvance(4, 5, state, { safetyQuizCompleted: true }).ok);
  check('每轮都留下可解释的判定', Boolean(describeStage4LastRound(state.stage4)));
}

// 4. 规范话术两轮即可脱困（同一张低基数表）
console.log('\n[4] 纸桥低基数表 · 规范话术脱困');
{
  let state = paperBridgeState();
  const first = updateServerAnalysis(state, '第一次方形的最大承重是10克，第一次圆形的最大承重是15克，圆形比方形高5克。');
  state = first.stageData;
  const second = updateServerAnalysis(state, '第二次方形是15克，第二次圆形也是15克，这两个结果相同。');
  state = second.stageData;
  check('第一轮计入', first.accepted && first.rejection === null);
  check('第一轮只归属被点名的第 1 行（2 格，不是整表 6 格）',
    (first.stageData.stage4?.evidenceRounds?.[0].evidence ?? []).length === 2);
  check('第二轮取值与首轮完全相同，但单元格是新的，仍计入', second.accepted);
  check('就绪度 2/2', evaluateStage4Readiness(state).acceptedRoundCount === 2);
  check('可进入 P5', canAdvance(4, 5, state, { safetyQuizCompleted: true }).ok);
}

// 5. ⑮b 逐格行约束
console.log('\n[5] 逐格行约束');
{
  const base = paperBridgeState();
  const single = updateServerAnalysis(base, '第三次方形是10，圆形是15，圆形更高。');
  const cells = single.stageData.stage4?.evidenceRounds?.[0].evidence ?? [];
  check('点名单行时只记该行的格', cells.length === 2 && cells.every((item) => item.rowIndex === 2));

  const multi = updateServerAnalysis(base, '第一次方形10比圆形15低，第二次方形15与圆形15相同。');
  const multiCells = multi.stageData.stage4?.evidenceRounds?.[0].evidence ?? [];
  check('点名多行时取并集', new Set(multiCells.map((item) => item.rowIndex)).size === 2);

  // 反向哨兵：不点行号时维持原有歧义判定，不因为本次改动放宽
  const unanchored = updateServerAnalysis(base, '方形和圆形的最大承重分别是10和15，圆形更高。');
  check('不点行号时仍走原歧义判定', (unanchored.stageData.stage4?.evidenceRounds?.[0].evidence ?? []).length > 2);
}

// 6. ⑮c 单调去重
console.log('\n[6] 单调去重');
{
  const base = paperBridgeState();
  const first = updateServerAnalysis(base, '第一次方形是10，圆形是15，圆形更高。');
  const superset = updateServerAnalysis(first.stageData, '第一次方形10圆形15，第三次方形10圆形15，两次相同。');
  check('取值集合相同但含新单元格 → 接受', superset.accepted && superset.rejection === null);

  const repeat = updateServerAnalysis(superset.stageData, '第一次方形是10，圆形是15，圆形更高。');
  check('完全没有新单元格 → NO_NEW_EVIDENCE', !repeat.accepted && repeat.rejection === 'NO_NEW_EVIDENCE' && repeat.duplicate);
  check('被拒不改变已接受计数', repeat.stageData.stage4?.analysisCount === 2);
  check('前后端进度一致', evaluateStage4Readiness(repeat.stageData).acceptedRoundCount === 2);
}

// 7. ⑮d 四种未计入原因各一例
console.log('\n[7] 逐轮未计入原因');
{
  const base = paperBridgeState();
  const noEvidence = updateServerAnalysis(base, '我觉得圆形更强。');
  check('NO_EVIDENCE', noEvidence.rejection === 'NO_EVIDENCE');

  const singleEvidence = updateServerAnalysis(base, '第一次方形是10，比我预想的低。');
  check('SINGLE_EVIDENCE', singleEvidence.rejection === 'SINGLE_EVIDENCE'
    && singleEvidence.stageData.stage4?.lastRound?.evidenceCount === 1);

  const noComparison = updateServerAnalysis(base, '第一次方形是10，圆形是15。');
  check('NO_COMPARISON', noComparison.rejection === 'NO_COMPARISON');

  const accepted = updateServerAnalysis(base, '第一次方形是10，圆形是15，圆形更高。');
  const noNew = updateServerAnalysis(accepted.stageData, '第一次方形是10，圆形是15，圆形更高。');
  check('NO_NEW_EVIDENCE', noNew.rejection === 'NO_NEW_EVIDENCE');

  check('接受轮不带未计入原因', accepted.rejection === null && accepted.stageData.stage4?.lastRound?.accepted === true);
  check('未计入原因可渲染为学生可读文案', (describeStage4LastRound(noComparison.stageData.stage4) ?? '').includes('比较'));
}

// 8. 反向哨兵：伪造、只报行号、复读一律不计数
console.log('\n[8] 反向哨兵');
{
  const base = paperBridgeState();
  const fabricated = updateServerAnalysis(base, '第一次方形是22克，圆形是37克，圆形比方形高很多。');
  check('编造表中不存在的数值不计数', !fabricated.accepted && fabricated.rejection === 'NO_EVIDENCE');

  // 编造值 + 夹带一个真值也只按真值算，凑不满两格
  const halfFabricated = updateServerAnalysis(base, '第一次方形是22克，圆形是15克，圆形更高。');
  check('编造值夹带真值仍只算真值', !halfFabricated.accepted && halfFabricated.rejection === 'SINGLE_EVIDENCE');

  const rowOnly = updateServerAnalysis(base, '第一行比第三行高。');
  check('只报行号不计数', !rowOnly.accepted && rowOnly.rejection === 'NO_EVIDENCE');

  const indexOnly = updateServerAnalysis(base, '重复序号1比2小。');
  check('序号列不算证据', !indexOnly.accepted && (indexOnly.stageData.stage4?.evidenceRounds ?? []).length === 0);

  let replay = paperBridgeState();
  for (let i = 0; i < 3; i += 1) {
    replay = updateServerAnalysis(replay, '第一次方形是10，圆形是15，圆形更高。').stageData;
  }
  check('原样复读三次只计一轮', replay.stage4?.analysisCount === 1);
  check('复读后仍不能推进', !canAdvance(4, 5, replay, { safetyQuizCompleted: true }).ok);
}

// 9. ⑯ validateAnalysisClaim：模型只负责语言理解，事实核验仍在服务器
console.log('\n[9] 分析主张核验');
{
  const base = paperBridgeState();
  const message = '第一次方形是10克，第一次圆形是15克，圆形比方形高。';
  const claim = (
    citations: Array<{ rowNumber: number; columnTitle: string; value: string; sourceQuote: string }>,
    comparison = { isComparison: true, sourceQuote: '圆形比方形高' },
  ) => validateAnalysisClaim(base, message, { citations, comparison });

  const good = claim([
    { rowNumber: 1, columnTitle: '方形：最大承重（克）', value: '10', sourceQuote: '第一次方形是10克' },
    { rowNumber: 1, columnTitle: '圆形：最大承重（克）', value: '15', sourceQuote: '第一次圆形是15克' },
  ]);
  check('合法主张解析到真实单元格', good.citations.length === 2
    && good.citations.every((item) => item.rowIndex === 0)
    && good.citations.map((item) => item.columnKey).join(',') === 'result_a,result_b');
  check('合法主张的比较被采信', good.comparison && good.comparisonRejection === null);

  const aliased = claim([{ rowNumber: 1, columnTitle: '方形', value: '10', sourceQuote: '第一次方形是10克' }]);
  check('列名可按别名解析', aliased.citations[0]?.columnKey === 'result_a');

  const reasonOf = (
    citation: { rowNumber: number; columnTitle: string; value: string; sourceQuote: string },
  ) => claim([citation]).rejected[0]?.reason;

  check('引文不在原文中被驳回',
    reasonOf({ rowNumber: 1, columnTitle: '方形：最大承重（克）', value: '10', sourceQuote: '第一次方形是十克' })
      === 'SOURCE_QUOTE_NOT_FOUND_IN_STUDENT_MESSAGES');
  check('表里没有的列被驳回',
    reasonOf({ rowNumber: 1, columnTitle: '三角形承重', value: '10', sourceQuote: '第一次方形是10克' })
      === 'COLUMN_NOT_IN_LOCKED_SCHEMA');
  check('序号列不算证据',
    reasonOf({ rowNumber: 1, columnTitle: '重复序号', value: '1', sourceQuote: '第一次方形是10克' })
      === 'INDEX_COLUMN_IS_NOT_EVIDENCE');
  check('行号越界被驳回',
    reasonOf({ rowNumber: 9, columnTitle: '方形：最大承重（克）', value: '10', sourceQuote: '第一次方形是10克' })
      === 'ROW_NOT_IN_SUBMITTED_DATA');
  check('行列与取值对不上被驳回',
    reasonOf({ rowNumber: 1, columnTitle: '方形：最大承重（克）', value: '15', sourceQuote: '第一次圆形是15克' })
      === 'VALUE_DOES_NOT_MATCH_SUBMITTED_CELL');
  check('取值不在自己给的引文里被驳回',
    reasonOf({ rowNumber: 1, columnTitle: '方形：最大承重（克）', value: '10', sourceQuote: '圆形比方形高' })
      === 'VALUE_NOT_IN_SOURCE_QUOTE');
  check('10 与 10.0 视为同一个格',
    claim([{ rowNumber: 1, columnTitle: '方形：最大承重（克）', value: '10.0', sourceQuote: '第一次方形是10克' }])
      .citations.length === 1);

  const notComparison = claim([], { isComparison: false, sourceQuote: '' });
  check('模型说不是比较时记录原因', !notComparison.comparison
    && notComparison.comparisonRejection === 'MODEL_SAYS_NOT_A_COMPARISON');
  const fakeComparisonQuote = claim([], { isComparison: true, sourceQuote: '圆形远远超过方形' });
  check('比较引文不在原文中被驳回', !fakeComparisonQuote.comparison
    && fakeComparisonQuote.comparisonRejection === 'SOURCE_QUOTE_NOT_FOUND_IN_STUDENT_MESSAGES');
}

// 10. ⑯ 主张接入门禁：提高精度与召回，但不稀释「值必须真实存在」
console.log('\n[10] 主张接入 updateServerAnalysis');
{
  const base = paperBridgeState();

  // 事故原话第 11 条：确定性谓词看不出这是比较，模型能看出来
  const implicit = '第二次是15，另外两次是10';
  const implicitClaim = validateAnalysisClaim(base, implicit, {
    citations: [
      { rowNumber: 2, columnTitle: '方形：最大承重（克）', value: '15', sourceQuote: '第二次是15' },
      { rowNumber: 1, columnTitle: '方形：最大承重（克）', value: '10', sourceQuote: '另外两次是10' },
    ],
    comparison: { isComparison: true, sourceQuote: '第二次是15，另外两次是10' },
  });
  check('确定性谓词判不出这句是比较', !expressesComparison(implicit));
  const rescued = updateServerAnalysis(base, implicit, implicitClaim);
  check('模型判定让隐式比较得以计入', rescued.accepted && rescued.rejection === null);
  check('采信的是抽取器给的逐格引用', rescued.signals.evidenceSource === 'extractor'
    && rescued.signals.claimComparison === true
    && rescued.signals.deterministicComparison === false);

  // 反向哨兵：主张全被驳回时回落确定性路径，判定与不传主张时完全一致
  const fabricatedClaim = validateAnalysisClaim(base, implicit, {
    citations: [{ rowNumber: 1, columnTitle: '方形：最大承重（克）', value: '99', sourceQuote: '第二次是15' }],
    comparison: { isComparison: false, sourceQuote: '' },
  });
  const fellBack = updateServerAnalysis(base, implicit, fabricatedClaim);
  const noClaim = updateServerAnalysis(base, implicit);
  check('主张全被驳回时回落确定性路径', fellBack.rejection === noClaim.rejection
    && fellBack.signals.evidenceSource === 'deterministic');
  check('抽取器不可用（claim=null）时判定不变', updateServerAnalysis(base, implicit, null).rejection === noClaim.rejection);

  // 反向哨兵：模型说在比较，但只对上 1 个真单元格 —— 门禁不被稀释
  const oneCell = '第一次方形是10克，比我预想的低很多';
  const oneCellClaim = validateAnalysisClaim(base, oneCell, {
    citations: [{ rowNumber: 1, columnTitle: '方形：最大承重（克）', value: '10', sourceQuote: '第一次方形是10克' }],
    comparison: { isComparison: true, sourceQuote: '比我预想的低很多' },
  });
  const stillSingle = updateServerAnalysis(base, oneCell, oneCellClaim);
  check('模型判比较也凑不出第二个单元格', !stillSingle.accepted && stillSingle.rejection === 'SINGLE_EVIDENCE');

  // 反向哨兵：整条消息的数值全是编造的，模型说得再肯定也不计数
  const fabricatedMessage = '第一次方形是22克，圆形是37克，圆形比方形高很多。';
  const allFabricated = validateAnalysisClaim(base, fabricatedMessage, {
    citations: [
      { rowNumber: 1, columnTitle: '方形：最大承重（克）', value: '22', sourceQuote: '第一次方形是22克' },
      { rowNumber: 1, columnTitle: '圆形：最大承重（克）', value: '37', sourceQuote: '圆形是37克' },
    ],
    comparison: { isComparison: true, sourceQuote: '圆形比方形高很多' },
  });
  check('编造值的主张整条丢弃', allFabricated.citations.length === 0 && allFabricated.rejected.length === 2);
  const fabricatedRound = updateServerAnalysis(base, fabricatedMessage, allFabricated);
  check('编造值仍不计数', !fabricatedRound.accepted && fabricatedRound.rejection === 'NO_EVIDENCE');

  // 反向哨兵：模型判「不是比较」不得让门禁比确定性规则更严
  const explicit = '第一次方形是10克，第一次圆形是15克，圆形比方形高。';
  const denied = validateAnalysisClaim(base, explicit, {
    citations: [
      { rowNumber: 1, columnTitle: '方形：最大承重（克）', value: '10', sourceQuote: '第一次方形是10克' },
      { rowNumber: 1, columnTitle: '圆形：最大承重（克）', value: '15', sourceQuote: '第一次圆形是15克' },
    ],
    comparison: { isComparison: false, sourceQuote: '' },
  });
  const stillAccepted = updateServerAnalysis(base, explicit, denied);
  check('模型否认比较不会追溯性收紧门禁', stillAccepted.accepted
    && stillAccepted.signals.deterministicComparison && stillAccepted.signals.claimComparison === false);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
