/**
 * 直接调用已配置的 LLM，测试六阶段 prompt 的格式遵从度和教学质量。
 * 用法: npx tsx scripts/test-llm-quality.ts
 */

import { getPromptForPhase } from '../app/prompts/index';
import { safeParseChatResponse } from '../app/lib/llm/parser';
import { PhaseEnum, ChatResponse } from '../app/models/types';
import { createLLMProvider } from '../app/lib/llm/provider';
import { LLMMessage } from '../app/lib/llm/types';

const provider = createLLMProvider();

async function callOnce(
  systemPrompt: string,
  userMsg: string,
  history: LLMMessage[] = [],
  useJson = true
): Promise<{ raw: string; parsed: ChatResponse; parseOk: boolean }> {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMsg },
  ];
  const raw = await provider.chat(messages, { useJsonFormat: useJson });
  const parsed = safeParseChatResponse(raw);
  const FALLBACKS = [
    '抱歉，AI服务返回了空内容，请重试。',
    '抱歉，AI回复格式出现异常，请重试。',
    '抱歉，我暂时无法处理您的请求，请重新描述您的问题。',
  ];
  const parseOk = !FALLBACKS.includes(parsed.dialogue);
  return { raw, parsed, parseOk };
}

interface TestResult {
  phase: number;
  turn: number;
  userMsg: string;
  parseOk: boolean;
  actionType: string;
  hasHints: boolean;
  hasOptions: boolean;
  dialogueSnippet: string;
  structuredFields: string[];
  rawLength: number;
}

const results: TestResult[] = [];

function record(phase: number, turn: number, userMsg: string, raw: string, parsed: ChatResponse, parseOk: boolean) {
  const structured: string[] = [];
  if (parsed.stage1_confirmed) structured.push('stage1_confirmed');
  if (parsed.snapshot) structured.push('snapshot');
  if (parsed.variables) structured.push('variables');
  if (parsed.data_table_schema) structured.push('data_table_schema');
  if (parsed.risks) structured.push('risks');
  if (parsed.safety_quiz) structured.push('safety_quiz');
  if (parsed.report_sections) structured.push('report_sections');

  const r: TestResult = {
    phase,
    turn,
    userMsg: userMsg.slice(0, 60),
    parseOk,
    actionType: parsed.next_action_type,
    hasHints: !!(parsed.hints && parsed.hints.length > 0),
    hasOptions: !!(parsed.options && parsed.options.length > 0),
    dialogueSnippet: parsed.dialogue.slice(0, 80),
    structuredFields: structured,
    rawLength: raw.length,
  };
  results.push(r);

  const status = parseOk ? '✓' : '✗';
  console.log(`  [${status}] Phase ${phase} Turn ${turn} | action=${r.actionType} | hints=${r.hasHints} | opts=${r.hasOptions} | fields=[${structured.join(',')}]`);
  console.log(`      dialogue: ${r.dialogueSnippet}...`);
  if (!parseOk) {
    console.log(`      RAW (first 200): ${raw.slice(0, 200)}`);
  }
}

async function testPhase1() {
  console.log('\n=== Phase 1: 选题定向 ===');
  const prompt = getPromptForPhase(PhaseEnum.TopicSelection);
  const history: LLMMessage[] = [];

  // Turn 1: student expresses interest
  const t1 = await callOnce(prompt, '我对植物生长很感兴趣，想研究光照对植物的影响', history);
  record(1, 1, '我对植物生长很感兴趣', t1.raw, t1.parsed, t1.parseOk);
  history.push({ role: 'user', content: '我对植物生长很感兴趣，想研究光照对植物的影响' });
  history.push({ role: 'assistant', content: t1.raw });

  // Turn 2: student narrows down
  const t2 = await callOnce(prompt, '我想研究不同颜色的光对绿豆发芽速度的影响', history);
  record(1, 2, '不同颜色的光对绿豆发芽速度的影响', t2.raw, t2.parsed, t2.parseOk);
  history.push({ role: 'user', content: '我想研究不同颜色的光对绿豆发芽速度的影响' });
  history.push({ role: 'assistant', content: t2.raw });

  // Turn 3: student confirms variables
  const t3 = await callOnce(prompt, '自变量是光的颜色（红、蓝、绿、白），因变量是绿豆发芽的天数，控制变量是温度、水量、绿豆品种', history);
  record(1, 3, '自变量是光的颜色...', t3.raw, t3.parsed, t3.parseOk);

  return { prompt, history, lastParsed: t3.parsed };
}

async function testPhase2() {
  console.log('\n=== Phase 2: 方案设计 ===');
  const prompt = getPromptForPhase(PhaseEnum.PlanDesign);
  const history: LLMMessage[] = [];

  const t1 = await callOnce(prompt, '我要设计实验方案。我的课题是研究不同颜色光对绿豆发芽速度的影响。自变量是光的颜色，因变量是发芽天数。', history);
  record(2, 1, '设计实验方案...', t1.raw, t1.parsed, t1.parseOk);
  history.push({ role: 'user', content: '我要设计实验方案。' });
  history.push({ role: 'assistant', content: t1.raw });

  const t2 = await callOnce(prompt, '每组10颗绿豆，放在相同的培养皿里，用不同颜色的LED灯照射，每天观察记录发芽情况，实验做7天', history);
  record(2, 2, '每组10颗绿豆...', t2.raw, t2.parsed, t2.parseOk);

  return { lastParsed: t2.parsed };
}

async function testPhase4WithData() {
  console.log('\n=== Phase 4: 数据分析 (with injected data) ===');
  const context = {
    dataRows: [
      { light_color: '红光', day1: '0/10', day2: '1/10', day3: '3/10', day4: '5/10', day5: '7/10', day6: '8/10', day7: '9/10' },
      { light_color: '蓝光', day1: '0/10', day2: '2/10', day3: '4/10', day4: '6/10', day5: '8/10', day6: '9/10', day7: '10/10' },
      { light_color: '绿光', day1: '0/10', day2: '0/10', day3: '1/10', day4: '2/10', day5: '4/10', day6: '5/10', day7: '6/10' },
      { light_color: '白光', day1: '0/10', day2: '1/10', day3: '3/10', day4: '5/10', day5: '7/10', day6: '9/10', day7: '10/10' },
    ],
  };
  const prompt = getPromptForPhase(PhaseEnum.DataAnalysis, context);

  const t1 = await callOnce(prompt, '这是我收集的数据，请帮我分析', []);
  record(4, 1, '帮我分析数据', t1.raw, t1.parsed, t1.parseOk);
}

async function testPhase5WithSummary() {
  console.log('\n=== Phase 5: 报告成型 (with priorSummary) ===');
  const context = {
    priorSummary: `【选题确认书】
研究不同颜色光对绿豆发芽速度的影响
自变量：光的颜色（红、蓝、绿、白），因变量：发芽天数，控制变量：温度、水量、绿豆品种

【实验方案-数据表列】光的颜色(text)、第1天(text)、第2天(text)、第3天(text)、第4天(text)、第5天(text)、第6天(text)、第7天(text)、备注(text)，最少3行，最多200行

【实验数据-共4行】
光的颜色 | 第1天 | 第2天 | 第3天 | 第4天 | 第5天 | 第6天 | 第7天
1. 红光 | 0/10 | 1/10 | 3/10 | 5/10 | 7/10 | 8/10 | 9/10
2. 蓝光 | 0/10 | 2/10 | 4/10 | 6/10 | 8/10 | 9/10 | 10/10
3. 绿光 | 0/10 | 0/10 | 1/10 | 2/10 | 4/10 | 5/10 | 6/10
4. 白光 | 0/10 | 1/10 | 3/10 | 5/10 | 7/10 | 9/10 | 10/10`,
  };
  const prompt = getPromptForPhase(PhaseEnum.ResultsFormation, context);

  const t1 = await callOnce(prompt, '开始报告成型', []);
  record(5, 1, '开始报告成型', t1.raw, t1.parsed, t1.parseOk);

  if (t1.parsed.report_sections) {
    const s = t1.parsed.report_sections;
    console.log('    report_sections fields present:');
    for (const [k, v] of Object.entries(s)) {
      const val = typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60);
      console.log(`      ${k}: ${val}...`);
    }
  }
}

async function main() {
  console.log('LLM Quality Test — testing DeepSeek response format compliance and teaching quality\n');

  try {
    await testPhase1();
    await testPhase2();
    await testPhase4WithData();
    await testPhase5WithSummary();
  } catch (e: unknown) {
    console.error('LLM call failed:', e instanceof Error ? e.message : e);
  }

  console.log('\n\n=== SUMMARY ===');
  const total = results.length;
  const jsonOk = results.filter((r) => r.parseOk).length;
  const withHints = results.filter((r) => r.hasHints).length;
  const withOptions = results.filter((r) => r.hasOptions).length;
  const withStructured = results.filter((r) => r.structuredFields.length > 0).length;

  console.log(`JSON parse success: ${jsonOk}/${total} (${((jsonOk / total) * 100).toFixed(0)}%)`);
  console.log(`Has hints: ${withHints}/${total}`);
  console.log(`Has options: ${withOptions}/${total}`);
  console.log(`Has structured fields: ${withStructured}/${total}`);
  console.log(`Action types: ${results.map((r) => r.actionType).join(', ')}`);

  for (const r of results) {
    if (!r.parseOk) {
      console.log(`\n  FAILED: Phase ${r.phase} Turn ${r.turn}: ${r.userMsg}`);
    }
  }
}

main();
