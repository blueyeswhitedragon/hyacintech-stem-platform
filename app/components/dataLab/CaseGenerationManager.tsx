'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Dialog, { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import {
  REVIEW_POLICY_LABELS,
  TOPIC_CONTEXT_MODULE_LABELS,
  TOPIC_DISCIPLINE_LABELS,
  TRAINING_ELIGIBILITY_LABELS,
  TRIGGER_TYPE_LABELS,
  TUTOR_SPLIT_LABELS,
  dataLabStatusLabel,
  formatGateMetric,
  gateFailureLabel,
  hardCheckErrorLabel,
} from '@/app/lib/dataLab/labels';

type Profile = 'SMOKE_6' | 'CALIBRATION_12' | 'TRIAL_36' | 'FULL_180' | 'EVAL_80';

interface CaseView {
  id: string;
  phase: number;
  triggerType: string;
  studentMessage: string;
  split: string;
  status: string;
  promptVersion: string;
  hardCheckJson: string;
  topicCard: { displayTitle: string; subject: string; status: string } | null;
  generationRun: {
    id: string;
    status: string;
    reviewPolicy: string;
    parametersJson: string;
    createdAt: string | Date;
    completedAt: string | Date | null;
    failureReason: string;
  } | null;
  _count: { candidates: number; reviewTasks: number };
  finalizedTurn: { id: string; trainingEligibility: string } | null;
}

interface TopicCoverageView {
  coverage: {
    total: number;
    v2Count: number;
    v1Count: number;
    subjects: Record<string, number>;
    contextModules: Record<string, number>;
    engineeringOrHybrid: number;
    engineeringByModule: Record<string, number>;
    duplicateFamilies: Array<{ familyKey: string; count: number }>;
  };
  fullFailures: string[];
}

interface QualityView {
  pass: boolean;
  failures: string[];
  metrics: Record<string, number>;
  runId: string | null;
}

interface RunGroup {
  id: string;
  profile: Profile | 'CUSTOM';
  status: string;
  reviewPolicy: string;
  createdAt: string | Date | null;
  completedAt: string | Date | null;
  failureReason: string;
  cases: CaseView[];
}

const profileOrder: Profile[] = ['SMOKE_6', 'CALIBRATION_12', 'TRIAL_36', 'FULL_180', 'EVAL_80'];

const profileMeta: Record<Profile, { label: string; shortLabel: string; target: number; purpose: string }> = {
  SMOKE_6: { label: '冒烟验证', shortLabel: '冒烟', target: 6, purpose: '先确认提示词、结构和基本审核链路能走通。' },
  CALIBRATION_12: { label: '校准批次', shortLabel: '校准', target: 12, purpose: '复测编辑量、直接确认率和自动信号误报。' },
  TRIAL_36: { label: '试验批次', shortLabel: '试验', target: 36, purpose: '验证规模化前的质量与重复度门禁。' },
  FULL_180: { label: '正式训练集', shortLabel: '正式集', target: 180, purpose: '生成可进入正式双审与数据交付的训练案例。' },
  EVAL_80: { label: '独立评测集', shortLabel: '评测集', target: 80, purpose: '生成不进入训练的数据，用于外部模型评测。' },
};

function isProfile(value: Profile | 'CUSTOM'): value is Profile {
  return value !== 'CUSTOM';
}

function runProfile(raw: string): Profile | 'CUSTOM' {
  try {
    const profile = (JSON.parse(raw) as { profile?: string }).profile;
    return profile && Object.hasOwn(profileMeta, profile) ? profile as Profile : 'CUSTOM';
  } catch {
    return 'CUSTOM';
  }
}

function countStatuses(items: CaseView[]) {
  return {
    ready: items.filter((item) => ['READY', 'NEEDS_REGEN'].includes(item.status)).length,
    critic: items.filter((item) => item.status === 'NEEDS_CRITIC').length,
    editing: items.filter((item) => item.status === 'IN_REVIEW').length,
    confirming: items.filter((item) => item.status === 'AWAITING_CONFIRMATION').length,
    finalized: items.filter((item) => item.status === 'FINALIZED' || Boolean(item.finalizedTurn)).length,
    blocked: items.filter((item) => item.status === 'BLOCKED').length,
    superseded: items.filter((item) => item.status === 'SUPERSEDED').length,
  };
}

function hardCheckErrors(item: CaseView) {
  try {
    const errors = (JSON.parse(item.hardCheckJson) as { errors?: unknown }).errors;
    return Array.isArray(errors) ? errors.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function formatDate(value: string | Date | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未记录';
}

export default function CaseGenerationManager({
  cases,
  smoke,
  calibration,
  trial,
  topicCoverage,
  topicRequirements,
  defaultModels,
}: {
  cases: CaseView[];
  smoke: QualityView;
  calibration: QualityView;
  trial: QualityView & { signedOff: boolean };
  topicCoverage: TopicCoverageView;
  topicRequirements: Record<string, { total: number; description: string }>;
  defaultModels: { A: { provider: string; model: string }; B: { provider: string; model: string } };
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [autofillProgress, setAutofillProgress] = useState<{ profile: Profile; current: number; total: number } | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{ runId: string; current: number; total: number } | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [modelA, setModelA] = useState(defaultModels.A);
  const [modelB, setModelB] = useState(defaultModels.B);
  const [reviewPolicy, setReviewPolicy] = useState<'HUMAN_ANNOTATOR_REQUIRED' | 'AI_DIRECT_TO_REVIEWER'>('HUMAN_ANNOTATOR_REQUIRED');
  const [compileConfirmation, setCompileConfirmation] = useState<Profile | null>(null);
  const [generationConfirmation, setGenerationConfirmation] = useState<string | null>(null);
  const [supersedeConfirmation, setSupersedeConfirmation] = useState<string | null>(null);
  const [bulkSupersedeConfirmation, setBulkSupersedeConfirmation] = useState<Profile | null>(null);
  const [dismissedOldRunWarnings, setDismissedOldRunWarnings] = useState<Profile[]>([]);
  const [signoffOpen, setSignoffOpen] = useState(false);
  const [overrideRunId, setOverrideRunId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null);
  const [signoff, setSignoff] = useState({ drift: '', studentVoice: '', signer: '', confirmed: false });
  const pending = pendingAction !== null;

  const groupedRuns = useMemo(() => {
    const groups = new Map<string, RunGroup>();
    for (const item of cases) {
      const id = item.generationRun?.id ?? `source-${item.id}`;
      const group = groups.get(id) ?? {
        id,
        profile: item.generationRun ? runProfile(item.generationRun.parametersJson) : 'CUSTOM',
        status: item.generationRun?.status ?? 'COMPLETED',
        reviewPolicy: item.generationRun?.reviewPolicy ?? 'HUMAN_ANNOTATOR_REQUIRED',
        createdAt: item.generationRun?.createdAt ?? null,
        completedAt: item.generationRun?.completedAt ?? null,
        failureReason: item.generationRun?.failureReason ?? '',
        cases: [],
      };
      group.cases.push(item);
      groups.set(id, group);
    }
    return [...groups.values()].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  }, [cases]);

  const latestByProfile = useMemo(() => {
    const latest = new Map<Profile, RunGroup>();
    for (const group of groupedRuns) {
      if (isProfile(group.profile) && group.status !== 'SUPERSEDED' && group.cases.some((item) => item.status !== 'SUPERSEDED') && !latest.has(group.profile)) {
        latest.set(group.profile, group);
      }
    }
    return latest;
  }, [groupedRuns]);

  const historyRuns = useMemo(() => {
    const latestIds = new Set([...latestByProfile.values()].map((group) => group.id));
    return groupedRuns.filter((group) => !latestIds.has(group.id));
  }, [groupedRuns, latestByProfile]);

  const oldActiveRuns = useMemo(() => historyRuns.filter((group) => isProfile(group.profile) && group.status !== 'SUPERSEDED'), [historyRuns]);
  const selectedGenerationRun = generationConfirmation ? groupedRuns.find((group) => group.id === generationConfirmation) ?? null : null;
  const selectedSupersedeRun = supersedeConfirmation ? groupedRuns.find((group) => group.id === supersedeConfirmation) ?? null : null;
  const fullUnlocked = trial.pass && trial.signedOff && topicCoverage.fullFailures.length === 0;
  const evalUnlocked = trial.pass && trial.signedOff;

  const steps: Array<{ profile: Profile; quality?: QualityView & { signedOff?: boolean }; unlocked: boolean; reason: string }> = [
    { profile: 'SMOKE_6', quality: smoke, unlocked: true, reason: '' },
    { profile: 'CALIBRATION_12', quality: calibration, unlocked: smoke.pass, reason: '完成 6 条冒烟案例并通过门禁后解锁。' },
    { profile: 'TRIAL_36', quality: trial, unlocked: calibration.pass, reason: '完成 12 条校准案例并通过门禁后解锁。' },
    { profile: 'FULL_180', unlocked: fullUnlocked, reason: topicCoverage.fullFailures.length ? '话题库覆盖仍未达标，请先补齐话题类型与数量。' : !trial.pass ? '36 条试验自动门禁尚未通过。' : !trial.signedOff ? '36 条试验尚未完成人工复盘签署。' : '' },
    { profile: 'EVAL_80', unlocked: evalUnlocked, reason: !trial.pass ? '36 条试验自动门禁尚未通过。' : !trial.signedOff ? '36 条试验尚未完成人工复盘签署。' : '' },
  ];

  function start(action: string) {
    setPendingAction(action);
    setFeedback(null);
  }

  function fail(error: unknown) {
    setFeedback({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
  }

  async function compile(profile: Profile, allowExistingRun = false) {
    start(`compile-${profile}`);
    try {
      const response = await fetch('/api/data-lab/tutor-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile,
          split: ['SMOKE_6', 'CALIBRATION_12', 'TRIAL_36'].includes(profile) ? 'PILOT' : profile === 'EVAL_80' ? 'EVAL' : 'TRAIN',
          reviewPolicy,
          allowExistingRun,
        }),
      });
      const data = await response.json();
      if (response.status === 409 && data.code === 'EXISTING_PROFILE_RUN') {
        setCompileConfirmation(profile);
        setFeedback({ tone: 'info', text: '检测到已有有效批次，请确认是否创建新批次。' });
        return;
      }
      if (!response.ok) throw new Error(data.error ?? '案例编译失败');
      const blocked = Array.isArray(data.cases) ? data.cases.filter((item: { status?: string }) => item.status === 'BLOCKED').length : 0;
      const warningText = Array.isArray(data.coverageWarnings) && data.coverageWarnings.length ? `，另有 ${data.coverageWarnings.length} 项话题覆盖提醒` : '';
      setFeedback({ tone: 'success', text: `已编译 ${data.cases.length} 条案例（run: ${String(data.runId).slice(0, 8)}）${blocked ? `，其中 ${blocked} 条被硬检查阻断` : ''}${warningText}。` });
      setCompileConfirmation(null);
      router.refresh();
    } catch (error) {
      fail(error);
    } finally {
      setPendingAction(null);
    }
  }

  function requestCompile(profile: Profile) {
    if (latestByProfile.has(profile)) setCompileConfirmation(profile);
    else void compile(profile);
  }

  async function signoffTrial() {
    if (!signoff.drift.trim() || !signoff.studentVoice.trim() || !signoff.signer.trim() || !signoff.confirmed) return;
    start('trial-signoff');
    try {
      const note = `主题漂移复盘：${signoff.drift.trim()}\n伪学生表达复盘：${signoff.studentVoice.trim()}\n签署人：${signoff.signer.trim()}\n签署确认：已逐条完成团队复盘`;
      const response = await fetch('/api/data-lab/bootstrap-runs/trial-quality', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '签署失败');
      setFeedback({ tone: 'success', text: '36 条试验已完成人工签署，正式训练集现已解锁。' });
      setSignoffOpen(false);
      router.refresh();
    } catch (error) {
      fail(error);
    } finally {
      setPendingAction(null);
    }
  }

  async function generateAll(runId: string) {
    const group = groupedRuns.find((item) => item.id === runId);
    const targets = group?.cases.filter((item) => ['READY', 'NEEDS_REGEN'].includes(item.status)) ?? [];
    if (!targets.length) return;
    setGenerationConfirmation(null);
    start(`generate-${runId}`);
    setGenerationProgress({ runId, current: 0, total: targets.length });
    let completed = 0;
    try {
      for (const item of targets) {
        const response = await fetch(`/api/data-lab/tutor-cases/${item.id}/candidates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelA, modelB }) });
        const data = await response.json();
        if (!response.ok) throw new Error(`阶段 ${item.phase}“${item.topicCard?.displayTitle ?? '生产回流案例'}”：${data.error ?? '候选生成失败'}`);
        if (data.status === 'PARTIAL_FAILED') throw new Error(`阶段 ${item.phase}“${item.topicCard?.displayTitle ?? '生产回流案例'}”的部分交叉检查失败`);
        completed += 1;
        setGenerationProgress({ runId, current: completed, total: targets.length });
        setFeedback({ tone: 'info', text: `双候选生成进度 ${completed}/${targets.length}` });
      }
      setFeedback({ tone: 'success', text: `${completed} 条案例已生成双候选并进入初审队列。` });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: 'error', text: `已完成 ${completed}/${targets.length} 条；${error instanceof Error ? error.message : String(error)}` });
      router.refresh();
    } finally {
      setGenerationProgress(null);
      setPendingAction(null);
    }
  }

  async function curateAll(group: RunGroup) {
    const items = group.cases.filter((item) => item.status === 'IN_REVIEW' && item.generationRun?.reviewPolicy === 'AI_DIRECT_TO_REVIEWER');
    if (!items.length) {
      setFeedback({ tone: 'info', text: '这个批次没有等待 AI 初审的案例。' });
      return;
    }
    start(`curate-${group.id}`);
    let completed = 0;
    try {
      for (const item of items) {
        const response = await fetch(`/api/data-lab/tutor-cases/${item.id}/ai-draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await response.json();
        if (!response.ok) throw new Error(`阶段 ${item.phase}“${item.topicCard?.displayTitle ?? '生产回流案例'}”：${data.error ?? 'AI 初审失败'}`);
        completed += 1;
      }
      setFeedback({ tone: 'success', text: `${completed} 条 AI 初审建议稿已送入正式定稿队列。` });
      router.refresh();
    } catch (error) {
      fail(error);
    } finally {
      setPendingAction(null);
    }
  }

  async function retryCritics(caseId: string) {
    start(`critic-${caseId}`);
    try {
      const response = await fetch(`/api/data-lab/tutor-cases/${caseId}/retry-critics`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '交叉检查重试失败');
      setFeedback(data.status === 'COMPLETED' ? { tone: 'success', text: '失败的交叉检查已补齐，案例进入初审。' } : { tone: 'error', text: '仍有交叉检查失败，本次证据已保留，可稍后重试。' });
      router.refresh();
    } catch (error) {
      fail(error);
    } finally {
      setPendingAction(null);
    }
  }

  async function autofillTopicGaps(profile: Profile) {
    start(`autofill-${profile}`);
    setAutofillProgress(null);
    try {
      const gaps: Array<{ contextModule: string; activityMode: string }> = [];
      if (profile === 'FULL_180') {
        for (const failure of topicCoverage.fullFailures) {
          const parts = failure.split(':');
          if (parts[0] === 'FULL_REQUIRES_3_TOPIC_CARDS_PER_CONTEXT_MODULE') gaps.push({ contextModule: parts[1], activityMode: '' });
          else if (parts[0] === 'FULL_REQUIRES_ENGINEERING_OR_HYBRID_PER_CONTEXT_MODULE') gaps.push({ contextModule: parts[1], activityMode: 'ENGINEERING_DESIGN' });
          else if (parts[0] === 'FULL_REQUIRES_6_ENGINEERING_OR_HYBRID_TOPIC_CARDS') gaps.push({ contextModule: '', activityMode: 'ENGINEERING_DESIGN' });
        }
      }
      const requirement = topicRequirements[profile];
      const totalGap = Math.max((requirement?.total ?? 1) - topicCoverage.coverage.total, 0);
      const gapsToFill = (gaps.length ? gaps : Array.from({ length: totalGap }, () => ({ contextModule: '', activityMode: '' }))).slice(0, 5);
      if (!gapsToFill.length) {
        setFeedback({ tone: 'info', text: '没有可自动补全的数量缺口，请按门禁提示手动检查话题覆盖。' });
        return;
      }
      let completed = 0;
      let failed = 0;
      setAutofillProgress({ profile, current: 0, total: gapsToFill.length });
      for (let index = 0; index < gapsToFill.length; index += 1) {
        const gap = gapsToFill[index];
        setAutofillProgress({ profile, current: index + 1, total: gapsToFill.length });
        const response = await fetch('/api/data-lab/topic-cards/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 1, contextModule: gap.contextModule || undefined, activityMode: gap.activityMode || undefined }),
        });
        const data = await response.json();
        if (response.ok) completed += data.completed ?? 0;
        else failed += 1;
      }
      setFeedback({ tone: completed ? 'success' : 'error', text: `已生成 ${completed} 张话题卡草稿${failed ? `，${failed} 张失败` : ''}。请到话题库审批后再编译案例。` });
      router.refresh();
    } catch (error) {
      fail(error);
    } finally {
      setAutofillProgress(null);
      setPendingAction(null);
    }
  }

  async function supersedeRuns(runs: RunGroup[]) {
    if (!runs.length) return;
    setSupersedeConfirmation(null);
    setBulkSupersedeConfirmation(null);
    start(runs.length === 1 ? `supersede-${runs[0].id}` : `supersede-${runs[0].profile}`);
    let completed = 0;
    const failures: string[] = [];
    for (const group of runs) {
      try {
        const response = await fetch(`/api/data-lab/bootstrap-runs/${group.id}/supersede`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: '由管理员在案例批次页清理旧批次；门禁只使用最新有效批次' }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '标记失败');
        completed += 1;
      } catch (error) {
        failures.push(`${group.id.slice(0, 8)}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    setFeedback({
      tone: failures.length ? (completed ? 'info' : 'error') : 'success',
      text: `${completed} 个旧批次已标记为已替代${failures.length ? `；${failures.join('；')}` : ''}。`,
    });
    setPendingAction(null);
    router.refresh();
  }

  async function overrideBlocked() {
    const runId = overrideRunId;
    if (!runId || !overrideReason.trim()) return;
    start(`override-${runId}`);
    try {
      const response = await fetch(`/api/data-lab/bootstrap-runs/${runId}/override-blocked`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: overrideReason.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '解锁失败');
      setFeedback({ tone: 'success', text: `已解锁 ${data.unblocked} 条阻断案例为待生成状态。` });
      setOverrideRunId(null);
      setOverrideReason('');
      router.refresh();
    } catch (error) { fail(error); }
    finally { setPendingAction(null); }
  }

  async function deleteRun(runId: string) {
    start(`delete-${runId}`);
    try {
      const response = await fetch(`/api/data-lab/bootstrap-runs/${runId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '删除失败');
      setFeedback({ tone: 'success', text: `已删除批次（${data.deleted} 条案例）。` });
      setDeleteRunId(null);
      router.refresh();
    } catch (error) { fail(error); }
    finally { setPendingAction(null); }
  }

  return <div className="space-y-5">
    <details className="border border-blue-200 bg-blue-50 p-4">
      <summary className="cursor-pointer font-medium text-blue-950">如何从话题卡创建案例批次？</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-blue-950">
        <li>话题库中已批准的话题卡是案例来源。</li>
        <li>编译案例时，系统把话题卡与固定场景模板组合成学生消息和导师任务；这一步不调用 LLM。</li>
        <li>每类批次有独立的话题卡数量要求。编译后再调用模型生成双候选，随后进入初审和定稿。</li>
      </ol>
      <p className="mt-3 text-sm text-blue-950">当前已批准话题卡：<b>{topicCoverage.coverage.total}</b> 张。<Link href="/data-lab/topic-cards" className="ml-2 font-medium text-blue-700 hover:underline">前往话题库</Link></p>
    </details>

    {feedback && <p aria-live="polite" className={`border p-3 text-sm ${feedback.tone === 'success' ? 'border-green-200 bg-green-50 text-green-900' : feedback.tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>{feedback.text}</p>}

    <details className={`border p-4 ${topicCoverage.fullFailures.length ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'}`}>
      <summary className="cursor-pointer font-semibold">正式集话题覆盖</summary>
      <p className="mt-2 text-sm text-gray-600">已批准 {topicCoverage.coverage.total} 张，其中新版 {topicCoverage.coverage.v2Count} 张；工程或混合型 {topicCoverage.coverage.engineeringOrHybrid} 张。</p>
      <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
        <div><b>情境模块</b>{Object.entries(topicCoverage.coverage.contextModules).map(([key, value]) => <div key={key} className="mt-1">{TOPIC_CONTEXT_MODULE_LABELS[key] ?? '其他情境'}：{value} 张（工程或混合 {topicCoverage.coverage.engineeringByModule[key] ?? 0} 张）</div>)}</div>
        <div><b>旧版学科分类（兼容统计）</b>{Object.entries(topicCoverage.coverage.subjects).map(([key, value]) => <div key={key} className="mt-1">{TOPIC_DISCIPLINE_LABELS[key] ?? '其他学科'}：{value} 张</div>)}</div>
      </div>
      {topicCoverage.fullFailures.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-950">{topicCoverage.fullFailures.map((failure, index) => <li key={`${failure}-${index}`}>{gateFailureLabel(failure)}</li>)}</ul>}
    </details>

    <section className="border-y bg-white py-5">
      <div className="px-4 sm:px-5">
        <h2 className="font-semibold">批次设置</h2>
        <p className="mt-1 text-xs text-gray-500">编译只创建确定性案例；模型配置仅在第二步生成双候选时使用。</p>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(240px,0.7fr)_minmax(0,1fr)]">
          <label className="block text-sm font-medium">初审方式
            <select value={reviewPolicy} onChange={(event) => setReviewPolicy(event.target.value as typeof reviewPolicy)} className="mt-1 block w-full border bg-white px-3 py-2 font-normal">
              <option value="HUMAN_ANNOTATOR_REQUIRED">{REVIEW_POLICY_LABELS.HUMAN_ANNOTATOR_REQUIRED}</option>
              <option value="AI_DIRECT_TO_REVIEWER">{REVIEW_POLICY_LABELS.AI_DIRECT_TO_REVIEWER}</option>
            </select>
            <span className="mt-1 block text-xs font-normal leading-5 text-gray-500">AI 初审仍需独立人工定稿，并会记录授权来源。</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">{[[modelA, setModelA, 'A'], [modelB, setModelB, 'B']].map(([model, setter, slot]) => {
            const item = model as typeof modelA;
            const set = setter as typeof setModelA;
            return <fieldset key={String(slot)} className="border p-3"><legend className="px-1 text-sm font-medium">候选 {String(slot)}</legend><label className="block text-xs font-medium">模型服务商<input value={item.provider} onChange={(event) => set({ ...item, provider: event.target.value })} className="mt-1 w-full border px-2 py-1.5 font-normal" /></label><label className="mt-2 block text-xs font-medium">外部模型标识<input value={item.model} onChange={(event) => set({ ...item, model: event.target.value })} className="mt-1 w-full border px-2 py-1.5 font-normal" /></label></fieldset>;
          })}</div>
        </div>
      </div>
    </section>

    <section>
      <div><h2 className="font-semibold">批次进度</h2><p className="mt-1 text-sm text-gray-500">每类批次只按最新有效 run 计算进度和门禁；旧 run 收入下方历史记录。</p></div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">{steps.map((step) => {
        const meta = profileMeta[step.profile];
        const group = latestByProfile.get(step.profile);
        const counts = countStatuses(group?.cases ?? []);
        const requirement = topicRequirements[step.profile] ?? { total: 1, description: '至少 1 张已批准话题卡' };
        const fullTopicReady = step.profile !== 'FULL_180' || topicCoverage.fullFailures.length === 0;
        const topicReady = topicCoverage.coverage.total >= requirement.total && fullTopicReady;
        const blockedCases = group?.cases.filter((item) => item.status === 'BLOCKED') ?? [];
        const criticCases = group?.cases.filter((item) => item.status === 'NEEDS_CRITIC') ?? [];
        const activeOld = oldActiveRuns.filter((item) => item.profile === step.profile);
        const statusLabel = !step.unlocked ? '未解锁' : step.quality?.pass ? '门禁通过' : group ? '进行中' : '可编译';
        const statusTone = !step.unlocked ? 'bg-gray-100 text-gray-600' : step.quality?.pass ? 'bg-green-100 text-green-800' : group ? 'bg-blue-100 text-blue-800' : 'bg-white text-gray-700';
        const generateProgress = generationProgress?.runId === group?.id ? generationProgress : null;
        return <article key={step.profile} className={`border bg-white ${!step.unlocked ? 'border-gray-200 bg-gray-50' : step.quality?.pass ? 'border-green-300' : group ? 'border-blue-300' : 'border-gray-300'}`}>
          <header className="border-b p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{meta.label} · {meta.target} 条</h3><span className={`px-2 py-1 text-xs font-medium ${statusTone}`}>{statusLabel}</span></div><p className="mt-1 text-xs leading-5 text-gray-500">{meta.purpose}</p></div>
              {activeOld.length > 0 && <button type="button" onClick={() => document.getElementById('case-run-history')?.scrollIntoView({ behavior: 'smooth' })} className="border px-2 py-1 text-xs text-gray-700">{activeOld.length} 个旧批次</button>}
            </div>
            {group ? <><p className="mt-3 text-sm font-medium">{group.cases.length} 条案例：{counts.finalized} 已定稿 / {counts.ready} 待生成 / {counts.blocked} 阻断{counts.editing ? ` / ${counts.editing} 初审中` : ''}{counts.confirming ? ` / ${counts.confirming} 待定稿` : ''}</p><p className="mt-1 text-xs text-gray-500">run: {group.id.slice(0, 8)} · 创建于 {formatDate(group.createdAt)}</p></> : <p className="mt-3 text-sm text-gray-500">尚未编译此类案例。</p>}
          </header>

          <div className="divide-y">
            <section className="p-4">
              <div className="flex items-start gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs text-white">1</span><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">编译案例</h4><p className={`mt-1 text-xs ${topicReady ? 'text-green-700' : 'text-red-700'}`}>{topicReady ? `话题卡充足（${topicCoverage.coverage.total}/${requirement.total} 张）` : `话题卡不足或覆盖未达标（${topicCoverage.coverage.total}/${requirement.total} 张）`} · {requirement.description}</p>{group && <p className="mt-2 text-sm">已编译 {group.cases.length} 条（{counts.ready} 待生成、{counts.blocked} 阻断）</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={pending || !step.unlocked || !topicReady} onClick={() => requestCompile(step.profile)} className="border border-gray-900 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-35">{pendingAction === `compile-${step.profile}` ? '编译中…' : `编译 ${meta.target} 条${meta.shortLabel}案例`}</button>{!topicReady && <button type="button" disabled={pending} onClick={() => autofillTopicGaps(step.profile)} className="border border-amber-700 bg-white px-3 py-2 text-sm text-amber-900 disabled:opacity-40">{autofillProgress?.profile === step.profile ? `生成中 ${autofillProgress.current}/${autofillProgress.total}` : `一键补全 ${Math.min(Math.max(requirement.total - topicCoverage.coverage.total, 1), 5)} 张`}</button>}</div>{!step.unlocked && <p className="mt-2 text-xs text-red-700">{step.reason}</p>}
                {blockedCases.length > 0 && <details className="mt-3 border-l-2 border-amber-500 pl-3"><summary className="cursor-pointer text-sm font-medium text-amber-900">查看 {blockedCases.length} 条阻断案例</summary><div className="mt-3 space-y-3">{blockedCases.map((item) => <div key={item.id} className="text-xs leading-5"><div className="font-medium text-gray-900">{item.topicCard?.displayTitle ?? '未命名话题'}（{item.id.slice(0, 8)}）</div>{hardCheckErrors(item).map((error) => <div key={error} className="mt-1 text-red-800">{hardCheckErrorLabel(error)}</div>)}</div>)}<div className="bg-amber-50 p-3 text-xs leading-5 text-amber-950">实际上这些 &quot;泄漏&quot; 出现在给 AI 导师的系统提示词中，学生看不到。如果确认不影响案例质量，可以忽略阻断直接解锁。<div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => { if (group) setOverrideRunId(group.id); }} className="border border-amber-800 bg-white px-3 py-1.5 text-xs text-amber-900 disabled:opacity-40">忽略阻断并解锁为待生成</button><Link href="/data-lab/topic-cards" className="border px-3 py-1.5 text-xs text-blue-700">或前往话题库修改</Link></div></div></div></details>}
              </div></div>
            </section>

            <section className="p-4">
              <div className="flex items-start gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs text-white">2</span><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">生成双候选</h4>{group ? <><p className="mt-1 text-sm">{counts.ready} 条待生成；每条调用模型 A/B 各生成一个回复并交叉检查。</p><button type="button" disabled={pending || counts.ready === 0} onClick={() => setGenerationConfirmation(group.id)} className="mt-3 border border-blue-700 px-3 py-2 text-sm text-blue-700 disabled:opacity-40">{pendingAction === `generate-${group.id}` ? `生成中 ${generateProgress?.current ?? 0}/${generateProgress?.total ?? counts.ready}` : `生成双候选回复（调用 LLM）· ${counts.ready} 条`}</button>{generateProgress && <div className="mt-3"><div className="h-2 overflow-hidden rounded-full bg-gray-200"><div className="h-full bg-blue-700 transition-all" style={{ width: `${generateProgress.total ? (generateProgress.current / generateProgress.total) * 100 : 0}%` }} /></div><p className="mt-1 text-xs text-gray-500">{generateProgress.current}/{generateProgress.total} 已完成</p></div>}{criticCases.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs text-amber-800">{criticCases.length} 条等待补齐交叉检查</summary><div className="mt-2 space-y-2">{criticCases.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs"><span>阶段 {item.phase} · {item.topicCard?.displayTitle ?? item.id.slice(0, 8)}</span><button type="button" disabled={pending} onClick={() => retryCritics(item.id)} className="bg-amber-700 px-2 py-1 text-white disabled:opacity-40">补齐交叉检查</button></div>)}</div></details>}</> : <p className="mt-1 text-sm text-gray-500">先完成步骤 1。</p>}</div></div>
            </section>

            <section className="p-4">
              <div className="flex items-start gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs text-white">3</span><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">双审定稿</h4><p className="mt-1 text-sm">{counts.editing} 条初审中 / {counts.confirming} 条待定稿 / {counts.finalized} 条已定稿</p><div className="mt-3 flex flex-wrap gap-3 text-sm"><Link href="/data-lab/first-review" className="font-medium text-blue-700 hover:underline">前往初审工作台</Link><Link href="/data-lab/final-confirmation" className="font-medium text-blue-700 hover:underline">前往定稿工作台</Link>{group?.reviewPolicy === 'AI_DIRECT_TO_REVIEWER' && counts.editing > 0 && <button type="button" disabled={pending} onClick={() => curateAll(group)} className="border border-violet-700 px-2 py-1 text-xs text-violet-700 disabled:opacity-40">{pendingAction === `curate-${group.id}` ? 'AI 初审中…' : '运行已授权 AI 初审'}</button>}</div></div></div>
            </section>
          </div>

          {step.quality && <details className="border-t p-4"><summary className="cursor-pointer text-sm font-medium">门禁检查{step.quality.pass ? ' · 已通过' : ''}</summary><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">{Object.entries(step.quality.metrics).map(([key, value]) => <span key={key}>{formatGateMetric(key, value)}</span>)}</div>{step.quality.failures.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-red-900">{step.quality.failures.map((failure) => <li key={failure}>{gateFailureLabel(failure)}</li>)}</ul>}{step.profile === 'TRIAL_36' && trial.pass && !trial.signedOff && <button type="button" onClick={() => setSignoffOpen(true)} className="mt-3 bg-green-800 px-3 py-2 text-sm text-white">填写人工复盘并签署</button>}{step.profile === 'TRIAL_36' && trial.signedOff && <p className="mt-3 text-xs text-green-800">人工逐条复盘已签署。</p>}</details>}
        </article>;
      })}</div>
    </section>

    <section id="case-run-history" className="scroll-mt-4 space-y-3">
      <div><h2 className="font-semibold">历史批次记录</h2><p className="mt-1 text-xs text-gray-500">这里展示旧 run、自定义来源和已替代批次；它们不参与最新批次的进度统计。</p></div>
      {profileOrder.map((profile) => {
        const runs = oldActiveRuns.filter((group) => group.profile === profile);
        const ready = runs.reduce((sum, group) => sum + countStatuses(group.cases).ready, 0);
        if (!runs.length || !ready || dismissedOldRunWarnings.includes(profile)) return null;
        const latest = latestByProfile.get(profile);
        return <div key={profile} className="border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p>检测到 {runs.length} 个旧的{profileMeta[profile].label}还有 {ready} 条待生成案例。门禁只看最新批次{latest ? `（${latest.id.slice(0, 8)}）` : ''}，旧案例不影响解锁。</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => setBulkSupersedeConfirmation(profile)} className="border border-amber-800 bg-white px-3 py-2 text-xs">全部标记为已替代</button><button type="button" onClick={() => setDismissedOldRunWarnings([...dismissedOldRunWarnings, profile])} className="px-3 py-2 text-xs text-gray-600">保留</button></div></div>;
      })}
      {historyRuns.map((group) => {
        const counts = countStatuses(group.cases);
        const label = group.profile === 'CUSTOM' ? '自定义或生产回流批次' : `${profileMeta[group.profile].label} · ${profileMeta[group.profile].target} 条`;
        return <article key={group.id} className="border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{label}</h3><span className="bg-gray-100 px-2 py-1 text-xs">{dataLabStatusLabel(group.status)}</span></div><p className="mt-1 text-xs text-gray-500">run: {group.id.slice(0, 8)} · {formatDate(group.createdAt)} · {REVIEW_POLICY_LABELS[group.reviewPolicy] ?? '初审方式待确认'}</p></div><div className="flex flex-wrap gap-3 text-xs"><span>待生成 <b>{counts.ready}</b></span><span>初审中 <b>{counts.editing}</b></span><span>待定稿 <b>{counts.confirming}</b></span><span>已定稿 <b>{counts.finalized}</b></span>{group.status !== 'SUPERSEDED' && group.profile !== 'CUSTOM' && <button type="button" disabled={pending} onClick={() => setSupersedeConfirmation(group.id)} className="border border-red-300 px-2 py-1 text-red-700 disabled:opacity-40">标记为已替代</button>}{(counts.ready + counts.blocked === group.cases.length || group.status === 'SUPERSEDED') && <button type="button" disabled={pending} onClick={() => setDeleteRunId(group.id)} className="border border-red-300 px-2 py-1 text-red-700 disabled:opacity-40">删除</button>}</div></div><details className="mt-3"><summary className="cursor-pointer text-sm text-blue-700">查看 {group.cases.length} 条案例</summary><div className="mt-3 space-y-2">{group.cases.map((item) => <div key={item.id} className="border-t pt-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs text-gray-500">阶段 {item.phase} · {TUTOR_SPLIT_LABELS[item.split] ?? '用途待确认'} · {TRIGGER_TYPE_LABELS[item.triggerType] ?? '触发方式待确认'} · {TOPIC_DISCIPLINE_LABELS[item.topicCard?.subject ?? ''] ?? '生产回流'}</div><h4 className="mt-1 font-medium">{item.topicCard?.displayTitle ?? '生产授权会话回流'}</h4></div><span className="bg-gray-100 px-2 py-1 text-xs">{dataLabStatusLabel(item.status)}</span></div><p className="mt-2 bg-gray-50 p-2 text-xs leading-5">{item.studentMessage || '平台状态触发，本回合没有学生发言。'}</p><div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500"><span>候选 {item._count.candidates}</span><span>审核任务 {item._count.reviewTasks}</span>{item.finalizedTurn && <span>{TRAINING_ELIGIBILITY_LABELS[item.finalizedTurn.trainingEligibility] ?? '训练资格待确认'}</span>}</div></div>)}</div></details></article>;
      })}
      {historyRuns.length === 0 && <p className="border bg-white p-6 text-sm text-gray-500">暂无历史批次。</p>}
    </section>

    <ConfirmDialog open={compileConfirmation !== null} title="确认创建新批次" description={compileConfirmation ? `检测到已有${profileMeta[compileConfirmation].label}（${formatDate(latestByProfile.get(compileConfirmation)?.createdAt ?? null)}）。` : ''} consequence="创建新批次会保留旧批次，但进度与门禁只看最新有效批次。" confirmLabel="确认编译新批次" pending={Boolean(compileConfirmation && pendingAction === `compile-${compileConfirmation}`)} onClose={() => { if (!pending) setCompileConfirmation(null); }} onConfirm={() => { if (compileConfirmation) void compile(compileConfirmation, true); }} />
    <ConfirmDialog open={selectedGenerationRun !== null} title="确认生成双候选" description={selectedGenerationRun ? `将为 run ${selectedGenerationRun.id.slice(0, 8)} 的 ${countStatuses(selectedGenerationRun.cases).ready} 条待处理案例生成两个独立候选并执行交叉检查。` : ''} consequence={selectedGenerationRun ? `预计产生约 ${countStatuses(selectedGenerationRun.cases).ready * 4} 次模型调用，已完成的案例会逐条保存。` : ''} confirmLabel="开始生成双候选" pending={Boolean(selectedGenerationRun && pendingAction === `generate-${selectedGenerationRun.id}`)} onClose={() => { if (!pending) setGenerationConfirmation(null); }} onConfirm={() => { if (selectedGenerationRun) void generateAll(selectedGenerationRun.id); }} />
    <ConfirmDialog open={selectedSupersedeRun !== null} title="标记旧批次为已替代" description={selectedSupersedeRun ? `run ${selectedSupersedeRun.id.slice(0, 8)} 将退出待处理队列。` : ''} consequence="案例和未完成的审核任务会标记为 SUPERSEDED；候选与审计记录保留。包含已定稿或已提交审核记录的批次不会被处理。" confirmLabel="确认标记" danger pending={Boolean(selectedSupersedeRun && pendingAction === `supersede-${selectedSupersedeRun.id}`)} onClose={() => { if (!pending) setSupersedeConfirmation(null); }} onConfirm={() => { if (selectedSupersedeRun) void supersedeRuns([selectedSupersedeRun]); }} />
    <ConfirmDialog open={bulkSupersedeConfirmation !== null} title="清理同类旧批次" description={bulkSupersedeConfirmation ? `将处理 ${oldActiveRuns.filter((group) => group.profile === bulkSupersedeConfirmation).length} 个旧的${profileMeta[bulkSupersedeConfirmation].label}。` : ''} consequence="系统会逐个处理；包含已定稿或已提交审核记录的批次会保留并报告原因。" confirmLabel="全部标记为已替代" danger pending={Boolean(bulkSupersedeConfirmation && pendingAction === `supersede-${bulkSupersedeConfirmation}`)} onClose={() => { if (!pending) setBulkSupersedeConfirmation(null); }} onConfirm={() => { if (bulkSupersedeConfirmation) void supersedeRuns(oldActiveRuns.filter((group) => group.profile === bulkSupersedeConfirmation)); }} />

    <Dialog open={signoffOpen} title="签署 36 条试验人工复盘" description="自动指标通过后，团队仍需逐条确认没有系统性主题漂移或伪学生表达。" onClose={() => { if (!pending) setSignoffOpen(false); }} maxWidth="max-w-2xl" footer={<><button type="button" disabled={pending} onClick={() => setSignoffOpen(false)} className="border px-4 py-2 text-sm">取消</button><button type="button" disabled={pending || !signoff.drift.trim() || !signoff.studentVoice.trim() || !signoff.signer.trim() || !signoff.confirmed} onClick={signoffTrial} className="bg-green-800 px-4 py-2 text-sm text-white disabled:opacity-40">{pendingAction === 'trial-signoff' ? '签署中…' : '确认签署'}</button></>}>
      <div className="space-y-4"><label className="block text-sm font-medium">主题漂移复盘结论<textarea value={signoff.drift} onChange={(event) => setSignoff({ ...signoff, drift: event.target.value })} className="mt-1 min-h-24 w-full border p-3 font-normal" /></label><label className="block text-sm font-medium">伪学生表达复盘结论<textarea value={signoff.studentVoice} onChange={(event) => setSignoff({ ...signoff, studentVoice: event.target.value })} className="mt-1 min-h-24 w-full border p-3 font-normal" /></label><label className="block text-sm font-medium">签署人<input value={signoff.signer} onChange={(event) => setSignoff({ ...signoff, signer: event.target.value })} className="mt-1 w-full border px-3 py-2 font-normal" /></label><label className="flex items-start gap-2 border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={signoff.confirmed} onChange={(event) => setSignoff({ ...signoff, confirmed: event.target.checked })} className="mt-1" /><span>我确认团队已逐条完成复盘，上述结论将作为正式扩产的审计依据。</span></label></div>
    </Dialog>

    <Dialog open={overrideRunId !== null} title="忽略阻断并解锁" description="确认这些泄漏不影响案例质量后，阻断案例将解锁为待生成状态。" onClose={() => { if (!pending) { setOverrideRunId(null); setOverrideReason(''); } }} footer={<><button type="button" disabled={pending} onClick={() => { setOverrideRunId(null); setOverrideReason(''); }} className="border px-4 py-2 text-sm">取消</button><button type="button" disabled={pending || !overrideReason.trim()} onClick={overrideBlocked} className="bg-amber-700 px-4 py-2 text-sm text-white disabled:opacity-40">{pendingAction?.startsWith('override-') ? '处理中…' : '确认解锁'}</button></>}><label className="block text-sm font-medium">忽略理由<textarea autoFocus value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="例如：泄漏内容在系统提示词中，学生不可见，不影响案例质量" className="mt-2 min-h-20 w-full border p-3 font-normal" /></label></Dialog>

    <ConfirmDialog open={deleteRunId !== null} title="永久删除此批次" description={deleteRunId ? `将删除 run ${deleteRunId.slice(0, 8)} 及其所有案例记录。` : ''} consequence="此操作不可撤销。只有没有候选、审核记录或定稿的批次可以删除。" confirmLabel="确认删除" danger pending={Boolean(deleteRunId && pendingAction === `delete-${deleteRunId}`)} onClose={() => { if (!pending) setDeleteRunId(null); }} onConfirm={() => { if (deleteRunId) void deleteRun(deleteRunId); }} />
  </div>;
}
