'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Dialog, { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import {
  REVIEW_POLICY_LABELS,
  TOPIC_CONTEXT_MODULE_LABELS,
  TOPIC_DISCIPLINE_LABELS,
  TRAINING_ELIGIBILITY_LABELS,
  TRIGGER_TYPE_LABELS,
  TUTOR_FOCUS_LABELS,
  TUTOR_SPLIT_LABELS,
  dataLabStatusLabel,
  formatGateMetric,
  gateFailureLabel,
  hardCheckErrorLabel,
} from '@/app/lib/dataLab/labels';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select, Textarea } from '@/app/components/ui/Field';
import { planTopicCardGaps } from '@/app/lib/dataLab/topicGaps';

type Profile = 'SMOKE_6' | 'CALIBRATION_12' | 'TRIAL_36' | 'FULL_180' | 'EVAL_80';

interface CaseView {
  id: string;
  dataSource: string;
  phase: number;
  triggerType: string;
  studentMessage: string;
  split: string;
  status: string;
  contractVersion: string;
  promptVersion: string;
  sourceContractVersion: string | null;
  sourcePromptVersion: string | null;
  hardCheckJson: string;
  revisionOfId: string | null;
  topicCard: { displayTitle: string; subject: string; status: string } | null;
  generationRun: {
    id: string;
    status: string;
    reviewPolicy: string;
    parametersJson: string;
    createdAt: string | Date;
    completedAt: string | Date | null;
    failureReason: string;
    firstReviewMode: string;
    candidateARuntimeBundleId: string | null;
    candidateBRuntimeBundleId: string | null;
    promptPolicyVersionId: string | null;
  } | null;
  latestCandidates: Array<{
    id: string;
    slot: string;
    attempt: number;
    status: string;
    normalizedOutputReady: boolean;
    deterministicCheckJson: string;
    generationRun: { id: string; kind: string; status: string; failureReason: string; createdAt: string | Date } | null;
  }>;
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

interface CaseCoverageView {
  expectedCells: number;
  generatedCells: number;
  finalizedCells: number;
  gaps: number;
  cells: Array<{
    phase: number;
    triggerType: string;
    focus: string;
    generated: number;
    finalized: number;
  }>;
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
  firstReviewMode: string;
  candidateARuntimeBundleId: string | null;
  candidateBRuntimeBundleId: string | null;
  promptPolicyVersionId: string | null;
  cases: CaseView[];
}

interface RuntimeBundleOption {
  id: string;
  name: string;
  version: number;
  roleKey: string;
  modelTag: string;
  family: string;
  endpointName: string;
  promptVersion: string;
}

interface PromptPolicyOption {
  id: string;
  version: string;
  displayName: string;
  defaultForDataLab: boolean;
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
    rejected: items.filter((item) => item.status === 'CASE_REJECTED').length,
    // 已驳回且还没有补位案例指回它的，才需要补全。
    backfillable: items.filter((item) => item.status === 'CASE_REJECTED'
      && !items.some((other) => other.revisionOfId === item.id)).length,
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

function candidateErrorCode(raw: string) {
  try {
    const issues = (JSON.parse(raw) as { issues?: Array<{ code?: unknown; severity?: unknown }> }).issues;
    const hard = Array.isArray(issues) ? issues.find((issue) => issue.severity === 'error') : null;
    return typeof hard?.code === 'string' ? hard.code : '';
  } catch {
    return '';
  }
}

function latestAttempt(item: CaseView) {
  const runId = item.latestCandidates[0]?.generationRun?.id;
  const candidates = runId
    ? item.latestCandidates.filter((candidate) => candidate.generationRun?.id === runId)
    : [];
  const attempt = Math.max(0, ...candidates.map((candidate) => candidate.attempt));
  const ready = candidates.length === 2
    && candidates.every((candidate) => candidate.status === 'GENERATED' && candidate.normalizedOutputReady);
  return {
    candidates,
    attempt,
    ready,
    runStatus: candidates[0]?.generationRun?.status ?? '',
    historicalCount: Math.max(0, item._count.candidates - candidates.length),
  };
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
  caseCoverage,
  topicRequirements,
  runtimeBundles,
  runtimeDefaults,
  promptPolicies,
}: {
  cases: CaseView[];
  smoke: QualityView;
  calibration: QualityView;
  trial: QualityView & { signedOff: boolean };
  topicCoverage: TopicCoverageView;
  caseCoverage: CaseCoverageView;
  topicRequirements: Record<string, { total: number; description: string }>;
  runtimeBundles: RuntimeBundleOption[];
  runtimeDefaults: { candidateA: string | null; candidateB: string | null };
  promptPolicies: PromptPolicyOption[];
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [autofillProgress, setAutofillProgress] = useState<{ profile: Profile; current: number; total: number } | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{ runId: string; current: number; total: number } | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [candidateARuntimeBundleId, setCandidateARuntimeBundleId] = useState(
    runtimeBundles.some((bundle) => bundle.id === runtimeDefaults.candidateA)
      ? runtimeDefaults.candidateA ?? ''
      : runtimeBundles.find((bundle) => bundle.roleKey === 'DATA_LAB_CANDIDATE_A')?.id ?? '',
  );
  const [candidateBRuntimeBundleId, setCandidateBRuntimeBundleId] = useState(
    runtimeBundles.some((bundle) => bundle.id === runtimeDefaults.candidateB)
      ? runtimeDefaults.candidateB ?? ''
      : runtimeBundles.find((bundle) => bundle.roleKey === 'DATA_LAB_CANDIDATE_B')?.id ?? '',
  );
  const [promptPolicyVersionId, setPromptPolicyVersionId] = useState(promptPolicies.find((policy) => policy.defaultForDataLab)?.id ?? promptPolicies[0]?.id ?? '');
  const [firstReviewMode, setFirstReviewMode] = useState<'HUMAN' | 'PLATFORM_AI'>('PLATFORM_AI');
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

  // 批量生成是浏览器串行长任务，关掉标签页会丢掉剩余进度。
  // 已完成的案例都已逐条落库，所以这里只需拦住误关，不需要恢复机制。
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);

  const candidateA = runtimeBundles.find((bundle) => bundle.id === candidateARuntimeBundleId);
  const candidateB = runtimeBundles.find((bundle) => bundle.id === candidateBRuntimeBundleId);
  const targetPrompt = promptPolicies.find((policy) => policy.id === promptPolicyVersionId);
  const runtimeSelectionReady = Boolean(candidateA && candidateB && targetPrompt
    && candidateA.family && candidateB.family
    && candidateA.family !== candidateB.family
    && candidateA.promptVersion === targetPrompt.version
    && candidateB.promptVersion === targetPrompt.version);
  const topicGapPlans = Object.fromEntries(profileOrder.map((profile) => [
    profile,
    planTopicCardGaps(
      profile === 'FULL_180' ? topicCoverage.fullFailures : [],
      topicCoverage.coverage,
      topicRequirements[profile] ?? { total: 1 },
    ),
  ])) as Record<Profile, ReturnType<typeof planTopicCardGaps>>;

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
        firstReviewMode: item.generationRun?.firstReviewMode ?? 'HUMAN',
        candidateARuntimeBundleId: item.generationRun?.candidateARuntimeBundleId ?? null,
        candidateBRuntimeBundleId: item.generationRun?.candidateBRuntimeBundleId ?? null,
        promptPolicyVersionId: item.generationRun?.promptPolicyVersionId ?? null,
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

  const productionRuns = useMemo(() => groupedRuns.filter((group) =>
    group.profile === 'CUSTOM' && group.cases.some((item) => item.dataSource === 'PRODUCTION_TRACE')
  ), [groupedRuns]);

  const historyRuns = useMemo(() => {
    const latestIds = new Set([...latestByProfile.values()].map((group) => group.id));
    const productionIds = new Set(productionRuns.map((group) => group.id));
    return groupedRuns.filter((group) => !latestIds.has(group.id) && !productionIds.has(group.id));
  }, [groupedRuns, latestByProfile, productionRuns]);

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
          reviewPolicy: firstReviewMode === 'PLATFORM_AI' ? 'AI_DIRECT_TO_REVIEWER' : 'HUMAN_ANNOTATOR_REQUIRED',
          firstReviewMode,
          candidateARuntimeBundleId,
          candidateBRuntimeBundleId,
          promptPolicyVersionId,
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
      const nextStep = firstReviewMode === 'PLATFORM_AI'
        ? '本批次使用 AI 初审草稿；生成双候选后运行已授权 AI 初审，再由你到定稿工作台完成最终判断。'
        : '本批次使用独立标注员初审；生成双候选后请让另一个账号完成初审，再由 reviewer/admin 定稿。';
      setFeedback({ tone: 'success', text: `已编译 ${data.cases.length} 条案例（run: ${String(data.runId).slice(0, 8)}）${blocked ? `，其中 ${blocked} 条被硬检查阻断` : ''}${warningText}。${nextStep}` });
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

  async function generateAll(runId: string, explicitTargets?: CaseView[]) {
    const group = groupedRuns.find((item) => item.id === runId);
    const targets = explicitTargets ?? group?.cases.filter((item) => ['READY', 'NEEDS_REGEN'].includes(item.status)) ?? [];
    if (!targets.length) return;
    // 只有批次自己冻结了运行组合时才交给服务端沿用；否则必须把当前选择发上去。
    // 编译早于运行组合注册表的历史批次没有冻结记录，不带选择就会被服务端判为
    //「案例未冻结运行组合，modelA 和 modelB 必填」而整批立刻失败。
    const runtimeFrozen = Boolean(group?.candidateARuntimeBundleId && group?.candidateBRuntimeBundleId);
    setGenerationConfirmation(null);
    start(`generate-${runId}`);
    setGenerationProgress({ runId, current: 0, total: targets.length });
    let completed = 0;
    let criticPending = 0;
    // 单条失败不能中断整批：180 条 × 约 4 次调用，若在第 5 条抛出，
    // 剩下 175 条已付出的等待全部作废。逐条记录失败，跑完再汇总重试。
    const failures: string[] = [];
    try {
      for (const item of targets) {
        const label = `阶段 ${item.phase}“${item.topicCard?.displayTitle ?? '生产回流案例'}”`;
        try {
          const body = runtimeFrozen ? {} : {
            modelA: { runtimeBundleId: candidateARuntimeBundleId },
            modelB: { runtimeBundleId: candidateBRuntimeBundleId },
          };
          const response = await fetch(`/api/data-lab/tutor-cases/${item.id}/candidates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? '候选生成失败');
          // PARTIAL_FAILED 有两种落点，重试入口不同：候选本身没生成出来的案例回到
          // NEEDS_REGEN（本按钮可重试），只是交叉检查挂了的案例变成 NEEDS_CRITIC，
          // 本按钮的 targets 过滤不包含它，必须走「补齐交叉检查」。分开计数才不会误导。
          if (data.status === 'PARTIAL_FAILED') {
            if (data.canRetryCritics) criticPending += 1;
            else {
              const details = Array.isArray(data.failedStages)
                ? data.failedStages.map((failure: { stage?: unknown; error?: unknown }) => `${String(failure.stage ?? '候选')}：${String(failure.error ?? '生成未完成')}`).join('；')
                : '';
              throw new Error(details || '候选生成未完成');
            }
          } else {
            completed += 1;
          }
        } catch (error) {
          failures.push(`${label}：${error instanceof Error ? error.message : String(error)}`);
        }
        const settled = completed + criticPending + failures.length;
        setGenerationProgress({ runId, current: settled, total: targets.length });
        setFeedback({ tone: 'info', text: `双候选生成进度 ${settled}/${targets.length}${failures.length ? `（${failures.length} 条失败，稍后可重试）` : ''}` });
      }
      const criticNote = criticPending ? `${criticPending} 条候选已生成但交叉检查未完成，请用下方「补齐交叉检查」重试（再点生成不会处理它们）。` : '';
      setFeedback(failures.length ? {
        tone: completed ? 'info' : 'error',
        text: `${completed}/${targets.length} 条已生成双候选并进入初审队列；${failures.length} 条失败：${failures.slice(0, 3).join('；')}${failures.length > 3 ? ` 等 ${failures.length} 条` : ''}。失败案例仍为待生成状态，可再次点击生成只重试它们。${criticNote}`,
      } : {
        tone: criticPending ? 'info' : 'success',
        text: `${completed} 条案例已生成双候选并进入初审队列。${criticNote}`,
      });
    } finally {
      setGenerationProgress(null);
      setPendingAction(null);
      router.refresh();
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
    // 与生成同理：AI 初审也是逐条长调用，单条失败不应作废整批。
    const failures: string[] = [];
    try {
      for (const item of items) {
        const label = `阶段 ${item.phase}“${item.topicCard?.displayTitle ?? '生产回流案例'}”`;
        try {
          const response = await fetch(`/api/data-lab/tutor-cases/${item.id}/ai-draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? 'AI 初审失败');
          completed += 1;
        } catch (error) {
          failures.push(`${label}：${error instanceof Error ? error.message : String(error)}`);
        }
        setFeedback({ tone: 'info', text: `AI 初审进度 ${completed + failures.length}/${items.length}${failures.length ? `（${failures.length} 条失败）` : ''}` });
      }
      setFeedback(failures.length ? {
        tone: completed ? 'info' : 'error',
        text: `${completed}/${items.length} 条 AI 初审建议稿已送入正式定稿队列；${failures.length} 条失败：${failures.slice(0, 3).join('；')}${failures.length > 3 ? ` 等 ${failures.length} 条` : ''}。失败案例仍在初审队列，可再次点击重试。`,
      } : { tone: 'success', text: `${completed} 条 AI 初审建议稿已送入正式定稿队列。` });
    } finally {
      setPendingAction(null);
      router.refresh();
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
      const requests = topicGapPlans[profile].requests;
      if (!requests.length) {
        setFeedback({ tone: 'info', text: '没有可自动补全的数量缺口，请按门禁提示手动检查话题覆盖。' });
        return;
      }
      let completed = 0;
      let failed = 0;
      setAutofillProgress({ profile, current: 0, total: requests.length });
      // 与批量生成同理：逐张调用 LLM，网络抛错时也只能算这一张失败。
      // 原先整个循环共用外层 catch，一次 fetch reject 就会丢掉剩余缺口。
      for (let index = 0; index < requests.length; index += 1) {
        const request = requests[index];
        try {
          const response = await fetch('/api/data-lab/topic-cards/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: 1, ...request }),
          });
          const data = await response.json();
          if (response.ok) completed += data.completed ?? 0;
          else failed += 1;
        } catch {
          failed += 1;
        }
        // 进度在这一张真正结束后才推进，否则起手就显示 1/5。
        setAutofillProgress({ profile, current: index + 1, total: requests.length });
      }
      setFeedback({ tone: completed ? 'success' : 'error', text: `已生成 ${completed} 张话题卡草稿${failed ? `，${failed} 张失败（可再次点击只补剩余缺口）` : ''}。请到话题库审批后再编译案例。` });
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
      text: `${completed} 个旧批次已标记为已替代${failures.length ? `；${failures.join('；')}` : ''}。${failures.length > 0 && completed === 0 ? '这些批次含定稿记录，保留即可；要换配比请直接重新编译新批次。' : ''}`,
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

  async function backfillRejected(runId: string) {
    start(`backfill-${runId}`);
    try {
      const response = await fetch(`/api/data-lab/bootstrap-runs/${runId}/backfill`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '补全失败');
      setFeedback({ tone: 'success', text: `已补 ${data.created} 条待生成案例${data.blocked ? `（其中 ${data.blocked} 条被硬检查阻断）` : ''}；请点击「生成双候选回复」后重新走初审与定稿。` });
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
    <details className="border border-info/40 bg-info/8 p-4">
      <summary className="cursor-pointer font-medium text-[#2f7f70]">如何从话题卡创建案例批次？</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#2f7f70]">
        <li>话题库中已批准的话题卡是案例来源。</li>
        <li>编译案例时，系统把话题卡与固定场景模板组合成学生消息和导师任务；这一步不调用 LLM。</li>
        <li>每类批次有独立的话题卡数量要求。编译后再调用模型生成双候选，随后进入初审和定稿。</li>
      </ol>
      <p className="mt-3 text-sm text-[#2f7f70]">当前已批准话题卡：<b>{topicCoverage.coverage.total}</b> 张。<Link href="/data-lab/topic-cards" className="ml-2 font-medium text-coral hover:underline">前往话题库</Link></p>
    </details>

    {feedback && <p aria-live="polite" className={`border border-hairline p-3 text-sm ${feedback.tone === 'success' ? 'border-success/40 bg-success/8 text-body-strong' : feedback.tone === 'error' ? 'border-error/40 bg-error/8 text-body-strong' : 'border-info/40 bg-info/8 text-body-strong'}`}>{feedback.text}</p>}

    <details className={`border border-hairline p-4 ${topicCoverage.fullFailures.length ? 'border-warning/40 bg-warning/8' : 'border-success/40 bg-success/8'}`}>
      <summary className="cursor-pointer font-semibold">正式集话题覆盖</summary>
      <p className="mt-2 text-sm text-muted">已批准 {topicCoverage.coverage.total} 张，其中新版 {topicCoverage.coverage.v2Count} 张；工程或混合型 {topicCoverage.coverage.engineeringOrHybrid} 张。</p>
      <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
        <div><b>情境模块</b>{Object.entries(topicCoverage.coverage.contextModules).map(([key, value]) => <div key={key} className="mt-1">{TOPIC_CONTEXT_MODULE_LABELS[key] ?? '其他情境'}：{value} 张（工程或混合 {topicCoverage.coverage.engineeringByModule[key] ?? 0} 张）</div>)}</div>
        <div><b>旧版学科分类（兼容统计）</b>{Object.entries(topicCoverage.coverage.subjects).map(([key, value]) => <div key={key} className="mt-1">{TOPIC_DISCIPLINE_LABELS[key] ?? '其他学科'}：{value} 张</div>)}</div>
      </div>
      {topicCoverage.fullFailures.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[#8a6a0f]">{topicCoverage.fullFailures.map((failure, index) => <li key={`${failure}-${index}`}>{gateFailureLabel(failure)}</li>)}</ul>}
    </details>

    <details className={`border border-hairline p-4 ${caseCoverage.gaps ? 'border-error/40 bg-error/8' : 'border-success/40 bg-success/8'}`}>
      <summary className="cursor-pointer font-semibold">结构决策覆盖</summary>
      <p className="mt-2 text-sm text-muted">
        应覆盖 <b>{caseCoverage.expectedCells}</b> 格 · 已生成 <b>{caseCoverage.generatedCells}</b> 格 · 已定稿 <b>{caseCoverage.finalizedCells}</b> 格 · 缺口 <b className={caseCoverage.gaps ? 'text-error' : 'text-body-strong'}>{caseCoverage.gaps}</b> 格
      </p>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        {[1, 2, 3, 4, 5, 6].map((phase) => {
          const cells = caseCoverage.cells.filter((cell) => cell.phase === phase);
          return <section key={phase} className="border border-hairline bg-canvas p-3">
            <h3 className="text-sm font-semibold">阶段 {phase}</h3>
            <div className="mt-2 space-y-2">{cells.map((cell) => {
              const missing = cell.generated === 0;
              const finalized = cell.finalized > 0;
              return <div key={`${cell.triggerType}:${cell.focus}`} className={`border p-2 text-xs ${missing ? 'border-error/40 bg-error/8 text-error' : finalized ? 'border-success/40 bg-success/8 text-body-strong' : 'border-info/40 bg-info/8 text-body-strong'}`}>
                <div className="font-medium">{TRIGGER_TYPE_LABELS[cell.triggerType] ?? cell.triggerType} · {TUTOR_FOCUS_LABELS[cell.focus] ?? cell.focus}</div>
                <div className="mt-1">{missing ? '缺口：尚未生成' : `已生成 ${cell.generated} 条 · 已定稿 ${cell.finalized} 条`}</div>
              </div>;
            })}</div>
          </section>;
        })}
      </div>
    </details>

    <section className="border-y bg-canvas py-5">
      <div className="px-4 sm:px-5">
        <h2 className="font-semibold">批次设置</h2>
        <p className="mt-1 text-xs text-muted">编译时冻结候选 A/B 运行组合、训练目标 Prompt 和初审方式。之后修改系统默认不会影响已创建案例。</p>
        <fieldset className="mt-4"><legend className="text-sm font-semibold">团队规模与初审路径</legend><div className="mt-2 grid gap-2 md:grid-cols-2">
          <label className={`border border-hairline p-3 text-sm ${firstReviewMode === 'PLATFORM_AI' ? 'border-coral/55 bg-coral/8' : 'bg-canvas'}`}><span className="flex items-center gap-2 font-medium"><input type="radio" name="team-size" checked={firstReviewMode === 'PLATFORM_AI'} onChange={() => setFirstReviewMode('PLATFORM_AI')} />我是单人/双人小组</span><span className="mt-2 block text-xs leading-5 text-muted">AI 完成初审草稿，你只做最终定稿。这是小团队唯一可行的方式。</span></label>
          <label className={`border border-hairline p-3 text-sm ${firstReviewMode === 'HUMAN' ? 'border-coral/55 bg-coral/8' : 'bg-canvas'}`}><span className="flex items-center gap-2 font-medium"><input type="radio" name="team-size" checked={firstReviewMode === 'HUMAN'} onChange={() => setFirstReviewMode('HUMAN')} />有独立标注员</span><span className="mt-2 block text-xs leading-5 text-muted">需要 annotator 与 reviewer 两个不同账号；同一个人不能既初审又定稿，否则该条数据失去训练资格。</span></label>
        </div></fieldset>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="block text-sm font-medium">候选 A 运行组合<Select value={candidateARuntimeBundleId} onChange={(event) => setCandidateARuntimeBundleId(event.target.value)} className="mt-1"><option value="">请选择已通过兼容性评测的组合</option>{runtimeBundles.filter((bundle) => bundle.roleKey === 'DATA_LAB_CANDIDATE_A').map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name} v{bundle.version} · {bundle.modelTag}</option>)}</Select>{candidateA && <span className="mt-1 block text-xs font-normal text-muted">{candidateA.family} · {candidateA.endpointName} · {candidateA.promptVersion}</span>}</label>
          <label className="block text-sm font-medium">候选 B 运行组合<Select value={candidateBRuntimeBundleId} onChange={(event) => setCandidateBRuntimeBundleId(event.target.value)} className="mt-1"><option value="">请选择已通过兼容性评测的组合</option>{runtimeBundles.filter((bundle) => bundle.roleKey === 'DATA_LAB_CANDIDATE_B').map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name} v{bundle.version} · {bundle.modelTag}</option>)}</Select>{candidateB && <span className="mt-1 block text-xs font-normal text-muted">{candidateB.family} · {candidateB.endpointName} · {candidateB.promptVersion}</span>}</label>
          <label className="block text-sm font-medium lg:col-span-2">训练目标 Prompt 策略<Select value={promptPolicyVersionId} onChange={(event) => setPromptPolicyVersionId(event.target.value)} className="mt-1"><option value="">请选择已批准策略</option>{promptPolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.displayName} · {policy.version}{policy.defaultForDataLab ? ' · 默认' : ''}</option>)}</Select><span className="mt-1 block text-xs font-normal text-muted">来源 Prompt 另存血缘；这里决定新案例和训练监督目标。</span></label>
        </div>
        {!runtimeSelectionReady && <div className="mt-4 border border-warning/40 bg-warning/8 p-3 text-sm text-body-strong"><b>为什么不能编译：</b>{!candidateA || !candidateB ? '请选择候选 A/B 运行组合。' : candidateA.family === candidateB.family ? '两个候选属于同一模型家族，不能形成独立对照。' : !targetPrompt ? '请选择训练目标 Prompt。' : '候选运行组合的 Prompt 与训练目标不一致。'}<p className="mt-1 text-xs">修复路径：在“运行组合”准备两个来自不同模型家族、使用同一目标 Prompt 且已通过兼容性评测的候选组合。</p></div>}
        {runtimeSelectionReady && <div className="mt-4 grid gap-2 text-xs sm:grid-cols-4"><div className="border border-hairline bg-success/8 p-2">模型家族独立：是</div><div className="border border-hairline bg-success/8 p-2">Endpoint 可用：是</div><div className="border border-hairline bg-success/8 p-2">Prompt/合同一致：是</div><div className="border border-hairline bg-success/8 p-2">当前批次资格：具备</div></div>}
      </div>
    </section>

    <section>
      <div><h2 className="font-semibold">批次进度</h2><p className="mt-1 text-sm text-muted">每类批次只按最新有效 run 计算进度和门禁；旧 run 收入下方历史记录。</p></div>
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
        const statusTone = !step.unlocked ? 'bg-surface-card text-muted' : step.quality?.pass ? 'bg-success/10 text-body-strong' : group ? 'bg-info/10 text-body-strong' : 'bg-canvas text-body';
        const generateProgress = generationProgress?.runId === group?.id ? generationProgress : null;
        const groupRuntimeFrozen = Boolean(group?.candidateARuntimeBundleId && group?.candidateBRuntimeBundleId);
        const topicGapPlan = topicGapPlans[step.profile];
        const requiresV2Revision = topicGapPlan.manualActions.some((action) => action.startsWith('FULL_REQUIRES_ALL_V2_TOPIC_CARDS'));
        const requiresDuplicateReview = topicGapPlan.manualActions.some((action) => action.startsWith('FULL_DUPLICATE_PROJECT_FAMILY'));
        return <article key={step.profile} className={`border border-hairline bg-canvas ${!step.unlocked ? 'border-hairline bg-surface-soft' : step.quality?.pass ? 'border-success/40' : group ? 'border-info/40' : 'border-hairline'}`}>
          <header className="border-b border-b-hairline p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{meta.label} · {meta.target} 条</h3><span className={`px-2 py-1 text-xs font-medium ${statusTone}`}>{statusLabel}</span></div><p className="mt-1 text-xs leading-5 text-muted">{meta.purpose}</p></div>
              {activeOld.length > 0 && <button type="button" onClick={() => document.getElementById('case-run-history')?.scrollIntoView({ behavior: 'smooth' })} className="border border-hairline px-2 py-1 text-xs text-body">{activeOld.length} 个旧批次 · 保留不影响门禁</button>}
            </div>
            {group ? <><p className="mt-3 text-sm font-medium">{group.cases.length} 条案例：{counts.finalized} 已定稿 / {counts.ready} 待生成 / {counts.blocked} 阻断{counts.editing ? ` / ${counts.editing} 初审中` : ''}{counts.confirming ? ` / ${counts.confirming} 待定稿` : ''}{counts.rejected ? ` / ${counts.rejected} 已驳回` : ''}</p><p className="mt-1 text-xs text-muted">run: {group.id.slice(0, 8)} · 创建于 {formatDate(group.createdAt)}</p></> : <p className="mt-3 text-sm text-muted">尚未编译此类案例。</p>}
          </header>

          <div className="divide-y">
            <section className="p-4">
              <div className="flex items-start gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs text-on-dark">1</span><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">编译案例</h4><p className={`mt-1 text-xs ${topicReady ? 'text-[#2f7a43]' : 'text-error'}`}>{topicReady ? `话题卡充足（${topicCoverage.coverage.total}/${requirement.total} 张）` : `话题卡不足或覆盖未达标（${topicCoverage.coverage.total}/${requirement.total} 张）`} · {requirement.description}</p>{group && <p className="mt-2 text-sm">已编译 {group.cases.length} 条（{counts.ready} 待生成、{counts.blocked} 阻断）</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={pending || !step.unlocked || !topicReady || !runtimeSelectionReady} onClick={() => requestCompile(step.profile)} className="border border-ink bg-canvas px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-35">{pendingAction === `compile-${step.profile}` ? '编译中…' : `编译 ${meta.target} 条${meta.shortLabel}案例`}</button>{!topicReady && topicGapPlan.requests.length > 0 && <button type="button" disabled={pending} onClick={() => autofillTopicGaps(step.profile)} className={buttonClass('secondary', 'sm')}>{autofillProgress?.profile === step.profile ? `生成中 ${autofillProgress.current}/${autofillProgress.total}` : `一键补全 ${topicGapPlan.requests.length} 张`}</button>}</div>{!step.unlocked && <p className="mt-2 text-xs text-error">{step.reason}</p>}
                {group && counts.backfillable > 0 && <div className="mt-3 border border-warning/40 bg-warning/8 p-3 text-xs leading-5 text-body-strong">本批次有 {counts.backfillable} 条案例在审核中被驳回，定稿数因此达不到 {meta.target} 条。补全会在<b>同一批次</b>内为每条被驳回案例生成一条替换案例：阶段与考察点不变（结构覆盖不变），但换用另一张话题卡，内容不会与批次里已有的任何案例重复。被驳回的记录保持原样保留。<div className="mt-2"><button type="button" disabled={pending} onClick={() => backfillRejected(group.id)} className={buttonClass('secondary', 'sm')}>{pendingAction === `backfill-${group.id}` ? '补全中…' : `补全被驳回的 ${counts.backfillable} 条`}</button></div></div>}
                {step.profile === 'FULL_180' && topicCoverage.fullFailures.length > 0 && <div className="mt-3 border border-warning/40 bg-warning/8 p-3 text-xs leading-5 text-body-strong"><ul className="list-disc space-y-1 pl-4 text-error">{topicCoverage.fullFailures.map((failure) => <li key={failure}>{gateFailureLabel(failure)}</li>)}</ul>{requiresV2Revision && <p className="mt-2">历史话题结构不能通过新生成关闭；请到<Link href="/data-lab/topic-cards" className="mx-1 font-medium text-coral hover:underline">话题库</Link>依次完成「创建新版修订 → AI 自动填充 → 补全并批准」。批准修订会自动替代旧版。</p>}{requiresDuplicateReview && <p className="mt-2">重复项目族需要在<Link href="/data-lab/topic-cards" className="mx-1 font-medium text-coral hover:underline">话题库</Link>人工保留一张有效版本，不会自动生成新卡。</p>}</div>}
                {blockedCases.length > 0 && <details className="mt-3 border-l-2 border-l-warning pl-3"><summary className="cursor-pointer text-sm font-medium text-[#8a6a0f]">查看 {blockedCases.length} 条阻断案例</summary><div className="mt-3 space-y-3">{blockedCases.map((item) => <div key={item.id} className="text-xs leading-5"><div className="font-medium text-ink">{item.topicCard?.displayTitle ?? '未命名话题'}（{item.id.slice(0, 8)}）</div>{hardCheckErrors(item).map((error) => <div key={error} className="mt-1 text-error">{hardCheckErrorLabel(error)}</div>)}</div>)}<div className="bg-warning/8 p-3 text-xs leading-5 text-body-strong">实际上这些 &quot;泄漏&quot; 出现在给 AI 导师的系统提示词中，学生看不到。如果确认不影响案例质量，可以忽略阻断直接解锁。<div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => { if (group) setOverrideRunId(group.id); }} className={buttonClass('secondary', 'sm')}>忽略阻断并解锁为待生成</button><Link href="/data-lab/topic-cards" className={buttonClass('secondary', 'sm')}>或前往话题库修改</Link></div></div></div></details>}
              </div></div>
            </section>

            <section className="p-4">
              <div className="flex items-start gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs text-on-dark">2</span><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">生成双候选</h4>{group ? <><p className="mt-1 text-sm">{counts.ready} 条待生成；每条调用模型 A/B 各生成一个回复并交叉检查。</p>{!groupRuntimeFrozen && counts.ready > 0 && <p className="mt-1 text-xs text-muted">本批次编译时没有冻结运行组合，将使用上方当前选择的候选 A/B。</p>}{counts.ready > 0 ? <button type="button" disabled={pending || (!groupRuntimeFrozen && !runtimeSelectionReady)} onClick={() => setGenerationConfirmation(group.id)} className="mt-3 border border-info/50 px-3 py-2 text-sm text-[#2f7f70] disabled:opacity-40">{pendingAction === `generate-${group.id}` ? `生成中 ${generateProgress?.current ?? 0}/${generateProgress?.total ?? counts.ready}` : `生成双候选回复（调用 LLM）· ${counts.ready} 条`}</button> : <p className="mt-3 text-xs text-[#2f7a43]">{counts.editing + counts.confirming + counts.finalized > 0 ? '双候选已生成，当前批次已进入初审或定稿。' : counts.blocked > 0 ? '当前案例均被硬检查阻断，请先处理阻断案例。' : '当前批次没有待生成案例。'}</p>}{generateProgress && <div className="mt-3"><div className="h-2 overflow-hidden rounded-full bg-surface-cream-strong"><div className="h-full bg-coral transition-all" style={{ width: `${generateProgress.total ? (generateProgress.current / generateProgress.total) * 100 : 0}%` }} /></div><p className="mt-1 text-xs text-muted">{generateProgress.current}/{generateProgress.total} 已完成</p></div>}{criticCases.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs text-[#8a6a0f]">{criticCases.length} 条等待补齐交叉检查</summary><div className="mt-2 space-y-2">{criticCases.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-t-hairline pt-2 text-xs"><span>阶段 {item.phase} · {item.topicCard?.displayTitle ?? item.id.slice(0, 8)}</span><button type="button" disabled={pending} onClick={() => retryCritics(item.id)} className={buttonClass('primary', 'sm')}>补齐交叉检查</button></div>)}</div></details>}</> : <p className="mt-1 text-sm text-muted">先完成步骤 1。</p>}</div></div>
            </section>

            <section className="p-4">
              <div className="flex items-start gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs text-on-dark">3</span><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">双审定稿</h4><p className="mt-1 text-sm">{counts.editing} 条初审中 / {counts.confirming} 条待定稿 / {counts.finalized} 条已定稿</p><div className="mt-3 flex flex-wrap gap-3 text-sm"><Link href="/data-lab/first-review" className="font-medium text-coral hover:underline">前往初审工作台</Link><Link href="/data-lab/final-confirmation" className="font-medium text-coral hover:underline">前往定稿工作台</Link>{group?.reviewPolicy === 'AI_DIRECT_TO_REVIEWER' && counts.editing > 0 && <button type="button" disabled={pending} onClick={() => curateAll(group)} className={buttonClass('secondary', 'sm')}>{pendingAction === `curate-${group.id}` ? 'AI 初审中…' : '运行已授权 AI 初审'}</button>}</div></div></div>
            </section>
          </div>

          {step.quality && <details className="border-t border-t-hairline p-4"><summary className="cursor-pointer text-sm font-medium">门禁检查{step.quality.pass ? ' · 已通过' : ''}</summary><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">{Object.entries(step.quality.metrics).map(([key, value]) => <span key={key}>{formatGateMetric(key, value)}</span>)}</div>{step.quality.failures.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-error">{step.quality.failures.map((failure) => <li key={failure}>{gateFailureLabel(failure)}</li>)}</ul>}{step.profile === 'TRIAL_36' && trial.runId && <a href={`/api/data-lab/bootstrap-runs/trial-export?runId=${trial.runId}`} className={buttonClass('secondary', 'sm', 'mt-3 mr-2 inline-flex')}>导出逐条复盘表（ShareGPT）</a>}{step.profile === 'TRIAL_36' && trial.pass && !trial.signedOff && <button type="button" onClick={() => setSignoffOpen(true)} className={buttonClass('primary', 'sm', 'mt-3')}>填写人工复盘并签署</button>}{step.profile === 'TRIAL_36' && trial.signedOff && <p className="mt-3 text-xs text-[#2f7a43]">人工逐条复盘已签署。</p>}</details>}
        </article>;
      })}</div>
    </section>

    <section id="production-reflow" className="scroll-mt-4 border-y bg-canvas py-5">
      <div className="px-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold">生产回流案例</h2><p className="mt-1 text-sm text-muted">来自已授权的真实师生会话，不受四级扩产门禁约束，可直接生成双候选进入初审。</p></div>
          {productionRuns.some((group) => countStatuses(group.cases).ready > 0) && <button type="button" disabled={pending || !runtimeSelectionReady} onClick={() => setGenerationConfirmation('production-all')} className={buttonClass('secondary', 'sm')}>为全部 {productionRuns.reduce((sum, group) => sum + countStatuses(group.cases).ready, 0)} 条生成双候选</button>}
        </div>
        {!runtimeSelectionReady && productionRuns.length > 0 && <div className="mt-3 border border-warning/40 bg-warning/8 p-3 text-sm text-body-strong"><b>暂不能生成：</b>{!candidateA || !candidateB ? '请先在上方选择候选 A/B 运行组合。' : candidateA.family === candidateB.family ? '候选 A/B 必须来自不同模型家族。' : !targetPrompt ? '请选择训练目标 Prompt。' : '候选运行组合的 Prompt 必须与训练目标一致。'}</div>}
        <div className="mt-4 divide-y border-y">
          {productionRuns.flatMap((group) => group.cases.map((item) => {
            const latest = latestAttempt(item);
            return <div key={item.id} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1"><div className="text-xs text-muted">阶段 {item.phase} · 来源 Prompt {item.sourcePromptVersion ?? '未知'} / 合同 {item.sourceContractVersion ?? '未知'}</div><p className="mt-1 line-clamp-2 text-sm leading-6">{item.studentMessage || '平台状态触发，本回合没有学生发言。'}</p>{latest.candidates.length > 0 && <div className={`mt-2 text-xs leading-5 ${latest.ready ? 'text-[#2f7a43]' : 'text-error'}`}>{latest.ready
                ? `最新尝试 #${latest.attempt}：A/B 均已通过结构校验并完成交叉检查`
                : `最新尝试 #${latest.attempt}：${latest.candidates.map((candidate) => `${candidate.slot} ${candidateErrorCode(candidate.deterministicCheckJson) || candidate.status}`).join('；')}（run ${latest.runStatus || '状态未知'}）`}{latest.historicalCount > 0 ? ` · 保留 ${latest.historicalCount} 条历史候选` : ''}</div>}</div>
              <div className="flex items-center gap-2"><span className="bg-surface-card px-2 py-1 text-xs">{dataLabStatusLabel(item.status)}</span>{['READY', 'NEEDS_REGEN'].includes(item.status) && <button type="button" disabled={pending || !runtimeSelectionReady} onClick={() => setGenerationConfirmation(group.id)} className={buttonClass('secondary', 'sm')}>生成双候选</button>}</div>
            </div>
          </div>;}))}
          {productionRuns.length === 0 && <p className="py-6 text-sm text-muted">暂无生产回流案例。教师提名并由管理员在<Link href="/data-lab/candidates" className="mx-1 text-coral hover:underline">线上候选审核</Link>通过后，会出现在这里。</p>}
        </div>
      </div>
    </section>

    <section id="case-run-history" className="scroll-mt-4 space-y-3">
      <div><h2 className="font-semibold">历史批次记录</h2><p className="mt-1 text-xs text-muted">这里展示旧 run、自定义来源和已替代批次；它们不参与最新批次的进度统计。含已定稿或已提交审核记录的批次保留是正常的，不影响门禁。</p></div>
      {profileOrder.map((profile) => {
        const runs = oldActiveRuns.filter((group) => group.profile === profile);
        const ready = runs.reduce((sum, group) => sum + countStatuses(group.cases).ready, 0);
        if (!runs.length || !ready || dismissedOldRunWarnings.includes(profile)) return null;
        const latest = latestByProfile.get(profile);
        return <div key={profile} className="border border-warning/40 bg-warning/8 p-4 text-sm text-body-strong"><p>检测到 {runs.length} 个旧的{profileMeta[profile].label}还有 {ready} 条待生成案例。门禁只看最新批次{latest ? `（${latest.id.slice(0, 8)}）` : ''}，旧案例不影响解锁。含已定稿或已提交审核记录的批次无法整体替代时，保留即可。</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => setBulkSupersedeConfirmation(profile)} className={buttonClass('secondary', 'sm')}>全部标记为已替代</button><button type="button" onClick={() => setDismissedOldRunWarnings([...dismissedOldRunWarnings, profile])} className="px-3 py-2 text-xs text-muted">保留</button></div></div>;
      })}
      {historyRuns.map((group) => {
        const counts = countStatuses(group.cases);
        const label = group.profile === 'CUSTOM' ? '自定义或生产回流批次' : `${profileMeta[group.profile].label} · ${profileMeta[group.profile].target} 条`;
        return <article key={group.id} className="border border-hairline bg-canvas p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{label}</h3><span className="bg-surface-card px-2 py-1 text-xs">{dataLabStatusLabel(group.status)}</span></div><p className="mt-1 text-xs text-muted">run: {group.id.slice(0, 8)} · {formatDate(group.createdAt)} · {REVIEW_POLICY_LABELS[group.reviewPolicy] ?? '初审方式待确认'}</p></div><div className="flex flex-wrap gap-3 text-xs"><span>待生成 <b>{counts.ready}</b></span><span>初审中 <b>{counts.editing}</b></span><span>待定稿 <b>{counts.confirming}</b></span><span>已定稿 <b>{counts.finalized}</b></span>{group.status !== 'SUPERSEDED' && group.profile !== 'CUSTOM' && <button type="button" disabled={pending} onClick={() => setSupersedeConfirmation(group.id)} className={buttonClass('danger', 'sm')}>标记为已替代</button>}{isProfile(group.profile) && (counts.ready + counts.blocked === group.cases.length || group.status === 'SUPERSEDED') && <button type="button" disabled={pending} onClick={() => setDeleteRunId(group.id)} className={buttonClass('danger', 'sm')}>删除</button>}</div></div><details className="mt-3"><summary className="cursor-pointer text-sm text-[#2f7f70]">查看 {group.cases.length} 条案例</summary><div className="mt-3 space-y-2">{group.cases.map((item) => <div key={item.id} className="border-t border-t-hairline pt-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs text-muted">阶段 {item.phase} · {TUTOR_SPLIT_LABELS[item.split] ?? '用途待确认'} · {TRIGGER_TYPE_LABELS[item.triggerType] ?? '触发方式待确认'} · {TOPIC_DISCIPLINE_LABELS[item.topicCard?.subject ?? ''] ?? '生产回流'}</div><h4 className="mt-1 font-medium">{item.topicCard?.displayTitle ?? '生产授权会话回流'}</h4></div><span className="bg-surface-card px-2 py-1 text-xs">{dataLabStatusLabel(item.status)}</span></div><p className="mt-2 bg-surface-soft p-2 text-xs leading-5">{item.studentMessage || '平台状态触发，本回合没有学生发言。'}</p>{item.sourcePromptVersion && <p className="mt-2 border border-info/40 bg-info/8 p-2 text-xs text-body-strong">来源 Prompt {item.sourcePromptVersion} / 合同 {item.sourceContractVersion ?? '未知'} → 训练目标 Prompt {item.promptVersion} / 合同 {item.contractVersion}</p>}<div className="mt-2 flex flex-wrap gap-3 text-xs text-muted"><span>候选 {item._count.candidates}</span><span>审核任务 {item._count.reviewTasks}</span>{item.finalizedTurn && <span>{TRAINING_ELIGIBILITY_LABELS[item.finalizedTurn.trainingEligibility] ?? '训练资格待确认'}</span>}</div></div>)}</div></details></article>;
      })}
      {historyRuns.length === 0 && <p className="border border-hairline bg-canvas p-6 text-sm text-muted">暂无历史批次。</p>}
    </section>

    <ConfirmDialog open={compileConfirmation !== null} title="确认创建新批次" description={compileConfirmation ? `检测到已有${profileMeta[compileConfirmation].label}（${formatDate(latestByProfile.get(compileConfirmation)?.createdAt ?? null)}）。` : ''} consequence="创建新批次会保留旧批次，但进度与门禁只看最新有效批次。" confirmLabel="确认编译新批次" pending={Boolean(compileConfirmation && pendingAction === `compile-${compileConfirmation}`)} onClose={() => { if (!pending) setCompileConfirmation(null); }} onConfirm={() => { if (compileConfirmation) void compile(compileConfirmation, true); }} />
    <ConfirmDialog open={selectedGenerationRun !== null || generationConfirmation === 'production-all'} title="确认生成双候选" description={generationConfirmation === 'production-all' ? `将为 ${productionRuns.reduce((sum, group) => sum + countStatuses(group.cases).ready, 0)} 条生产回流案例生成两个独立候选并执行交叉检查。` : selectedGenerationRun ? `将为 run ${selectedGenerationRun.id.slice(0, 8)} 的 ${countStatuses(selectedGenerationRun.cases).ready} 条待处理案例生成两个独立候选并执行交叉检查。` : ''} consequence={generationConfirmation === 'production-all' ? `预计产生约 ${productionRuns.reduce((sum, group) => sum + countStatuses(group.cases).ready, 0) * 4} 次模型调用，已完成的案例会逐条保存。` : selectedGenerationRun ? `预计产生约 ${countStatuses(selectedGenerationRun.cases).ready * 4} 次模型调用，已完成的案例会逐条保存。` : ''} confirmLabel="开始生成双候选" pending={Boolean(generationConfirmation && pendingAction === `generate-${generationConfirmation}`)} onClose={() => { if (!pending) setGenerationConfirmation(null); }} onConfirm={() => { if (generationConfirmation === 'production-all') void generateAll('production-all', productionRuns.flatMap((group) => group.cases).filter((item) => ['READY', 'NEEDS_REGEN'].includes(item.status))); else if (selectedGenerationRun) void generateAll(selectedGenerationRun.id); }} />
    <ConfirmDialog open={selectedSupersedeRun !== null} title="标记旧批次为已替代" description={selectedSupersedeRun ? `run ${selectedSupersedeRun.id.slice(0, 8)} 将退出待处理队列。` : ''} consequence="案例和未完成的审核任务会标记为 SUPERSEDED；候选与审计记录保留。包含已定稿或已提交审核记录的批次不会被处理。" confirmLabel="确认标记" danger pending={Boolean(selectedSupersedeRun && pendingAction === `supersede-${selectedSupersedeRun.id}`)} onClose={() => { if (!pending) setSupersedeConfirmation(null); }} onConfirm={() => { if (selectedSupersedeRun) void supersedeRuns([selectedSupersedeRun]); }} />
    <ConfirmDialog open={bulkSupersedeConfirmation !== null} title="清理同类旧批次" description={bulkSupersedeConfirmation ? `将处理 ${oldActiveRuns.filter((group) => group.profile === bulkSupersedeConfirmation).length} 个旧的${profileMeta[bulkSupersedeConfirmation].label}。` : ''} consequence="系统会逐个处理；包含已定稿或已提交审核记录的批次会保留并报告原因。" confirmLabel="全部标记为已替代" danger pending={Boolean(bulkSupersedeConfirmation && pendingAction === `supersede-${bulkSupersedeConfirmation}`)} onClose={() => { if (!pending) setBulkSupersedeConfirmation(null); }} onConfirm={() => { if (bulkSupersedeConfirmation) void supersedeRuns(oldActiveRuns.filter((group) => group.profile === bulkSupersedeConfirmation)); }} />

    <Dialog open={signoffOpen} title="签署 36 条试验人工复盘" description="请先下载逐条复盘表，实际读完六阶段案例后，再填写主题漂移与伪学生表达的复盘结论。" onClose={() => { if (!pending) setSignoffOpen(false); }} maxWidth="max-w-2xl" footer={<><button type="button" disabled={pending} onClick={() => setSignoffOpen(false)} className="border border-hairline px-4 py-2 text-sm">取消</button><button type="button" disabled={pending || !signoff.drift.trim() || !signoff.studentVoice.trim() || !signoff.signer.trim() || !signoff.confirmed} onClick={signoffTrial} className={buttonClass('primary', 'md')}>{pendingAction === 'trial-signoff' ? '签署中…' : '确认签署'}</button></>}>
      <div className="space-y-4">{trial.runId && <a href={`/api/data-lab/bootstrap-runs/trial-export?runId=${trial.runId}`} className={buttonClass('secondary', 'sm', 'inline-flex')}>导出逐条复盘表（ShareGPT）</a>}<label className="block text-sm font-medium">主题漂移复盘结论<Textarea value={signoff.drift} onChange={(event) => setSignoff({ ...signoff, drift: event.target.value })} className="mt-1 min-h-24" /></label><label className="block text-sm font-medium">伪学生表达复盘结论<Textarea value={signoff.studentVoice} onChange={(event) => setSignoff({ ...signoff, studentVoice: event.target.value })} className="mt-1 min-h-24" /></label><label className="block text-sm font-medium">签署人<Input value={signoff.signer} onChange={(event) => setSignoff({ ...signoff, signer: event.target.value })} className="mt-1" /></label><label className="flex items-start gap-2 border border-warning/40 bg-warning/8 p-3 text-sm"><input type="checkbox" checked={signoff.confirmed} onChange={(event) => setSignoff({ ...signoff, confirmed: event.target.checked })} className="mt-1" /><span>我确认团队已逐条完成复盘，上述结论将作为正式扩产的审计依据。</span></label></div>
    </Dialog>

    <Dialog open={overrideRunId !== null} title="忽略阻断并解锁" description="确认这些泄漏不影响案例质量后，阻断案例将解锁为待生成状态。" onClose={() => { if (!pending) { setOverrideRunId(null); setOverrideReason(''); } }} footer={<><button type="button" disabled={pending} onClick={() => { setOverrideRunId(null); setOverrideReason(''); }} className="border border-hairline px-4 py-2 text-sm">取消</button><button type="button" disabled={pending || !overrideReason.trim()} onClick={overrideBlocked} className={buttonClass('primary', 'md')}>{pendingAction?.startsWith('override-') ? '处理中…' : '确认解锁'}</button></>}><label className="block text-sm font-medium">忽略理由<Textarea autoFocus value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="例如：泄漏内容在系统提示词中，学生不可见，不影响案例质量" className="mt-2 min-h-20" /></label></Dialog>

    <ConfirmDialog open={deleteRunId !== null} title="永久删除此批次" description={deleteRunId ? `将删除 run ${deleteRunId.slice(0, 8)} 及其所有案例记录。` : ''} consequence="此操作不可撤销。只有没有候选、审核记录或定稿的批次可以删除。" confirmLabel="确认删除" danger pending={Boolean(deleteRunId && pendingAction === `delete-${deleteRunId}`)} onClose={() => { if (!pending) setDeleteRunId(null); }} onConfirm={() => { if (deleteRunId) void deleteRun(deleteRunId); }} />
  </div>;
}
