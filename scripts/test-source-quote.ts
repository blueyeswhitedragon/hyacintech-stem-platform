/**
 * 确定性单测（无 LLM、无 DB）：引文定位 locateSourceQuote / locateSourceQuoteIn，
 * 以及它接入 validateExtractedFacts 后的效果。
 *
 * 背景：线上一名学生在第二阶段卡了 9 轮。他用 Markdown 写了完整的操作步骤与控制条件
 * （`**一、操作步骤**`），抽取器引用时吞掉了那对 `**`，后面 380 字逐字一致却整条被
 * SOURCE_QUOTE_NOT_FOUND_IN_STUDENT_MESSAGES 驳回。本文件把该事故固化为回归用例。
 *
 * 运行: npx tsx scripts/test-source-quote.ts
 */
import { locateSourceQuote, locateSourceQuoteIn } from '../app/lib/sourceQuote';
import { validateExtractedFacts } from '../app/lib/stateExtractor';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

console.log('\n[1] 严格逐字命中时行为不变');
{
  const message = '我打算比较 5、10、15、20 度四个坡度。';
  check('原样引用返回原样', locateSourceQuote(message, '比较 5、10、15、20 度') === '比较 5、10、15、20 度');
  check('引文两端空白被裁掉', locateSourceQuote(message, '  四个坡度  ') === '四个坡度');
  check('不存在的引文返回 null', locateSourceQuote(message, '我要测量温度') === null);
  check('空引文返回 null', locateSourceQuote(message, '   ') === null);
}

console.log('\n[2] Markdown 强调标记被吞掉时仍可定位，且回填学生原文');
{
  const message = '**一、操作步骤**\n\n1. **准备器材**：把木板一端垫高形成斜面。\n2. 调整坡度到 5°。';
  const located = locateSourceQuote(message, '一、操作步骤\n\n1. **准备器材**：把木板一端垫高形成斜面。');
  check('吞掉起始 ** 仍能定位', located !== null);
  // 关键：返回的是学生原文里的一段（保留其中的 **），不是模型改写过的版本。
  // 定位区间以非噪声字符起止，所以开头的 `**` 不在区间内，标题闭合的 `**` 在区间内。
  check('回填的是学生原文', located === '一、操作步骤**\n\n1. **准备器材**：把木板一端垫高形成斜面。');
  check('回填结果是原文的逐字子串', located !== null && message.includes(located));
  check('回填结果不以排版噪声起止', located !== null && !/^[*`~#>\s]|[*`~#>\s]$/.test(located));

  const tail = locateSourceQuote(message, '二、控制条件');
  check('反向哨兵：原文没有的小标题定位不到', tail === null);
}

console.log('\n[3] 其他排版噪声');
{
  const message = '# 我的方案\n\n> 每个坡度重复 `3` 次，取平均值。';
  check('井号/引用号/反引号被忽略', locateSourceQuote(message, '每个坡度重复 3 次') !== null);
  check('回填保留原文反引号', locateSourceQuote(message, '每个坡度重复 3 次') === '每个坡度重复 `3` 次');
  check('换行差异可容忍', locateSourceQuote('滑行距离\n从坡底量起', '滑行距离从坡底量起') === '滑行距离\n从坡底量起');
}

console.log('\n[4] 反向哨兵：放宽的只是排版，不是内容');
{
  const message = '我打算比较 5、10、15、20 度。';
  check('改数字不算命中', locateSourceQuote(message, '比较 5、10、15、25 度') === null);
  check('增字不算命中', locateSourceQuote(message, '我打算比较 5、10、15、20 度并测三次') === null);
  check('减号不属于噪声（步骤 3-4 不等于 34）', locateSourceQuote('重复步骤 34', '重复步骤 3-4') === null);
  check('跨消息拼接不算命中', locateSourceQuoteIn(['我要测坡度', '还要测距离'], '我要测坡度还要测距离') === null);
}

console.log('\n[5] 多条消息定位');
{
  const messages = ['我想改变坡度', '**控制条件**：同一辆小车，同一块木板。'];
  check('命中第二条并回填原文', locateSourceQuoteIn(messages, '控制条件：同一辆小车') === '控制条件**：同一辆小车');
  check('回填结果是该条消息的逐字子串', messages[1].includes(locateSourceQuoteIn(messages, '控制条件：同一辆小车')!));
  check('都不命中返回 null', locateSourceQuoteIn(messages, '我要测温度') === null);
}

console.log('\n[6] 事故回归：validateExtractedFacts 接受被吞掉 ** 的引文');
{
  // 学生原话（截自线上会话 ca977b81 的第 8 条消息，保留其 Markdown 排版）。
  const studentMessage = [
    '**一、操作步骤**',
    '',
    '1. **准备器材**：将木板一端垫高形成斜面；检查小车车轮转动顺畅。',
    '2. **调整坡度**：用量角器把夹角依次调整为 **5°、10°、15°、20°**。',
    '',
    '**二、控制条件（保持不变）**',
    '',
    '- **小车**：同一辆小车，质量、车型、车轮状态不变；',
    '- **释放方式**：每次从斜面**同一高度**由**静止释放**。',
  ].join('\n');

  // 模型给出的引文：吞掉了小标题两侧的 **，其余逐字一致——这正是线上被驳回的形状。
  const facts = [
    {
      field: 'stage2.procedure',
      value: ['准备器材：将木板一端垫高形成斜面', '调整坡度：用量角器把夹角依次调整为 5°、10°、15°、20°'],
      sourceQuote: '一、操作步骤\n\n1. **准备器材**：将木板一端垫高形成斜面；检查小车车轮转动顺畅。',
    },
    {
      field: 'stage2.controlledVariables',
      value: ['同一辆小车，质量、车型、车轮状态不变', '每次从斜面同一高度由静止释放'],
      sourceQuote: '二、控制条件（保持不变）\n\n- **小车**：同一辆小车，质量、车型、车轮状态不变；',
    },
  ];

  const result = validateExtractedFacts(2, facts, [studentMessage]);
  check('procedure 不再被驳回', result.accepted.some((f) => f.field === 'stage2.procedure'));
  check('controlledVariables 不再被驳回', result.accepted.some((f) => f.field === 'stage2.controlledVariables'));
  check('没有任何一条被驳回', result.rejected.length === 0);
  check(
    '入账的 sourceQuote 是学生原文（含 **）',
    result.accepted.every((f) => studentMessage.includes(f.sourceQuote)),
  );

  // 反向哨兵：模型把两段拼接、跳过中间内容（线上 materials 的真实形状），仍须驳回。
  const stitched = validateExtractedFacts(2, [{
    field: 'stage2.materials',
    value: ['木板', '量角器'],
    sourceQuote: '1. **准备器材**：将木板一端垫高形成斜面；检查小车车轮转动顺畅。\n- **小车**：同一辆小车',
  }], [studentMessage]);
  check(
    '反向哨兵：跨段拼接的引文仍被驳回',
    stitched.rejected.some((f) => f.reason === 'SOURCE_QUOTE_NOT_FOUND_IN_STUDENT_MESSAGES'),
  );

  // 反向哨兵：编造学生没说过的内容，不因放宽而通过。
  const fabricated = validateExtractedFacts(2, [{
    field: 'stage2.hypothesis',
    value: '坡度越大滑得越远',
    sourceQuote: '我猜坡度越大滑行距离越远',
  }], [studentMessage]);
  check(
    '反向哨兵：原文没有的引文仍被驳回',
    fabricated.rejected.some((f) => f.reason === 'SOURCE_QUOTE_NOT_FOUND_IN_STUDENT_MESSAGES'),
  );
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
