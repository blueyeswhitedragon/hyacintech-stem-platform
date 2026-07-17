#!/usr/bin/env tsx
import './load-script-env';
import { db } from '../app/lib/db';
import type { SessionUser } from '../app/lib/session';
import {
  compileTutorTurnCases,
  generateTutorCandidates,
  retryTutorCandidateCritics,
  trialQualityReport,
} from '../app/lib/dataLab/bootstrap/service';

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string) {
  return process.argv.includes(name);
}

function normalizedBase(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/+$/, '');
}

async function probeProvider(label: string, baseURL: string, apiKey: string | undefined) {
  if (!apiKey) throw new Error(`${label} 缺少 API key`);
  let parsedBase: URL;
  try { parsedBase = new URL(baseURL); } catch { throw new Error(`${label} API base 不是有效的 http(s) URL`); }
  if (!['http:', 'https:'].includes(parsedBase.protocol)) throw new Error(`${label} API base 必须使用 http(s)`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseURL}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`${label} 预检通过：${parsedBase.host}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
    throw new Error(`${label} 无法连接 ${parsedBase.host}：${detail}${cause instanceof Error ? `：${cause.message}` : ''}`);
  } finally {
    clearTimeout(timer);
  }
}

function tokenUsage(candidate: { generationParamsJson: string; critiqueJson: string }) {
  let tutor = 0; let critic = 0;
  try { tutor = Number((JSON.parse(candidate.generationParamsJson) as { usage?: { totalTokens?: number } }).usage?.totalTokens ?? 0); } catch {}
  try { critic = Number((JSON.parse(candidate.critiqueJson) as { params?: { usage?: { totalTokens?: number } } }).params?.usage?.totalTokens ?? 0); } catch {}
  return { tutor, critic };
}

async function main() {
  const username = arg('--admin') ?? 'data-admin';
  const batch = arg('--batch') ?? 'canary';
  const confirmedCost = has('--confirm-cost');
  let runId = arg('--run-id');
  if (!['canary', '1', '2', '3'].includes(batch)) throw new Error('--batch 必须是 canary / 1 / 2 / 3');

  const adminRow = await db.user.findFirst({ where: { username, role: 'admin', isActive: true } });
  if (!adminRow) throw new Error(`找不到可用管理员账号：${username}`);
  const user: SessionUser = { id: adminRow.id, username: adminRow.username, displayName: adminRow.displayName, role: 'admin' };

  if (!runId) {
    const compiled = await compileTutorTurnCases({ profile: 'TRIAL_36', split: 'PILOT', user });
    runId = compiled.runId;
    console.log(JSON.stringify({ event: 'TRIAL_COMPILED', runId, cases: compiled.cases.length, promptVersion: compiled.promptVersion }, null, 2));
  }

  const run = await db.bootstrapGenerationRun.findFirst({
    where: { id: runId, kind: 'CASE_COMPILATION', parametersJson: { contains: '"profile":"TRIAL_36"' } },
    include: { cases: { orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (!run) throw new Error(`Trial 36 run 不存在：${runId}`);
  if (run.cases.length !== 36) throw new Error(`Trial 36 应有 36 条案例，当前为 ${run.cases.length}`);

  const canaryIds = new Set([1, 2, 4].flatMap((phase) => run.cases.filter((item) => item.phase === phase).slice(0, 2).map((item) => item.id)));
  const remaining = run.cases.filter((item) => !canaryIds.has(item.id));
  const remainingByPhase = Object.fromEntries([1, 2, 4].map((phase) => [phase, remaining.filter((item) => item.phase === phase)])) as Record<number, typeof remaining>;
  const batchCases: Record<string, typeof remaining> = {
    '1': [...remainingByPhase[1].slice(0, 4), ...remainingByPhase[2].slice(0, 3), ...remainingByPhase[4].slice(0, 3)],
    '2': [...remainingByPhase[1].slice(4, 7), ...remainingByPhase[2].slice(3, 7), ...remainingByPhase[4].slice(3, 6)],
    '3': [...remainingByPhase[1].slice(7, 10), ...remainingByPhase[2].slice(7, 10), ...remainingByPhase[4].slice(6, 10)],
  };
  const selected = batch === 'canary'
    ? run.cases.filter((item) => canaryIds.has(item.id))
    : batchCases[batch];
  if (selected.length !== (batch === 'canary' ? 6 : 10)) throw new Error(`批次 ${batch} 数量异常：${selected.length}`);

  console.log(JSON.stringify({ event: 'TRIAL_BATCH_SELECTED', runId, batch, cases: selected.map((item) => ({ id: item.id, phase: item.phase, challenge: (JSON.parse(item.privateReviewSpecJson) as { challenge?: string }).challenge, status: item.status })) }, null, 2));
  if (!confirmedCost) {
    console.log(JSON.stringify({ event: 'GENERATION_NOT_STARTED', message: '加 --confirm-cost 后才会预检并调用模型。' }, null, 2));
    return;
  }

  const modelA = { provider: process.env.DATA_LAB_MODEL_A_PROVIDER ?? 'openai', model: process.env.DATA_LAB_MODEL_A ?? 'Qwen3.5-35B-A3B' };
  const modelB = { provider: process.env.DATA_LAB_MODEL_B_PROVIDER ?? 'deepseek', model: process.env.DATA_LAB_MODEL_B ?? 'deepseek-v4-pro' };
  await probeProvider(`候选 A (${modelA.model})`, normalizedBase(process.env.OPENAI_API_BASE, 'https://api.openai.com/v1'), process.env.OPENAI_API_KEY);
  await probeProvider(`候选 B (${modelB.model})`, normalizedBase(process.env.DEEPSEEK_API_BASE, 'https://api.deepseek.com'), process.env.DEEPSEEK_API_KEY);

  const results: Array<{ caseId: string; phase: number; challenge: string; status: string; detail?: unknown }> = [];
  for (const [index, caseItem] of selected.entries()) {
    const challenge = (JSON.parse(caseItem.privateReviewSpecJson) as { challenge?: string }).challenge ?? '';
    const prefix = `[${index + 1}/${selected.length}] P${caseItem.phase} ${challenge}`;
    const current = await db.tutorTurnCase.findUniqueOrThrow({ where: { id: caseItem.id } });
    if (current.status === 'NEEDS_CRITIC') {
      console.log(`${prefix}：仅重试 Critic`);
      const result = await retryTutorCandidateCritics({ caseId: current.id, user });
      results.push({ caseId: current.id, phase: current.phase, challenge, status: result.status, detail: result.failedStages });
      continue;
    }
    if (!['READY', 'NEEDS_REGEN'].includes(current.status)) {
      console.log(`${prefix}：跳过（${current.status}）`);
      results.push({ caseId: current.id, phase: current.phase, challenge, status: `SKIPPED_${current.status}` });
      continue;
    }
    console.log(`${prefix}：生成 A/B 与交叉 Critic`);
    try {
      const result = await generateTutorCandidates({ caseId: current.id, modelA, modelB, user });
      results.push({ caseId: current.id, phase: current.phase, challenge, status: result.status, detail: result.failedStages });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`${prefix}：FAILED ${detail}`);
      results.push({ caseId: current.id, phase: current.phase, challenge, status: 'FAILED', detail });
    }
  }

  const refreshed = await db.tutorTurnCase.findMany({
    where: { id: { in: selected.map((item) => item.id) } },
    include: { candidates: true, reviewTasks: true },
  });
  let tutorTokens = 0; let criticTokens = 0; let deterministicWarnings = 0; let hardErrors = 0; let criticIssues = 0; let criticAdvisories = 0;
  const candidateStatuses: Record<string, number> = {};
  for (const caseItem of refreshed) for (const candidate of caseItem.candidates) {
    candidateStatuses[candidate.status] = (candidateStatuses[candidate.status] ?? 0) + 1;
    const usage = tokenUsage(candidate); tutorTokens += usage.tutor; criticTokens += usage.critic;
    try {
      const check = JSON.parse(candidate.deterministicCheckJson) as { hardErrorCount?: number; warningCount?: number };
      hardErrors += Number(check.hardErrorCount ?? 0); deterministicWarnings += Number(check.warningCount ?? 0);
    } catch {}
    try {
      const critique = JSON.parse(candidate.critiqueJson) as { issues?: unknown[]; advisories?: unknown[] };
      criticIssues += critique.issues?.length ?? 0; criticAdvisories += critique.advisories?.length ?? 0;
    } catch {}
  }
  const caseStatuses = Object.fromEntries([...new Set(refreshed.map((item) => item.status))].map((status) => [status, refreshed.filter((item) => item.status === status).length]));
  const report = await trialQualityReport(runId);
  console.log(JSON.stringify({
    event: 'TRIAL_BATCH_FINISHED', runId, batch, caseStatuses, candidateStatuses,
    hardErrors, deterministicWarnings, criticIssues, criticAdvisories,
    tutorTokens, criticTokens, totalRecordedTokens: tutorTokens + criticTokens,
    editTasks: refreshed.flatMap((item) => item.reviewTasks).filter((task) => task.type === 'EDIT').length,
    results, qualityBeforeHumanReview: report,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
