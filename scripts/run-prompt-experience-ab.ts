#!/usr/bin/env tsx
import './load-script-env';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import type { StageData, Stage2Column, Stage2ExperimentPlan } from '../app/models/stageData';
import {
  buildTutorVisibleState,
  callTutorLanguageWithTrace,
  TUTOR_LANGUAGE_PROMPT_V1,
  TUTOR_LANGUAGE_PROMPT_V2_3,
  type TutorLanguagePromptVersion,
} from '../app/lib/tutorLanguage';
import { tutorFocusPlan, updateServerAnalysis, visibleDataRows } from '../app/lib/serverTutorState';
import { buildDataTableSchema, composeReportSections } from '../app/lib/stageArtifacts';
import { composeStage2Plan, evaluateStage2Readiness } from '../app/lib/stage2Readiness';
import { stage2DraftHash } from '../app/lib/stageState';
import { validateConfig } from '../app/lib/llm/provider';

const outputRoot = path.resolve(
  process.env.PROMPT_EXPERIENCE_OUTPUT ?? `data/prompt-experience-ab-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`,
);

const levels = ['0小时', '8小时', '12小时', '24小时'];
const schemaColumns: Stage2Column[] = [
  { key: 'trial', title: '重复序号', type: 'number', required: true },
  ...levels.map((level, index) => ({ key: `result_${String.fromCharCode(97 + index)}`, title: `${level}：豆苗高度（厘米）`, type: 'number' as const, required: true })),
  { key: 'notes', title: '客观异常备注', type: 'text', required: false },
];
const dataRows: Record<string, unknown>[] = [
  [6.2, 14.8, 18.2, 16.1], [6.5, 15.1, 18.5, 15.8], [6.1, 14.9, 18.1, 16.4],
  [6.3, 15.2, 18.7, 16.0], [6.4, 14.7, 18.4, 15.9], [6.0, 15.0, 18.3, 16.2],
  [6.2, 15.3, 18.6, 15.7], [6.3, 14.8, 18.0, 16.3], [6.1, 15.1, 18.5, 16.1],
  [6.4, 15.0, 18.4, 15.9],
].map((values, index) => ({
  trial: index + 1,
  result_a: values[0], result_b: values[1], result_c: values[2], result_d: values[3],
  notes: index === 6 ? '24小时组第7次转移培养液时有短暂停顿，原始值保留' : '',
}));

const question = '光照时长对豆苗高度的影响';
const plan: Stage2ExperimentPlan = {
  researchQuestion: question,
  hypothesis: '我认为每天光照时间越多，豆苗高度越高。',
  independentVariable: { name: '每天光照时长', levels },
  dependentVariable: { name: '豆苗高度', measurement: '用刻度尺从土壤表面量到茎尖，每天固定时间测量', unit: '厘米' },
  controlledVariables: ['豆苗数量', '水和营养液量', '水位', '温度', '测量时间'],
  materials: ['豆苗', '水培容器', '营养液', '刻度尺', '遮光材料'],
  procedure: ['设置0、8、12、24小时四个光照条件', '各组保持其他条件一致', '每天固定时间测量豆苗高度并记录', '每个水平安排10次重复并计算平均值'],
  repeatCount: 10,
  safetyNotes: ['保持台面整洁，培养液或装置异常时停止操作并告知教师。'],
};

type Turn = {
  sequence: number;
  stage: number;
  triggerType: string;
  studentMessage: string;
  allowedFocusIds: string[];
  visibleFacts: unknown;
  response: unknown;
  rawOutput: string;
  promptSha256: string;
  attempts: unknown[];
  generationParams: unknown;
};

type RunResult = {
  promptVersion: TutorLanguagePromptVersion;
  model: { provider: string | null; model: string | null };
  turns: Turn[];
  stageData: StageData;
  reportSections: Record<string, unknown> | null;
};

function fact(state: StageData, key: string, value: unknown, sourceQuote: string) {
  state.extractedFacts = {
    ...(state.extractedFacts ?? {}),
    [key]: { value, sourceQuote },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeStage2State(state: StageData): StageData {
  const composed = composeStage2Plan(state);
  if (!composed) throw new Error('实验脚本无法组装阶段2方案');
  const draftHash = stage2DraftHash(composed.plan);
  state.stage2 = {
    submitted: false,
    approved: null,
    planDraft: composed.plan,
    readiness: evaluateStage2Readiness(state),
    planProvenance: composed.provenance,
    draftHash,
    schema: buildDataTableSchema(composed.plan),
  };
  return state;
}

function makeFrozenState(state: StageData): StageData {
  const draftHash = state.stage2?.draftHash ?? stage2DraftHash(plan);
  state.stage2 = {
    ...(state.stage2 ?? { submitted: false, approved: null, schema: buildDataTableSchema(plan) }),
    planDraft: plan,
    experimentPlan: plan,
    confirmedPlanHash: draftHash,
    draftHash,
    schema: buildDataTableSchema(plan),
    readiness: evaluateStage2Readiness(state),
  };
  return state;
}

function averages() {
  return levels.map((_, index) => dataRows.reduce((sum, row) => sum + Number(row[`result_${String.fromCharCode(97 + index)}`]), 0) / dataRows.length);
}

function chartSvg(): string {
  const values = averages();
  const width = 920; const height = 520; const left = 90; const bottom = 80; const top = 40; const plotHeight = height - top - bottom;
  const max = 20; const barWidth = 120; const gap = 56;
  const bars = values.map((value, index) => {
    const x = left + 30 + index * (barWidth + gap);
    const barHeight = plotHeight * value / max;
    const y = top + plotHeight - barHeight;
    return `<rect x="${x}" y="${y.toFixed(1)}" width="${barWidth}" height="${barHeight.toFixed(1)}" fill="${['#2563eb', '#0f766e', '#d97706', '#dc2626'][index]}"/><text x="${x + barWidth / 2}" y="${y - 10}" text-anchor="middle" font-size="18" fill="#111827">${value.toFixed(2)}</text><text x="${x + barWidth / 2}" y="${height - 38}" text-anchor="middle" font-size="16" fill="#374151">${levels[index]}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><text x="${width / 2}" y="28" text-anchor="middle" font-size="22" font-weight="700" fill="#111827">不同光照时长下豆苗平均高度</text><line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="#6b7280"/><line x1="${left}" y1="${height - bottom}" x2="${width - 35}" y2="${height - bottom}" stroke="#6b7280"/><text x="24" y="${top + plotHeight / 2}" transform="rotate(-90 24 ${top + plotHeight / 2})" text-anchor="middle" font-size="16" fill="#374151">平均高度（厘米）</text>${bars}<text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="14" fill="#6b7280">同一批模拟数据，四个水平各10次重复</text></svg>`;
}

function csv(): string {
  return [schemaColumns.map((column) => column.title).join(','), ...dataRows.map((row) => schemaColumns.map((column) => JSON.stringify(row[column.key] ?? '')).join(','))].join('\n');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function transcriptMarkdown(result: RunResult): string {
  const lines = [`# Prompt 体验模式 A/B：${result.promptVersion}`, '', `底层模型：${result.model.provider ?? 'unknown'} / ${result.model.model ?? 'unknown'}`, '', '本文件保留同一模拟学生在六阶段中的全部输入与教师回复。', ''];
  for (const turn of result.turns) {
    const response = turn.response as { dialogue?: string; interactionType?: string; focus?: string; hints?: string[] };
    lines.push(`## ${turn.sequence}. 阶段 ${turn.stage} · ${turn.triggerType}`);
    lines.push(`学生：${turn.studentMessage || '（系统触发）'}`);
    lines.push(`允许 focus：${turn.allowedFocusIds.join('、')}`);
    lines.push(`教师：${response.dialogue ?? ''}`);
    lines.push(`interactionType：${response.interactionType ?? ''}；focus：${response.focus ?? ''}`);
    if (response.hints?.length) lines.push(`提示：${response.hints.join('；')}`);
    lines.push(`解析尝试：${turn.attempts.length + 1}；Prompt hash：${turn.promptSha256}`);
    lines.push('');
  }
  return lines.join('\n');
}

function reportMarkdown(result: RunResult): string {
  const sections = result.reportSections as Record<string, string> | null;
  if (!sections) return '# 报告\n\n报告框架未生成。';
  return ['# 模拟实验报告', '', ...[
    ['研究目的', sections.purpose], ['假设', sections.hypothesis], ['实验材料', sections.materials],
    ['实验步骤', sections.procedure], ['数据概述', sections.dataSummary], ['数据分析', sections.analysis],
    ['结论', sections.conclusion], ['局限与讨论', sections.limitationsDiscussion ?? sections.reflection],
  ].flatMap(([label, value]) => [`## ${label}`, '', value ?? '', ''])].join('\n');
}

async function run(promptVersion: TutorLanguagePromptVersion): Promise<RunResult> {
  const modelConfig = validateConfig();
  let state: StageData = { extractedFacts: {} };
  const turns: Turn[] = [];
  const studentHistory: string[] = [];
  const tutorHistory: string[] = [];
  let sequence = 0;

  async function ask(stage: number, studentMessage: string, triggerType: string, analysisAccepted = false) {
    const focus = tutorFocusPlan(stage, state, { triggerType, analysisAccepted });
    const readiness = stage === 2 ? evaluateStage2Readiness(state) : undefined;
    const visibleFacts = stage === 4
      ? { 研究方案: state.stage2?.experimentPlan, 数据记录: visibleDataRows(state), 已接受分析次数: state.stage4?.analysisCount ?? 0 }
      : buildTutorVisibleState(stage, state, { 作业限定方向: '光照时长与豆苗高度' });
    const trace = await callTutorLanguageWithTrace({
      phase: stage,
      triggerType,
      currentStudentMessage: ['STAGE_ENTER', 'STAGE_TRANSITION', 'REPORT_BOOTSTRAP'].includes(triggerType) ? '' : studentMessage,
      priorStudentMessages: studentHistory,
      tutorHistory,
      visibleFacts,
      allowedFocusIds: focus.allowedFocusIds,
      focusDescriptions: focus.focusDescriptions,
      completedFocusIds: readiness?.completedFields,
      planReady: readiness?.complete,
    }, { role: 'TUTOR' }, promptVersion);
    sequence += 1;
    turns.push({ sequence, stage, triggerType, studentMessage, allowedFocusIds: focus.allowedFocusIds, visibleFacts, response: trace.response, rawOutput: trace.rawOutput, promptSha256: trace.promptSha256, attempts: trace.attempts, generationParams: trace.generationParams });
    if (studentMessage && !['STAGE_ENTER', 'STAGE_TRANSITION', 'REPORT_BOOTSTRAP'].includes(triggerType)) studentHistory.push(studentMessage);
    tutorHistory.push(trace.response.dialogue);
  }

  await ask(1, '我最近发现不同光照时间下，豆苗长得好像不一样，想研究这个。', 'USER_MESSAGE');
  fact(state, 'stage1.researchQuestion', question, question);
  await ask(1, question, 'USER_MESSAGE');
  state.stage1 = { confirmed: true, snapshot: `《探究问题确认书》\n研究问题：${question}`, researchQuestion: question, confirmedQuestionHash: 'simulated-confirmed-question' };
  fact(state, 'stage1.confirmed', true, '我确认按这个问题做。');
  await ask(1, '我确认按这个问题做。', 'USER_MESSAGE');

  const stage2Inputs: Array<[string, unknown, string]> = [
    ['stage2.hypothesis', '我认为每天光照时间越多，豆苗高度越高。', '我认为每天光照时间越多，豆苗高度越高。'],
    ['stage2.independentVariable.name', '每天光照时长', '我准备改变每天光照时长。'],
    ['stage2.independentVariable.levels', levels, '我准备比较0小时、8小时、12小时和24小时。'],
    ['stage2.dependentVariable.name', '豆苗高度', '我要观察豆苗高度。'],
    ['stage2.dependentVariable.measurement', '用刻度尺从土壤表面量到茎尖，每天固定时间测量', '用刻度尺从土壤表面量到茎尖，每天固定时间测量，单位用厘米。'],
    ['stage2.controlledVariables', plan.controlledVariables, '豆苗数量、水和营养液量、水位、温度、测量时间都保持一致。'],
    ['stage2.repeatCount', 10, '每个水平做10次重复，最后取平均值。'],
  ];
  for (const [key, value, quote] of stage2Inputs) {
    fact(state, key, value, quote);
    if (key === 'stage2.dependentVariable.measurement') fact(state, 'stage2.dependentVariable.unit', '厘米', quote);
    await ask(2, quote, 'USER_MESSAGE');
  }
  makeStage2State(state);
  await ask(2, '方案可以了，我确认这个方案。', 'USER_MESSAGE');
  makeFrozenState(state);

  state.stage3 = { rows: [], safetyQuiz: { question: '出现异常时应该怎样做？', options: ['停止并告知教师', '继续完成', '自行增强材料'], passed: true } };
  await ask(3, '', 'STAGE_ENTER');
  await ask(3, '我会先停止操作并告诉老师，再继续记录。', 'USER_MESSAGE');

  state.stage3 = { rows: clone(dataRows), safetyQuiz: state.stage3.safetyQuiz, submitted: true };
  await ask(4, '', 'STAGE_TRANSITION');
  const firstEvidence = '第4行中，0小时组是6.3厘米，12小时组是18.7厘米，12小时组比0小时组高12.4厘米。';
  const first = updateServerAnalysis(state, firstEvidence);
  state = first.stageData;
  await ask(4, firstEvidence, 'USER_MESSAGE', first.accepted);
  await ask(4, '这说明在这两组数据中，12小时光照下的豆苗高度暂时高于0小时，但这还不能单独证明一定是光照造成的。', 'USER_MESSAGE', false);
  const secondEvidence = '第2行中，12小时组是18.5厘米，24小时组是15.8厘米，12小时组比24小时组高2.7厘米。';
  const second = updateServerAnalysis(state, secondEvidence);
  state = second.stageData;
  await ask(4, secondEvidence, 'USER_MESSAGE', second.accepted);

  const sections = composeReportSections({ stageData: state });
  state.stage5 = {
    submitted: false,
    approved: null,
    sections: {
      ...(sections ?? { purpose: '', hypothesis: '', materials: '', procedure: '', dataSummary: '', analysis: '' }),
      conclusion: '在本次数据中，12小时光照组的平均高度最高，24小时组低于12小时组；这个结果部分支持原来的猜想，但还需要更多重复和控制条件来判断。',
      limitationsDiscussion: '样本数量和观察时间有限，24小时组还出现过一次操作停顿；后续可以延长观察时间并进一步统一操作。',
      reflection: '样本数量和观察时间有限，24小时组还出现过一次操作停顿；后续可以延长观察时间并进一步统一操作。',
    },
  };
  await ask(5, '', 'REPORT_BOOTSTRAP');
  await ask(5, '我会检查报告中的结论和局限是否都能从数据和实验过程得到支持。', 'USER_MESSAGE');
  state.stage6 = { studentResponse: '', responseToTeacherFeedback: '', learningReflection: '', finalReadonly: false };
  await ask(6, '', 'OPTIONAL_COACHING');
  await ask(6, '我发现控制条件和记录异常同样重要，下一次我会先把测量步骤写得更清楚。', 'USER_MESSAGE');

  return { promptVersion, model: { provider: modelConfig.provider, model: modelConfig.model }, turns, stageData: state, reportSections: state.stage5?.sections ? state.stage5.sections as unknown as Record<string, unknown> : null };
}

function metrics(result: RunResult) {
  const responses = result.turns.map((turn) => turn.response as { dialogue?: string; hints?: string[]; interactionType?: string; focus?: string });
  const dialogues = responses.map((item) => item.dialogue ?? '');
  const earlyStageText = result.turns
    .filter((turn) => turn.stage <= 2 && !turn.allowedFocusIds.includes('plan_confirmation'))
    .map((turn) => (turn.response as { dialogue?: string }).dialogue ?? '')
    .join('\n');
  return {
    turns: result.turns.length,
    fallbackTurns: result.turns.filter((turn) => JSON.stringify(turn.generationParams).includes('deterministicTutorFallback')).length,
    invalidRepairTurns: result.turns.filter((turn) => turn.attempts.length > 0).length,
    averageDialogueChars: Math.round(dialogues.reduce((sum, item) => sum + item.length, 0) / Math.max(1, dialogues.length)),
    hintTurns: responses.filter((item) => (item.hints?.length ?? 0) > 0).length,
    phase1Overreach: /自变量|因变量|实验组|测量|材料|步骤|重复|控制条件/.test(result.turns.filter((turn) => turn.stage === 1).map((turn) => (turn.response as { dialogue?: string }).dialogue ?? '').join('\n')),
    earlyStartClaim: /开始实验|进入过程执行/.test(earlyStageText),
    stage4Rounds: result.stageData.stage4?.analysisCount ?? 0,
    reportAnalysisChars: String((result.reportSections as Record<string, unknown> | null)?.analysis ?? '').length,
  };
}

function comparisonMarkdown(a: RunResult, b: RunResult): string {
  const ma = metrics(a); const mb = metrics(b);
  return `# Prompt 体验模式 A/B 简评\n\n实验日期：${new Date().toISOString()}\n\n## 实验控制\n\n- 同一底层模型：${a.model.provider ?? 'unknown'} / ${a.model.model ?? 'unknown'}\n- 同一模拟学生输入、实验方案、10行数据和报告内容\n- 仅切换 Tutor Prompt：v1 与 v2.3\n- 本实验不写入 Data Lab 案例、候选或 release\n\n## 自动指标\n\n| 指标 | v1 | v2.3 |\n|---|---:|---:|\n| Tutor 回合数 | ${ma.turns} | ${mb.turns} |\n| 触发修复解析的回合 | ${ma.invalidRepairTurns} | ${mb.invalidRepairTurns} |\n| 确定性 fallback 回合 | ${ma.fallbackTurns} | ${mb.fallbackTurns} |\n| 平均 dialogue 字符数 | ${ma.averageDialogueChars} | ${mb.averageDialogueChars} |\n| 有提示的回合 | ${ma.hintTurns} | ${mb.hintTurns} |\n| P1 越界关键词命中 | ${ma.phase1Overreach ? '是' : '否'} | ${mb.phase1Overreach ? '是' : '否'} |\n| 提前宣布开始实验 | ${ma.earlyStartClaim ? '是' : '否'} | ${mb.earlyStartClaim ? '是' : '否'} |\n| 阶段4有效分析轮次 | ${ma.stage4Rounds} | ${mb.stage4Rounds} |\n| 报告分析字符数 | ${ma.reportAnalysisChars} | ${mb.reportAnalysisChars} |\n\n## 简单看法\n\n这次结果只用于体验层面的方向判断，不替代 Smoke、Calibration、Trial 和人工评审。重点观察：v2.3 是否更少重复追问、是否更快收敛、是否更少模板化表达；同时确认它没有牺牲学生选择权、事实依据和阶段边界。\n\n逐轮原文请查看：\n\n- [v1 transcript](./current-v1/transcript.md)\n- [v2.3 transcript](./candidate-v2.3/transcript.md)\n- [v1 report](./current-v1/report.md)\n- [v2.3 report](./candidate-v2.3/report.md)\n- [shared chart](./current-v1/chart.svg)\n`;
}

async function writeRun(name: string, result: RunResult) {
  const dir = path.join(outputRoot, name);
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(path.join(dir, 'transcript.json'), JSON.stringify(result, null, 2), 'utf8'),
    writeFile(path.join(dir, 'transcript.md'), transcriptMarkdown(result), 'utf8'),
    writeFile(path.join(dir, 'report.md'), reportMarkdown(result), 'utf8'),
    writeFile(path.join(dir, 'data.csv'), csv(), 'utf8'),
    writeFile(path.join(dir, 'chart.svg'), chartSvg(), 'utf8'),
    writeFile(path.join(dir, 'metrics.json'), JSON.stringify(metrics(result), null, 2), 'utf8'),
    writeFile(path.join(dir, 'session.html'), `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{font:15px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#172033}pre{white-space:pre-wrap;background:#f5f7fa;padding:12px;border-radius:6px}img{max-width:100%;border:1px solid #ddd}table{border-collapse:collapse}td,th{border:1px solid #ccd3dd;padding:5px 8px}</style><h1>${name}</h1><p>Prompt: ${result.promptVersion}; Model: ${result.model.provider ?? 'unknown'} / ${result.model.model ?? 'unknown'}</p><img src="chart.svg" alt="实验数据图表"><h2>逐轮回复</h2>${result.turns.map((turn) => { const response = turn.response as { dialogue?: string; interactionType?: string; focus?: string; hints?: string[] }; return `<section><h3>P${turn.stage} · ${turn.triggerType}</h3><p><b>学生：</b>${escapeHtml(turn.studentMessage || '（系统触发）')}</p><p><b>教师：</b>${escapeHtml(response.dialogue ?? '')}</p><p>focus=${escapeHtml(response.focus ?? '')}; interactionType=${escapeHtml(response.interactionType ?? '')}</p></section>`; }).join('')}`, 'utf8'),
  ]);
}

async function main() {
  const config = validateConfig();
  if (!config.valid) throw new Error(config.issues.join(' '));
  await mkdir(outputRoot, { recursive: true });
  const [current, candidate] = await Promise.all([
    run(TUTOR_LANGUAGE_PROMPT_V1),
    run(TUTOR_LANGUAGE_PROMPT_V2_3),
  ]);
  await writeRun('current-v1', current);
  await writeRun('candidate-v2.3', candidate);
  await writeFile(path.join(outputRoot, 'chart.svg'), chartSvg(), 'utf8');
  await writeFile(path.join(outputRoot, 'data.csv'), csv(), 'utf8');
  await writeFile(path.join(outputRoot, 'comparison.md'), comparisonMarkdown(current, candidate), 'utf8');
  await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify({
    experiment: 'experience-mode-prompt-ab',
    createdAt: new Date().toISOString(),
    outputRoot,
    model: current.model,
    promptVersions: [current.promptVersion, candidate.promptVersion],
    scenario: { researchQuestion: question, levels, rows: dataRows.length, repeatCount: plan.repeatCount },
    noDatabaseWrites: true,
    notes: 'A/B uses identical student messages and structured state; only Tutor prompt version changes.',
  }, null, 2), 'utf8');
  console.log(JSON.stringify({ outputRoot, model: current.model, v1: metrics(current), v23: metrics(candidate) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
