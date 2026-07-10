/**
 * 多轮 LLM 质量测试：用剧本驱动的模拟学生跑完 阶段1→2→4→5，
 * 并用自动规则检查器对每条回复打分（复现朋友多轮裸测发现的 8 类问题）。
 *
 * 用法: set -a && source .env && set +a && npx tsx scripts/test-llm-quality-multiturn.ts
 *
 * 输出的各项通过率即微调 before/after 的定量基线。
 */

import { getPromptForPhase, type PromptContext } from '../app/prompts/index';
import { safeParseChatResponse } from '../app/lib/llm/parser';
import { shouldNudgeConvergence } from '../app/lib/pacing';
import { PhaseEnum, ChatResponse } from '../app/models/types';
import { createLLMProvider } from '../app/lib/llm/provider';
import { LLMMessage } from '../app/lib/llm/types';

const provider = createLLMProvider();

const FALLBACKS = [
  '抱歉，AI服务返回了空内容，请重试。',
  '抱歉，AI回复格式出现异常，请重试。',
  '抱歉，我暂时无法处理您的请求，请重新描述您的问题。',
];

// ---------- 规则检查器 ----------

interface Violation {
  rule: string;
  detail: string;
}

interface TurnRecord {
  persona: string;
  phase: number;
  turn: number;
  userMsg: string;
  parseOk: boolean;
  actionType: string;
  violations: Violation[];
  dialogueSnippet: string;
}

/** 规则1：markdown 排版 —— ** 必须成对且 ≤4 处；禁止 #标题/列表符/代码块 */
function checkMarkdown(dialogue: string): Violation[] {
  const v: Violation[] = [];
  const starCount = (dialogue.match(/\*\*/g) ?? []).length;
  if (starCount % 2 !== 0) v.push({ rule: 'md-unpaired-bold', detail: `**出现${starCount}次（奇数，未配对）` });
  if (starCount / 2 > 4) v.push({ rule: 'md-too-many-bold', detail: `加粗${starCount / 2}处 > 4` });
  // 单个 * 开头的列表符（排除 ** 情况）
  if (/(^|\n)\s*[-*]\s+(?!\*)/.test(dialogue.replace(/\*\*[^*]+\*\*/g, ''))) {
    v.push({ rule: 'md-list-marker', detail: '使用了 - 或 * 列表符号' });
  }
  if (/(^|\n)\s*#{1,6}\s/.test(dialogue)) v.push({ rule: 'md-heading', detail: '使用了 # 标题' });
  if (dialogue.includes('```')) v.push({ rule: 'md-codeblock', detail: '使用了代码块' });
  return v;
}

/** 规则2：options 字段纪律 —— 非空必须 ask_choice 且每项 ≤15 字 */
function checkOptions(r: ChatResponse): Violation[] {
  const v: Violation[] = [];
  if (r.options && r.options.length > 0) {
    if (r.next_action_type !== 'ask_choice') {
      v.push({ rule: 'options-wrong-action', detail: `options非空但 action=${r.next_action_type}（引导语应放hints）` });
    }
    for (const opt of r.options) {
      if (opt.length > 15) {
        v.push({ rule: 'options-too-long', detail: `选项超15字："${opt.slice(0, 25)}…"（疑似引导语混入）` });
        break;
      }
    }
  }
  return v;
}

function stage1VisibleText(r: ChatResponse): string {
  return [r.dialogue, ...(r.hints ?? []), ...(r.options ?? [])].join('\n');
}

function checkStage1AntiChoice(r: ChatResponse): Violation[] {
  const v: Violation[] = [];
  const text = stage1VisibleText(r);
  if (r.next_action_type === 'ask_choice' || (r.options?.length ?? 0) > 0) {
    v.push({ rule: 'p1-hidden-abc-options', detail: '阶段1使用 ask_choice/options，容易把启发变成选项题' });
  }
  if (
    /生命怎么生存|物体怎么运动|材料怎么保护人|设备怎么自动工作/.test(text) ||
    /光照时间|光的颜色|光的强弱/.test(text) ||
    /你.*(更)?(想|感兴趣).*还是.*还是/.test(text)
  ) {
    v.push({ rule: 'p1-hidden-abc-options', detail: '出现隐藏 ABC 式提问' });
  }
  return v;
}

function checkReadyMadeTopicList(r: ChatResponse): Violation[] {
  const text = stage1VisibleText(r);
  if (r.stage1_confirmed) return [];
  if (
    /(可以|建议)[\s\S]*(研究|选择)[\s\S]*(①|1\.|一是|首先)[\s\S]*(②|2\.|二是|其次)/.test(text) ||
    /(几个|2-3个|三[个种]).*(课题|方向|选题)/.test(text)
  ) {
    return [{ rule: 'p1-ready-made-topic-list', detail: '阶段1给出成组选题方向，削弱学生自己的转化过程' }];
  }
  return [];
}

function checkThemeMapping(r: ChatResponse): Violation[] {
  if (!r.stage1_confirmed) return [];
  const m = r.theme_mapping;
  if (!m) return [{ rule: 'p1-missing-theme-mapping', detail: '阶段1确认缺少 theme_mapping 转化链' }];
  const missing = [
    ['originalInterest', m.originalInterest],
    ['retainedFeature', m.retainedFeature],
    ['classroomProxy', m.classroomProxy],
    ['researchQuestion', m.researchQuestion],
  ].filter(([, value]) => !String(value).trim());
  if (missing.length > 0) {
    return [{ rule: 'p1-missing-theme-mapping', detail: `theme_mapping 字段为空: ${missing.map(([k]) => k).join(',')}` }];
  }
  return [];
}

function checkCreativeScaffolding(persona: Persona, r: ChatResponse): Violation[] {
  if (persona.name !== '高概念降级型' || !r.stage1_confirmed) return [];
  const m = r.theme_mapping;
  const text = [r.dialogue, r.snapshot ?? '', m ? JSON.stringify(m) : ''].join('\n');
  const v: Violation[] = [];
  if (!/太空|火星|基地/.test(text)) {
    v.push({ rule: 'p1-lost-original-theme', detail: '确认书未保留学生原始兴趣主题' });
  }
  if (!/人工|控制|资源|光照|环境/.test(text)) {
    v.push({ rule: 'p1-lost-original-feature', detail: '确认书未说明从原主题保留的关键特征或约束' });
  }
  if (!/代理|模拟|人工光照|光照时长|课堂/.test(text)) {
    v.push({ rule: 'p1-no-classroom-proxy', detail: '确认书未说明课堂安全代理或模拟关系' });
  }
  return v;
}

/** 规则3（阶段1）：冗余确认轮 —— 问"准备好了吗"却不给确认书 */
function checkRedundantConfirm(r: ChatResponse): Violation[] {
  if (
    /准备好了|可以进入|要不要进入|是否进入|进入下一阶段了吗|生成确认书吗/.test(r.dialogue) &&
    !r.stage1_confirmed
  ) {
    return [{ rule: 'p1-redundant-confirm', detail: '口头问"是否进入下一阶段"而未直接输出确认书' }];
  }
  return [];
}

/** 规则4（阶段1）：越界做阶段2的事。
 * 已输出确认书的收敛轮除外——交接语中预告"测量方式留待方案设计阶段"是正确行为。 */
function checkStage1Boundary(r: ChatResponse): Violation[] {
  if (r.stage1_confirmed) return [];
  const v: Violation[] = [];
  const d = r.dialogue;
  if (/怎么测量|如何测量|测量方式|记录哪些数据|怎样记录/.test(d)) {
    v.push({ rule: 'p1-boundary-measure', detail: '追问测量方式（阶段2的事）' });
  }
  if (/哪些控制变量|控制变量有|需要保持一致的|保持不变的因素/.test(d) && /[？?]/.test(d)) {
    v.push({ rule: 'p1-boundary-controlled', detail: '追问控制变量清单（阶段2的事）' });
  }
  if (/实验步骤|准备哪些材料|分几组|设计数据表/.test(d)) {
    v.push({ rule: 'p1-boundary-procedure', detail: '讨论实验步骤/材料/分组（阶段2的事）' });
  }
  return v;
}

/** 规则5：confirmation 必须伴随对应结构化产出 */
function checkConfirmationPairing(phase: number, r: ChatResponse): Violation[] {
  if (r.next_action_type !== 'confirmation') return [];
  if (phase === 1 && !r.stage1_confirmed) {
    return [{ rule: 'p1-confirm-no-doc', detail: 'confirmation 未伴随 stage1_confirmed+snapshot' }];
  }
  if (phase === 2 && !r.data_table_schema) {
    return [{ rule: 'p2-confirm-no-schema', detail: 'confirmation 未伴随 data_table_schema' }];
  }
  return [];
}

/** 规则6（阶段5首轮）：report_sections 六节齐全 */
function checkReportSections(r: ChatResponse): Violation[] {
  const need = ['purpose', 'hypothesis', 'materials', 'procedure', 'dataSummary', 'analysis'] as const;
  if (!r.report_sections) return [{ rule: 'p5-no-sections', detail: '首轮未输出 report_sections' }];
  const missing = need.filter((k) => !r.report_sections![k]?.trim());
  if (missing.length > 0) return [{ rule: 'p5-missing-sections', detail: `缺节: ${missing.join(',')}` }];
  return [];
}

// ---------- 剧本 ----------

interface Persona {
  name: string;
  /** 阶段1学生消息序列（耗尽后用 filler） */
  phase1: string[];
  /** 阶段2学生消息序列（首条为前端 auto-trigger 的固定承接语之后的回复） */
  phase2: string[];
}

const PERSONAS: Persona[] = [
  {
    name: '配合型',
    phase1: [
      '我对植物生长很感兴趣，想研究光照对植物的影响',
      '我想研究不同颜色的光对绿豆发芽速度的影响',
      '好的，我确定研究不同颜色的光（红、蓝、绿、白）对绿豆发芽的影响，要改变的就是光的颜色',
    ],
    phase2: [
      '我打算设四个组：红光、蓝光、绿光、白光，各照射10颗绿豆',
      '因变量就看每天发芽了几颗，数一数发芽数。控制温度、水量、绿豆品种一样',
      '每天记录一次，做7天，好了帮我生成数据表吧',
    ],
  },
  {
    name: '模糊型',
    phase1: [
      '我想做点跟吃的有关的实验',
      '嗯……牛奶？酸奶？不知道能研究什么',
      '哦哦，那我想知道酸奶放在不同温度下会怎么样',
      '对，就是研究温度对酸奶变质快慢的影响，改变的是存放温度',
    ],
    phase2: [
      '我想放三个地方：冰箱、室内、暖气旁边',
      '看它什么时候变质，闻气味、看有没有结块。品牌、开封时间保持一样',
      '每天早晚各看一次，记录3天，可以生成表了',
    ],
  },
  {
    name: '一次给全型',
    phase1: [
      '我要研究不同浓度的盐水对绿豆种子发芽率的影响。自变量是盐水浓度（0%、1%、3%、5%），因变量是发芽率，控制变量是温度、水量、种子品种。请直接确认。',
    ],
    phase2: [
      '每组20颗种子，四个浓度组，每天固定时间浇10ml对应浓度盐水，室温25度，记录每天发芽数，做5天。请生成数据表。',
    ],
  },
  {
    name: '工程项目型',
    phase1: [
      '我想做一个自动浇花器，最好能根据土壤干湿自己浇水',
      '那我想研究土壤湿度阈值不同，会不会影响自动浇花器的浇水效果',
      '我确定研究不同湿度阈值对自动浇花器浇水准确率的影响，要改变的是湿度阈值',
    ],
    phase2: [
      '我打算设三个阈值：低、中、高，每种阈值测试10次',
      '因变量看该浇水时有没有浇、不该浇时有没有误浇，控制同一个传感器、同一种土壤和水泵',
      '每次测试记录土壤状态、阈值、是否启动水泵和判断是否正确，可以生成数据表了',
    ],
  },
  {
    name: '高概念降级型',
    phase1: [
      '我想做一个和太空有关的项目，最好有点像火星基地',
      '我最感兴趣的是火星基地里植物怎么活下来，因为那里条件都要人工控制',
      '我想保留人工控制光照这个特点，用不同人工光照时长看看绿豆发芽会不会不一样',
      '我确定研究不同人工光照时长是否影响绿豆发芽和早期生长，要改变的是人工光照时长',
    ],
    phase2: [
      '我准备设0小时、4小时、8小时、12小时人工光照，每组10颗绿豆',
      '观察每天有没有发芽和幼苗大概长得怎么样，绿豆品种、水量、温度尽量一样',
      '每天固定时间记录一次，做7天，可以生成数据表了',
    ],
  },
];

const FILLER = '我觉得可以了，就按这个来吧。';
const P2_TRIGGER = '我已确认选题，现在开始设计实验方案。'; // 与前端 auto-trigger 文案一致

const DATA_ROWS = [
  { day: 1, group_a: '0/10', group_b: '0/10', group_c: '0/10', group_d: '1/10' },
  { day: 2, group_a: '1/10', group_b: '2/10', group_c: '0/10', group_d: '3/10' },
  { day: 3, group_a: '3/10', group_b: '4/10', group_c: '1/10', group_d: '5/10' },
  { day: 4, group_a: '5/10', group_b: '6/10', group_c: '2/10', group_d: '7/10' },
  { day: 5, group_a: '7/10', group_b: '8/10', group_c: '4/10', group_d: '9/10' },
];

const PRIOR_SUMMARY = `【选题确认书】
研究不同颜色光对绿豆发芽速度的影响
自变量：光的颜色（红、蓝、绿、白），因变量：每天发芽数，控制变量：温度、水量、绿豆品种

【实验方案-数据表列】天数(number)、红光组发芽数(number)、蓝光组发芽数(number)、绿光组发芽数(number)、白光组发芽数(number)、备注(text)，最少3行，最多200行

【实验数据-共5行】
天数 | 红光组 | 蓝光组 | 绿光组 | 白光组
1 | 0/10 | 0/10 | 0/10 | 1/10
2 | 1/10 | 2/10 | 0/10 | 3/10
3 | 3/10 | 4/10 | 1/10 | 5/10
4 | 5/10 | 6/10 | 2/10 | 7/10
5 | 7/10 | 8/10 | 4/10 | 9/10`;

// ---------- 执行器 ----------

const records: TurnRecord[] = [];

async function callOnce(systemPrompt: string, history: LLMMessage[], userMsg: string) {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMsg },
  ];
  const raw = await provider.chat(messages, { useJsonFormat: true });
  const parsed = safeParseChatResponse(raw);
  const parseOk = !FALLBACKS.includes(parsed.dialogue);
  return { raw, parsed, parseOk };
}

function record(
  persona: string, phase: number, turn: number, userMsg: string,
  parsed: ChatResponse, parseOk: boolean, violations: Violation[]
) {
  const r: TurnRecord = {
    persona, phase, turn,
    userMsg: userMsg.slice(0, 40),
    parseOk,
    actionType: parsed.next_action_type,
    violations,
    dialogueSnippet: parsed.dialogue.slice(0, 70),
  };
  records.push(r);
  const flag = violations.length === 0 ? (parseOk ? '✓' : '✗') : '⚠';
  console.log(`  [${flag}] P${phase} T${turn} action=${r.actionType}${violations.length ? ' | ' + violations.map((x) => x.rule).join(',') : ''}`);
  console.log(`      ${r.dialogueSnippet}…`);
  for (const vio of violations) console.log(`      ⚠ ${vio.rule}: ${vio.detail}`);
}

/** 跑一个 persona 的阶段1+2（历史跨阶段连续，与 DB 模式一致） */
async function runPersona(p: Persona) {
  console.log(`\n===== 学生画像：${p.name} =====`);
  const history: LLMMessage[] = [];
  const roundCounts: Record<number, number> = {};

  const promptFor = (phase: PhaseEnum, extra?: PromptContext) => {
    const round = (roundCounts[phase] ?? 0) + 1;
    roundCounts[phase] = round;
    let ctx: PromptContext | undefined = extra;
    if (shouldNudgeConvergence(phase, round)) ctx = { ...(ctx ?? {}), nudgeConverge: true };
    return getPromptForPhase(phase, ctx);
  };

  // ---- 阶段1：直到 stage1_confirmed 或 8 轮 ----
  console.log('--- 阶段1 选题定向 ---');
  let confirmed = false;
  const MAX_P1 = 8;
  for (let t = 1; t <= MAX_P1 && !confirmed; t++) {
    const msg = p.phase1[t - 1] ?? FILLER;
    const { raw, parsed, parseOk } = await callOnce(promptFor(PhaseEnum.TopicSelection), history, msg);
    const violations = [
      ...checkMarkdown(parsed.dialogue),
      ...checkOptions(parsed),
      ...checkStage1AntiChoice(parsed),
      ...checkReadyMadeTopicList(parsed),
      ...checkRedundantConfirm(parsed),
      ...checkStage1Boundary(parsed),
      ...checkConfirmationPairing(1, parsed),
      ...checkThemeMapping(parsed),
      ...checkCreativeScaffolding(p, parsed),
    ];
    record(p.name, 1, t, msg, parsed, parseOk, violations);
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: raw });
    confirmed = !!parsed.stage1_confirmed;
  }
  if (!confirmed) {
    console.log('  ✗✗ 阶段1未能在8轮内收敛（严重）');
    records.push({
      persona: p.name, phase: 1, turn: 99, userMsg: '(未收敛)', parseOk: false,
      actionType: 'none', violations: [{ rule: 'p1-never-converged', detail: '8轮未输出确认书' }],
      dialogueSnippet: '',
    });
  }

  // ---- 阶段2：auto-trigger 承接 → 直到 data_table_schema 或 6 轮 ----
  console.log('--- 阶段2 方案设计 ---');
  let gotSchema = false;
  const MAX_P2 = 6;
  const p2msgs = [P2_TRIGGER, ...p.phase2];
  for (let t = 1; t <= MAX_P2 && !gotSchema; t++) {
    const msg = p2msgs[t - 1] ?? FILLER;
    const { raw, parsed, parseOk } = await callOnce(promptFor(PhaseEnum.PlanDesign), history, msg);
    const violations = [
      ...checkMarkdown(parsed.dialogue),
      ...checkOptions(parsed),
      ...checkConfirmationPairing(2, parsed),
    ];
    record(p.name, 2, t, msg, parsed, parseOk, violations);
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: raw });
    gotSchema = !!parsed.data_table_schema;
  }
  if (!gotSchema) {
    console.log('  ✗✗ 阶段2未能在6轮内产出数据表（严重）');
    records.push({
      persona: p.name, phase: 2, turn: 99, userMsg: '(未产表)', parseOk: false,
      actionType: 'none', violations: [{ rule: 'p2-never-schema', detail: '6轮未输出 data_table_schema' }],
      dialogueSnippet: '',
    });
  }
}

/** 阶段4/5 独立小场景（不依赖前面 persona 的产出，用固定注入数据） */
async function runPhase45() {
  console.log('\n===== 阶段4 数据分析（注入数据，两轮） =====');
  const history: LLMMessage[] = [];
  const p4prompt = getPromptForPhase(PhaseEnum.DataAnalysis, { dataRows: DATA_ROWS });
  const p4msgs = ['这是我收集的数据，帮我看看有什么规律', '我发现白光组发芽最快，绿光组最慢，这说明什么？'];
  for (let t = 1; t <= 2; t++) {
    const { raw, parsed, parseOk } = await callOnce(p4prompt, history, p4msgs[t - 1]);
    const violations = [...checkMarkdown(parsed.dialogue), ...checkOptions(parsed)];
    record('阶段4场景', 4, t, p4msgs[t - 1], parsed, parseOk, violations);
    history.push({ role: 'user', content: p4msgs[t - 1] }, { role: 'assistant', content: raw });
  }

  console.log('\n===== 阶段5 报告成型（注入 priorSummary，首轮） =====');
  const p5prompt = getPromptForPhase(PhaseEnum.ResultsFormation, { priorSummary: PRIOR_SUMMARY });
  const { parsed, parseOk } = await callOnce(p5prompt, [], '开始报告成型');
  const violations = [
    ...checkMarkdown(parsed.dialogue),
    ...checkOptions(parsed),
    ...checkReportSections(parsed),
  ];
  record('阶段5场景', 5, 1, '开始报告成型', parsed, parseOk, violations);
}

// ---------- 汇总 ----------

function summarize() {
  console.log('\n\n============ 汇总 ============');
  const total = records.length;
  const parseOk = records.filter((r) => r.parseOk).length;
  const clean = records.filter((r) => r.parseOk && r.violations.length === 0).length;
  console.log(`总轮次: ${total}`);
  console.log(`JSON解析成功: ${parseOk}/${total} (${((parseOk / total) * 100).toFixed(0)}%)`);
  console.log(`零违规轮次: ${clean}/${total} (${((clean / total) * 100).toFixed(0)}%)`);

  const byRule = new Map<string, number>();
  for (const r of records) for (const v of r.violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
  if (byRule.size > 0) {
    console.log('\n违规明细（按规则）:');
    for (const [rule, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${rule}: ${count} 次`);
    }
    console.log('\n违规轮次定位:');
    for (const r of records) {
      if (r.violations.length > 0) {
        console.log(`  [${r.persona}] P${r.phase} T${r.turn} → ${r.violations.map((v) => v.rule).join(', ')}`);
      }
    }
  } else {
    console.log('\n🎉 全部规则检查通过');
  }
}

async function main() {
  console.log('多轮 LLM 质量测试 — 剧本驱动 + 自动规则检查\n');
  try {
    for (const p of PERSONAS) {
      await runPersona(p);
    }
    await runPhase45();
  } catch (e: unknown) {
    console.error('\nLLM 调用失败:', e instanceof Error ? e.message : e);
  }
  summarize();
}

main();
