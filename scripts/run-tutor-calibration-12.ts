#!/usr/bin/env tsx
import './load-script-env';
import { db } from '../app/lib/db';
import type { SessionUser } from '../app/lib/session';
import {
  calibrationQualityReport,
  compileTutorTurnCases,
  generateTutorCandidates,
  retryTutorCandidateCritics,
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
  try {
    parsedBase = new URL(baseURL);
  } catch {
    throw new Error(`${label} API base 不是有效的 http(s) URL；请检查对应 *_API_BASE`);
  }
  if (!['http:', 'https:'].includes(parsedBase.protocol)) throw new Error(`${label} API base 必须使用 http(s)`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseURL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} 预检失败：HTTP ${response.status}`);
    console.log(`${label} 预检通过：${parsedBase.host}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
    const causeText = cause instanceof Error ? `：${cause.message}` : '';
    throw new Error(`${label} 无法连接 ${parsedBase.host}：${detail}${causeText}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const username = arg('--admin') ?? 'data-admin';
  const confirmedCost = has('--confirm-cost');
  let runId = arg('--run-id');
  const adminRow = await db.user.findFirst({ where: { username, role: 'admin', isActive: true } });
  if (!adminRow) throw new Error(`找不到可用管理员账号：${username}`);
  const user: SessionUser = {
    id: adminRow.id,
    username: adminRow.username,
    displayName: adminRow.displayName,
    role: 'admin',
  };

  if (!runId) {
    const compiled = await compileTutorTurnCases({ profile: 'CALIBRATION_12', split: 'PILOT', allowExistingRun: true, user });
    runId = compiled.runId;
    console.log(JSON.stringify({ event: 'CALIBRATION_COMPILED', runId, cases: compiled.cases.length }, null, 2));
  }

  const run = await db.bootstrapGenerationRun.findFirst({
    where: { id: runId, kind: 'CASE_COMPILATION', parametersJson: { contains: '"profile":"CALIBRATION_12"' } },
    include: { cases: { orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (!run) throw new Error(`Calibration 12 run 不存在：${runId}`);
  if (run.cases.length !== 12) throw new Error(`Calibration 12 应有 12 条案例，当前为 ${run.cases.length}`);

  if (!confirmedCost) {
    console.log(JSON.stringify({
      event: 'GENERATION_NOT_STARTED',
      runId,
      message: '案例已编译。实际生成最多会调用 24 次 Tutor 与 24 次 Critic 请求；请加 --confirm-cost 后重跑。',
    }, null, 2));
    return;
  }

  const modelA = { provider: process.env.DATA_LAB_MODEL_A_PROVIDER ?? 'openai', model: process.env.DATA_LAB_MODEL_A ?? 'Qwen3.5-35B-A3B' };
  const modelB = { provider: process.env.DATA_LAB_MODEL_B_PROVIDER ?? 'deepseek', model: process.env.DATA_LAB_MODEL_B ?? 'deepseek-v4-pro' };
  await probeProvider(`候选 A (${modelA.model})`, normalizedBase(process.env.OPENAI_API_BASE, 'https://api.openai.com/v1'), process.env.OPENAI_API_KEY);
  await probeProvider(`候选 B (${modelB.model})`, normalizedBase(process.env.DEEPSEEK_API_BASE, 'https://api.deepseek.com'), process.env.DEEPSEEK_API_KEY);
  const results: Array<{ caseId: string; phase: number; challenge: string; status: string; detail?: unknown }> = [];

  for (const [index, caseItem] of run.cases.entries()) {
    const spec = JSON.parse(caseItem.privateReviewSpecJson) as { challenge?: string };
    const prefix = `[${index + 1}/${run.cases.length}] P${caseItem.phase} ${spec.challenge ?? ''}`;
    if (caseItem.status === 'NEEDS_CRITIC') {
      console.log(`${prefix}：仅重试 Critic`);
      const result = await retryTutorCandidateCritics({ caseId: caseItem.id, user });
      results.push({ caseId: caseItem.id, phase: caseItem.phase, challenge: spec.challenge ?? '', status: result.status, detail: result.failedStages });
      continue;
    }
    if (!['READY', 'NEEDS_REGEN'].includes(caseItem.status)) {
      console.log(`${prefix}：跳过（${caseItem.status}）`);
      results.push({ caseId: caseItem.id, phase: caseItem.phase, challenge: spec.challenge ?? '', status: `SKIPPED_${caseItem.status}` });
      continue;
    }
    console.log(`${prefix}：生成 A/B 与交叉 Critic`);
    try {
      const result = await generateTutorCandidates({ caseId: caseItem.id, modelA, modelB, user });
      results.push({ caseId: caseItem.id, phase: caseItem.phase, challenge: spec.challenge ?? '', status: result.status, detail: result.failedStages });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`${prefix}：FAILED ${detail}`);
      results.push({ caseId: caseItem.id, phase: caseItem.phase, challenge: spec.challenge ?? '', status: 'FAILED', detail });
    }
  }

  const refreshed = await db.tutorTurnCase.findMany({
    where: { generationRunId: runId },
    select: { id: true, status: true, candidates: { select: { status: true, generationParamsJson: true } }, reviewTasks: { select: { type: true, status: true } } },
  });
  const tokens = refreshed.flatMap((item) => item.candidates).reduce((sum, candidate) => {
    try {
      const params = JSON.parse(candidate.generationParamsJson) as { usage?: { totalTokens?: number } };
      return sum + Number(params.usage?.totalTokens ?? 0);
    } catch {
      return sum;
    }
  }, 0);
  const statusCounts = Object.fromEntries([...new Set(refreshed.map((item) => item.status))].map((status) => [status, refreshed.filter((item) => item.status === status).length]));
  const report = await calibrationQualityReport(runId);
  console.log(JSON.stringify({ event: 'CALIBRATION_GENERATION_FINISHED', runId, statusCounts, recordedTokens: tokens, results, qualityBeforeHumanReview: report }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
