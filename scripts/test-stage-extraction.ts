/**
 * 确定性单测（无 LLM、无 DB）：
 *   - extractStageData 各阶段提取/推进逻辑
 *   - safeParseChatResponse 对结构化字段的透传与畸形丢弃
 * 运行: npx tsx scripts/test-stage-extraction.ts
 */
import { extractStageData } from '../app/lib/stageExtraction';
import { safeParseChatResponse } from '../app/lib/llm/parser';
import type { ChatResponse } from '../app/models/types';
import type { StageData } from '../app/models/stageData';

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

function base(extra: Partial<ChatResponse>): ChatResponse {
  return {
    dialogue: 'x',
    next_action_type: 'text_input',
    phase_complete: false,
    ...extra,
  };
}

console.log('extractStageData:');

// 1. stage1 确认 → 写 stage1，但不再自动推进（由确认按钮驱动）
{
  const r = extractStageData(
    1,
    base({
      stage1_confirmed: true,
      snapshot: '《确认书》正文',
      variables: { independent: '光照时长', dependent: '株高' },
    }),
    {}
  );
  check('stage1 确认写入 stage1', r.stageData.stage1?.confirmed === true && r.stageData.stage1?.variables.independent === '光照时长');
  check('stage1 确认不再自动推进', r.advanceTo === undefined);
}

// 2. stage1 缺 variables → 不写、不推进
{
  const r = extractStageData(1, base({ stage1_confirmed: true }), {});
  check('stage1 缺变量不写入', r.stageData.stage1 === undefined);
  check('stage1 缺变量不推进', r.advanceTo === undefined);
}

// 3. stage2 数据表 + 风险
{
  const r = extractStageData(
    2,
    base({
      data_table_schema: {
        columns: [{ key: 'trial', title: '次数', type: 'number', required: true }],
        minRows: 5,
        maxRows: 200,
      },
      risks: [{ columnKey: 'temp', description: '高温', severity: 'high' }],
    }),
    {}
  );
  check('stage2 写入 schema', r.stageData.stage2?.schema.columns[0].key === 'trial');
  check('stage2 写入风险', r.stageData.stage2?.aiRiskAnnotations?.[0].severity === 'high');
  check('stage2 默认未提交未审核', r.stageData.stage2?.submitted === false && r.stageData.stage2?.approved === null);
  check('stage2 不推进', r.advanceTo === undefined);
}

// 4. stage5 报告框架 → conclusion/reflection 空
{
  const r = extractStageData(
    5,
    base({
      report_sections: {
        purpose: '目的',
        hypothesis: '假设',
        materials: '材料',
        procedure: '步骤',
        dataSummary: '数据',
        analysis: '分析',
      },
    }),
    {}
  );
  check('stage5 写入 sections', r.stageData.stage5?.sections.purpose === '目的');
  check('stage5 conclusion/reflection 留空', r.stageData.stage5?.sections.conclusion === '' && r.stageData.stage5?.sections.reflection === '');
}

// 5. 无结构化字段 → 不变
{
  const prev: StageData = { stage1: { confirmed: true, snapshot: 's', variables: { independent: 'a', dependent: 'b' } } };
  const r = extractStageData(3, base({}), prev);
  check('无字段时 stageData 不变', JSON.stringify(r.stageData) === JSON.stringify(prev));
  check('无字段时不推进', r.advanceTo === undefined);
}

// 6. 阶段不匹配 → 忽略（stage 2 收到 stage1_confirmed）
{
  const r = extractStageData(2, base({ stage1_confirmed: true, variables: { independent: 'a', dependent: 'b' } }), {});
  check('阶段不匹配忽略 stage1', r.stageData.stage1 === undefined && r.advanceTo === undefined);
}

console.log('safeParseChatResponse 透传:');

// 7. 结构化字段透传
{
  const raw = JSON.stringify({
    dialogue: '好的',
    next_action_type: 'confirmation',
    phase_complete: false,
    stage1_confirmed: true,
    snapshot: 'snap',
    variables: { independent: '温度', dependent: '溶解速度' },
  });
  const p = safeParseChatResponse(raw);
  check('透传 stage1_confirmed', p.stage1_confirmed === true);
  check('透传 variables', p.variables?.dependent === '溶解速度');
}

// 8. 畸形 safety_quiz（correct 越界）被丢弃
{
  const raw = JSON.stringify({
    dialogue: 'q',
    next_action_type: 'ask_choice',
    phase_complete: false,
    safety_quiz: { question: 'q', options: ['A', 'B'], correct: 5 },
  });
  const p = safeParseChatResponse(raw);
  check('畸形 safety_quiz 被丢弃', p.safety_quiz === undefined);
}

// 9. 合法 safety_quiz 透传
{
  const raw = JSON.stringify({
    dialogue: 'q',
    next_action_type: 'ask_choice',
    phase_complete: false,
    safety_quiz: { question: '用电安全?', options: ['电池', '市电'], correct: 0 },
  });
  const p = safeParseChatResponse(raw);
  check('合法 safety_quiz 透传', p.safety_quiz?.correct === 0 && p.safety_quiz?.options.length === 2);
}

// 10. data_table_schema 含非法列被过滤后仍保留有效列
{
  const raw = JSON.stringify({
    dialogue: 'd',
    next_action_type: 'text_input',
    phase_complete: false,
    data_table_schema: {
      columns: [
        { key: 'k1', title: 't1', type: 'number', required: true },
        { key: 'bad', title: 'x', type: 'weird' },
      ],
      minRows: 3,
      maxRows: 50,
    },
  });
  const p = safeParseChatResponse(raw);
  check('非法列被过滤', p.data_table_schema?.columns.length === 1 && p.data_table_schema?.columns[0].key === 'k1');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
