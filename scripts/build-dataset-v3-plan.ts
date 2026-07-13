#!/usr/bin/env tsx
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { STYLE_FAMILIES } from '../app/lib/stylePolicy';
import { STAGE_CONTRACT_VERSION } from '../app/lib/stageContract';
import type { ShareGPTRecord } from '../app/lib/dataLab/types';
import type {
  DatasetV3ExpectedTransformation as ExpectedTransformation,
  DatasetV3Phase as Phase,
  DatasetV3Plan,
  DatasetV3Task,
} from './dataset-v3-types';

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function intFlag(name: string, fallback: number): number {
  const raw = flag(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} 必须为正整数`);
  return value;
}

function hashInt(value: string): number {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16);
}

function familyKey(record: ShareGPTRecord): string {
  const persona = typeof record.meta?.personaId === 'string' ? record.meta.personaId : undefined;
  return persona ?? record.id.replace(/^stem-distill-dsv4-p\d-/, '').replace(/-v\d+-[0-9a-f]+-v\d+$/i, '');
}

function expected(record: ShareGPTRecord): ExpectedTransformation | undefined {
  const value = record.meta?.expectedTransformation;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ExpectedTransformation : undefined;
}

function syntheticContext(record: ShareGPTRecord) {
  const transformation = expected(record) ?? {};
  const independent = transformation.independentVariable || '实验条件';
  const dependent = transformation.dependentDirection || '观察结果';
  const levels = [`较低${independent}`, `中等${independent}`, `较高${independent}`];
  const seed = hashInt(familyKey(record));
  const base = 4 + seed % 7;
  const direction = seed % 2 === 0 ? 1 : -1;
  const anomalyRow = seed % 3;
  const rows: Record<string, unknown>[] = Array.from({ length: 3 }, (_, index) => {
    const drift = index * direction;
    return {
      trial: index + 1,
      level_1_result: base + drift,
      level_2_result: base + 2 + drift + (index === anomalyRow ? 1 : 0),
      level_3_result: base + 4 + drift,
      notes: index === anomalyRow ? '本次记录与相邻重复略有差异，需在分析中说明' : '',
    };
  });
  const columns = [
    { key: 'trial', title: '重复次数', type: 'number' as const, required: true },
    { key: 'level_1_result', title: `${levels[0]}的${dependent}`, type: 'number' as const, required: true },
    { key: 'level_2_result', title: `${levels[1]}的${dependent}`, type: 'number' as const, required: true },
    { key: 'level_3_result', title: `${levels[2]}的${dependent}`, type: 'number' as const, required: true },
    { key: 'notes', title: '备注', type: 'text' as const, required: false },
  ];
  const rowText = rows.map((row, index) => `${index + 1}. ${columns.map((column) => `${column.title}=${String(row[column.key] ?? '')}`).join('；')}`).join('\n');
  return { rows, columns, rowText, levels, independent, dependent };
}

function priorSummaryFor(
  phase: Phase,
  transformation: ExpectedTransformation | undefined,
  context: ReturnType<typeof syntheticContext>,
): string | undefined {
  if (phase === 1) return undefined;
  const question = transformation?.researchQuestion || `${context.independent}是否影响${context.dependent}`;
  const topic = [
    `【已确认研究问题】${question}`,
    `【课堂代理】${transformation?.classroomProxy || '使用安全、可操作的课堂条件进行比较'}`,
    `【因素与现象方向】拟改变：${context.independent}；关注：${context.dependent}`,
  ];
  if (phase === 2) return topic.join('\n');
  const plan = `【教师已审核方案】自变量：${context.independent}；水平：${context.levels.join('、')}；因变量：${context.dependent}；每个水平重复3次；安全：${(transformation?.safetyNotes ?? ['遵守课堂实验安全要求']).join('、')}`;
  if (phase === 3) return [...topic, plan].join('\n');
  const data = `【学生真实数据】\n${context.rowText}`;
  if (phase === 4) return [...topic, plan, data].join('\n');
  const analysis = '【已完成的数据分析】学生已比较各条件的具体记录，指出一条偏离相邻重复的记录，并把观察与解释分开。';
  if (phase === 5) return [...topic, plan, data, analysis].join('\n');
  return [...topic, plan, data, analysis, '【已提交报告】报告已包含目的、假设、材料、步骤、数据摘要和分析；结论与局限由学生本人反思。'].join('\n');
}

function triggerFor(phase: Phase): DatasetV3Task['triggerType'] {
  if (phase === 2 || phase === 4) return 'STAGE_TRANSITION';
  if (phase === 3) return 'STAGE_ENTER';
  if (phase === 5) return 'REPORT_BOOTSTRAP';
  if (phase === 6) return 'OPTIONAL_COACHING';
  return 'USER_MESSAGE';
}

function openingFor(record: ShareGPTRecord, phase: Phase): string {
  if (phase === 2) return '系统触发：学生已确认选题。请发送阶段2方案设计的开场，只推进第一个方案缺口。';
  if (phase === 3) return '系统触发：学生首次进入过程执行阶段，请先进行与当前方案相关的安全问答。';
  if (phase === 4) return '系统触发：学生已完成数据收集。请读取已提交的数据表，并发送阶段4的数据分析开场。';
  if (phase === 5) return '系统触发：学生已完成数据分析，请基于前序结构化状态生成报告框架。';
  if (phase === 6) return `我正在反思“${record.scenario.replace(/-蒸馏样本\d+$/, '')}”这次实验，想检查自己有没有忽略重要局限。`;
  return `我对“${record.scenario.replace(/-蒸馏样本\d+$/, '')}”感兴趣，但还不知道怎样变成课堂里能研究的问题。`;
}

function buildTask(record: ShareGPTRecord, index: number): DatasetV3Task {
  const phase = record.phase as Phase;
  const context = syntheticContext(record);
  const transformation = expected(record);
  const priorSummary = priorSummaryFor(phase, transformation, context);
  const scenario = record.scenario.replace(/-蒸馏样本\d+$/, '');
  return {
    id: `dataset-v3-${record.id}`,
    parentLegacyRecordId: record.id,
    familyKey: familyKey(record),
    phase,
    scenario,
    styleFamily: STYLE_FAMILIES[index % STYLE_FAMILIES.length],
    triggerType: triggerFor(phase),
    studentVisible: {
      profile: typeof record.meta?.studentType === 'string' ? record.meta.studentType : '普通初中生',
      openingMessage: openingFor(record, phase),
      brief: [
        `我正在做“${scenario}”主题的探究。`,
        phase === 1 ? '我还没有确定具体变量、组别、测量方法或步骤。' : '我只会依据已确认的前序状态回答导师。',
      ],
      realRows: phase >= 4 ? context.rows : [],
    },
    tutorVisible: {
      priorSummary,
      dataRows: phase === 4 ? context.rows : undefined,
      dataSchema: phase === 4 ? { columns: context.columns, minRows: 3, maxRows: 200 } : undefined,
    },
    evaluatorOnly: {
      expectedTransformation: transformation,
      failureModes: Array.isArray(record.meta?.failureModes) ? record.meta.failureModes.map(String) : [],
      rubricTargets: record.rubricTargets ?? [],
    },
  };
}

function balancedSelect(tasks: DatasetV3Task[], target: number): DatasetV3Task[] {
  const buckets = new Map<Phase, DatasetV3Task[]>();
  for (const task of tasks) {
    if (!buckets.has(task.phase)) buckets.set(task.phase, []);
    buckets.get(task.phase)!.push(task);
  }
  const selected: DatasetV3Task[] = [];
  const usedFamilies = new Set<string>();
  const phases: Phase[] = [1, 2, 3, 4, 5, 6];
  let round = 0;
  while (selected.length < Math.min(target, tasks.length)) {
    let addedThisRound = false;
    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
      const phase = phases[phaseIndex];
      const bucket = buckets.get(phase) ?? [];
      const fresh = bucket.findIndex((task) => !usedFamilies.has(task.familyKey));
      const taskIndex = fresh >= 0 ? fresh : bucket.length > 0 ? 0 : -1;
      if (taskIndex < 0) continue;
      const [task] = bucket.splice(taskIndex, 1);
      selected.push({
        ...task,
        styleFamily: STYLE_FAMILIES[(round + phaseIndex) % STYLE_FAMILIES.length],
      });
      usedFamilies.add(task.familyKey);
      addedThisRound = true;
      if (selected.length >= target) break;
    }
    if (!addedThisRound) break;
    round++;
  }
  return selected;
}

async function main() {
  const legacyFile = path.resolve(flag('--legacy', 'data/sft/sharegpt-distill-dsv4-all-clean.json')!);
  const outFile = path.resolve(flag('--out', 'data/sft/v3/plans/plan-v3.json')!);
  const dispositionFile = path.resolve(flag('--disposition-out', 'data/sft/v3/legacy-489-disposition.json')!);
  const target = intFlag('--target', 400);
  const records = JSON.parse(await readFile(legacyFile, 'utf8')) as ShareGPTRecord[];
  const eligible = records.filter((record) => Number.isInteger(record.phase) && record.phase >= 1 && record.phase <= 6);
  const tasks = balancedSelect(eligible.map(buildTask), target);
  const plan: DatasetV3Plan = {
    schemaVersion: 3,
    stageContractVersion: STAGE_CONTRACT_VERSION,
    createdAt: new Date().toISOString(),
    sourceFile: path.relative(process.cwd(), legacyFile),
    sourceUsage: 'SCENARIO_SEEDS_ONLY',
    tasks,
  };
  const disposition = {
    schemaVersion: 1,
    sourceFile: path.relative(process.cwd(), legacyFile),
    disposition: 'LEGACY_QUARANTINED',
    sftEligibility: 'BLOCKED',
    records: records.map((record) => ({
      id: record.id,
      phase: record.phase,
      familyKey: familyKey(record),
      allowedUses: ['scenario_seed', 'rejected_preference', 'regression_case'],
    })),
  };
  await Promise.all([
    mkdir(path.dirname(outFile), { recursive: true }),
    mkdir(path.dirname(dispositionFile), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(outFile, `${JSON.stringify(plan, null, 2)}\n`, 'utf8'),
    writeFile(dispositionFile, `${JSON.stringify(disposition, null, 2)}\n`, 'utf8'),
  ]);
  const byPhase = Object.fromEntries([1, 2, 3, 4, 5, 6].map((phase) => [`P${phase}`, tasks.filter((task) => task.phase === phase).length]));
  const byStyle = Object.fromEntries(STYLE_FAMILIES.map((style) => [style, tasks.filter((task) => task.styleFamily === style).length]));
  console.log(JSON.stringify({ source: records.length, selected: tasks.length, byPhase, byStyle, outFile, dispositionFile }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
