'use client';

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
  topicCard: { displayTitle: string; subject: string; status: string } | null;
  generationRun: { id: string; reviewPolicy: string; parametersJson: string; createdAt: string | Date } | null;
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

const profileMeta: Record<Profile, { label: string; purpose: string }> = {
  SMOKE_6: { label: '冒烟验证 · 6 条', purpose: '先确认提示词、结构和基本审核链路能走通。' },
  CALIBRATION_12: { label: '校准批次 · 12 条', purpose: '复测编辑量、直接确认率和自动信号误报。' },
  TRIAL_36: { label: '试验批次 · 36 条', purpose: '验证规模化前的质量与重复度门禁。' },
  FULL_180: { label: '正式训练集 · 180 条', purpose: '生成可进入正式双审与数据交付的训练案例。' },
  EVAL_80: { label: '独立评测集 · 80 条', purpose: '生成不进入训练的数据，用于外部模型评测。' },
};

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
    ready: items.filter((item) => ['READY', 'NEEDS_REGEN', 'NEEDS_CRITIC'].includes(item.status)).length,
    editing: items.filter((item) => item.status === 'IN_REVIEW').length,
    confirming: items.filter((item) => item.status === 'AWAITING_CONFIRMATION').length,
    finalized: items.filter((item) => item.status === 'FINALIZED' || Boolean(item.finalizedTurn)).length,
  };
}

export default function CaseGenerationManager({
  cases,
  smoke,
  calibration,
  trial,
  topicCoverage,
  defaultModels,
}: {
  cases: CaseView[];
  smoke: QualityView;
  calibration: QualityView;
  trial: QualityView & { signedOff: boolean };
  topicCoverage: TopicCoverageView;
  defaultModels: { A: { provider: string; model: string }; B: { provider: string; model: string } };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [modelA, setModelA] = useState(defaultModels.A);
  const [modelB, setModelB] = useState(defaultModels.B);
  const [reviewPolicy, setReviewPolicy] = useState<'HUMAN_ANNOTATOR_REQUIRED' | 'AI_DIRECT_TO_REVIEWER'>('HUMAN_ANNOTATOR_REQUIRED');
  const [confirmingGeneration, setConfirmingGeneration] = useState(false);
  const [signoffOpen, setSignoffOpen] = useState(false);
  const [signoff, setSignoff] = useState({ drift: '', studentVoice: '', signer: '', confirmed: false });

  const targets = cases.filter((item) => ['READY', 'NEEDS_REGEN'].includes(item.status));
  const groupedRuns = useMemo(() => {
    const groups = new Map<string, { id: string; profile: Profile | 'CUSTOM'; reviewPolicy: string; createdAt: string | Date | null; cases: CaseView[] }>();
    for (const item of cases) {
      const id = item.generationRun?.id ?? `source-${item.id}`;
      const group = groups.get(id) ?? { id, profile: item.generationRun ? runProfile(item.generationRun.parametersJson) : 'CUSTOM', reviewPolicy: item.generationRun?.reviewPolicy ?? 'HUMAN_ANNOTATOR_REQUIRED', createdAt: item.generationRun?.createdAt ?? null, cases: [] };
      group.cases.push(item);
      groups.set(id, group);
    }
    return [...groups.values()];
  }, [cases]);
  const profilesWithRuns = new Set(groupedRuns.map((group) => group.profile));
  const fullUnlocked = trial.pass && trial.signedOff && topicCoverage.fullFailures.length === 0;
  const evalUnlocked = trial.pass && trial.signedOff;

  function start() {
    setPending(true);
    setFeedback(null);
  }

  function fail(error: unknown) {
    setFeedback({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
  }

  async function compile(profile: Profile) {
    start();
    try {
      const response = await fetch('/api/data-lab/tutor-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile, split: ['SMOKE_6', 'CALIBRATION_12', 'TRIAL_36'].includes(profile) ? 'PILOT' : profile === 'EVAL_80' ? 'EVAL' : 'TRAIN', reviewPolicy }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '案例编译失败');
      const warningText = Array.isArray(data.coverageWarnings) && data.coverageWarnings.length ? `，另有 ${data.coverageWarnings.length} 项话题覆盖提醒` : '';
      setFeedback({ tone: 'success', text: `已创建 ${data.cases.length} 条案例${warningText}。下一步为待生成案例配置双模型候选。` });
      router.refresh();
    } catch (error) { fail(error); }
    finally { setPending(false); }
  }

  async function signoffTrial() {
    if (!signoff.drift.trim() || !signoff.studentVoice.trim() || !signoff.signer.trim() || !signoff.confirmed) return;
    start();
    try {
      const note = `主题漂移复盘：${signoff.drift.trim()}\n伪学生表达复盘：${signoff.studentVoice.trim()}\n签署人：${signoff.signer.trim()}\n签署确认：已逐条完成团队复盘`;
      const response = await fetch('/api/data-lab/bootstrap-runs/trial-quality', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '签署失败');
      setFeedback({ tone: 'success', text: '36 条试验已完成人工签署，正式 180 条训练集现已解锁。' });
      setSignoffOpen(false);
      router.refresh();
    } catch (error) { fail(error); }
    finally { setPending(false); }
  }

  async function generate(caseId: string) {
    start();
    try {
      const response = await fetch(`/api/data-lab/tutor-cases/${caseId}/candidates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelA, modelB }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '候选生成失败');
      if (data.status === 'PARTIAL_FAILED') throw new Error(`部分产物已保存，仍需补齐：${(data.failedStages ?? []).map((item: { stage: string }) => item.stage).join('、')}`);
      setFeedback({ tone: 'success', text: '双候选与交叉检查已保存，这条案例已进入初审队列。' });
      router.refresh();
    } catch (error) { fail(error); }
    finally { setPending(false); }
  }

  async function generateAll() {
    if (!targets.length) return;
    setConfirmingGeneration(false);
    start();
    let completed = 0;
    try {
      for (const item of targets) {
        const response = await fetch(`/api/data-lab/tutor-cases/${item.id}/candidates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelA, modelB }) });
        const data = await response.json();
        if (!response.ok) throw new Error(`阶段 ${item.phase}“${item.topicCard?.displayTitle ?? '生产回流案例'}”：${data.error ?? '候选生成失败'}`);
        completed += 1;
        setFeedback({ tone: 'info', text: `批量生成进度 ${completed}/${targets.length}` });
      }
      setFeedback({ tone: 'success', text: `${completed} 条案例已生成双候选并进入初审队列，等待标注员处理。` });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: 'error', text: `已完成 ${completed}/${targets.length} 条；${error instanceof Error ? error.message : String(error)}` });
    } finally { setPending(false); }
  }

  async function curateAll() {
    const items = cases.filter((item) => item.status === 'IN_REVIEW' && item.generationRun?.reviewPolicy === 'AI_DIRECT_TO_REVIEWER');
    if (!items.length) { setFeedback({ tone: 'info', text: '当前没有已授权 AI 初审且正在等待处理的案例。' }); return; }
    start();
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
    } catch (error) { fail(error); }
    finally { setPending(false); }
  }

  async function retryCritics(caseId: string) {
    start();
    try {
      const response = await fetch(`/api/data-lab/tutor-cases/${caseId}/retry-critics`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '交叉检查重试失败');
      setFeedback(data.status === 'COMPLETED' ? { tone: 'success', text: '失败的交叉检查已补齐，案例进入初审。' } : { tone: 'error', text: '仍有交叉检查失败，本次证据已保留，可稍后重试。' });
      router.refresh();
    } catch (error) { fail(error); }
    finally { setPending(false); }
  }

  const steps: Array<{ profile: Profile; quality?: QualityView & { signedOff?: boolean }; unlocked: boolean; reason: string }> = [
    { profile: 'SMOKE_6', quality: smoke, unlocked: true, reason: '' },
    { profile: 'CALIBRATION_12', quality: calibration, unlocked: smoke.pass, reason: '完成 6 条冒烟验证并通过门禁后解锁。' },
    { profile: 'TRIAL_36', quality: trial, unlocked: calibration.pass, reason: '完成 12 条校准并通过门禁后解锁。' },
    { profile: 'FULL_180', unlocked: fullUnlocked, reason: topicCoverage.fullFailures.length ? '话题库覆盖仍未达标，请先补齐话题类型与数量。' : !trial.pass ? '36 条试验自动门禁尚未通过。' : !trial.signedOff ? '36 条试验尚未完成人工复盘签署。' : '' },
    { profile: 'EVAL_80', unlocked: evalUnlocked, reason: !trial.pass ? '36 条试验自动门禁尚未通过。' : !trial.signedOff ? '36 条试验尚未完成人工复盘签署。' : '' },
  ];
  const currentProfile = steps.find((step) => step.unlocked && !(step.quality?.pass || profilesWithRuns.has(step.profile)))?.profile
    ?? steps.find((step) => step.unlocked && !step.quality?.pass)?.profile;

  return <div className="space-y-5">
    <section className={`border p-4 ${topicCoverage.fullFailures.length ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'}`}>
      <h2 className="font-semibold">正式集话题覆盖</h2>
      <p className="mt-1 text-sm text-gray-600">已批准 {topicCoverage.coverage.total} 张，其中新版 {topicCoverage.coverage.v2Count} 张；工程或混合型 {topicCoverage.coverage.engineeringOrHybrid} 张。</p>
      <div className="mt-3 grid gap-3 text-xs md:grid-cols-2"><div><b>情境模块</b>{Object.entries(topicCoverage.coverage.contextModules).map(([key, value]) => <div key={key} className="mt-1">{TOPIC_CONTEXT_MODULE_LABELS[key] ?? '其他情境'}：{value} 张（工程或混合 {topicCoverage.coverage.engineeringByModule[key] ?? 0} 张）</div>)}</div><div><b>旧版学科分类（兼容统计）</b>{Object.entries(topicCoverage.coverage.subjects).map(([key, value]) => <div key={key} className="mt-1">{TOPIC_DISCIPLINE_LABELS[key] ?? '其他学科'}：{value} 张</div>)}</div></div>
      {topicCoverage.fullFailures.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-950">{topicCoverage.fullFailures.map((failure, index) => <li key={`${failure}-${index}`}>{gateFailureLabel(failure)}</li>)}</ul>}
    </section>

    <section className="border bg-white p-5">
      <h2 className="font-semibold">批次扩产</h2><p className="mt-1 text-sm text-gray-500">每一级完成双审并通过质量门禁后，下一层才会解锁。</p>
      <label className="mt-4 block max-w-xl text-sm font-medium">初审方式<select value={reviewPolicy} onChange={(event) => setReviewPolicy(event.target.value as typeof reviewPolicy)} className="mt-1 block w-full border bg-white px-3 py-2 font-normal"><option value="HUMAN_ANNOTATOR_REQUIRED">{REVIEW_POLICY_LABELS.HUMAN_ANNOTATOR_REQUIRED}</option><option value="AI_DIRECT_TO_REVIEWER">{REVIEW_POLICY_LABELS.AI_DIRECT_TO_REVIEWER}</option></select><span className="mt-1 block text-xs font-normal text-gray-500">AI 初审必须由管理员逐批授权，仍需独立人工定稿，并会写入审计与导出来源。</span></label>
      <div className="mt-5 space-y-0 border-l-2 border-gray-200 pl-5">{steps.map((step, index) => {
        const meta = profileMeta[step.profile];
        const complete = Boolean(step.quality?.pass) || profilesWithRuns.has(step.profile);
        const current = step.profile === currentProfile;
        const blocked = Boolean(step.quality?.runId && !step.quality.pass);
        return <article key={step.profile} className={`relative mb-4 border p-4 ${!step.unlocked ? 'border-gray-200 bg-gray-50 text-gray-400' : blocked ? 'border-red-200 bg-red-50' : complete ? 'border-green-200 bg-green-50' : current ? 'border-blue-300 bg-blue-50' : 'bg-white'}`}>
          <span className={`absolute -left-[31px] top-5 flex size-5 items-center justify-center rounded-full text-[10px] text-white ${!step.unlocked ? 'bg-gray-300' : blocked ? 'bg-red-600' : complete ? 'bg-green-600' : 'bg-blue-600'}`}>{index + 1}</span>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{meta.label}</h3><p className="mt-1 text-xs leading-5">{meta.purpose}</p></div><span className="text-xs font-medium">{!step.unlocked ? '未解锁' : blocked ? '门禁未通过' : step.quality?.pass ? '门禁通过' : complete ? '已创建' : current ? '当前步骤' : '可创建'}</span></div>
          {step.quality && <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">{Object.entries(step.quality.metrics).map(([key, value]) => <span key={key}>{formatGateMetric(key, value)}</span>)}</div>}
          {step.quality?.failures.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-red-900">{step.quality.failures.map((failure) => <li key={failure}>{gateFailureLabel(failure)}</li>)}</ul> : null}
          <div className="mt-3"><button disabled={pending || !step.unlocked} onClick={() => compile(step.profile)} className="border border-gray-900 bg-white px-3 py-2 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-35">{profilesWithRuns.has(step.profile) ? '再建一个批次' : `创建${meta.label.split(' · ')[0]}`}</button>{step.reason && !step.unlocked && <p className="mt-2 text-xs text-red-700">{step.reason}</p>}</div>
          {step.profile === 'TRIAL_36' && trial.pass && !trial.signedOff && <button type="button" onClick={() => setSignoffOpen(true)} className="mt-3 bg-green-800 px-3 py-2 text-sm text-white">填写人工复盘并签署</button>}
          {step.profile === 'TRIAL_36' && trial.signedOff && <p className="mt-3 text-xs text-green-800">人工逐条复盘已签署。</p>}
        </article>;
      })}</div>
    </section>

    <section className="border bg-white p-5">
      <h2 className="font-semibold">双模型候选配置</h2><p className="mt-1 text-xs text-gray-500">两个候选必须来自不同模型家族。每条案例通常产生 2 次候选生成和 2 次交叉检查调用。</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">{[[modelA, setModelA, 'A'], [modelB, setModelB, 'B']].map(([model, setter, slot]) => { const item = model as typeof modelA; const set = setter as typeof setModelA; return <fieldset key={String(slot)} className="border p-3"><legend className="px-1 text-sm font-medium">候选 {String(slot)}</legend><label className="mt-2 block text-xs font-medium">模型服务商<input value={item.provider} onChange={(event) => set({ ...item, provider: event.target.value })} placeholder="例如：openai 或 deepseek" className="mt-1 w-full border px-2 py-1.5 font-normal" /></label><label className="mt-2 block text-xs font-medium">外部模型标识<input value={item.model} onChange={(event) => set({ ...item, model: event.target.value })} placeholder="例如：Qwen3.5-35B-A3B" className="mt-1 w-full border px-2 py-1.5 font-normal" /></label></fieldset>; })}</div>
      <div className="mt-4 flex flex-wrap gap-2"><button disabled={pending || !targets.length} onClick={() => setConfirmingGeneration(true)} className="border border-blue-700 px-3 py-2 text-sm text-blue-700 disabled:opacity-40">批量生成待处理案例（{targets.length}）</button><button disabled={pending} onClick={curateAll} className="border border-violet-700 px-3 py-2 text-sm text-violet-700 disabled:opacity-40">运行已授权 AI 初审</button></div>
      {feedback && <p aria-live="polite" className={`mt-3 border p-3 text-sm ${feedback.tone === 'success' ? 'border-green-200 bg-green-50 text-green-900' : feedback.tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>{feedback.text}</p>}
    </section>

    <section className="space-y-3"><div><h2 className="font-semibold">生成批次</h2><p className="mt-1 text-xs text-gray-500">按批次查看案例进入生成、初审、定稿各环节的数量。</p></div>{groupedRuns.map((group) => { const counts = countStatuses(group.cases); const label = group.profile === 'CUSTOM' ? '自定义或生产回流批次' : profileMeta[group.profile].label; return <article key={group.id} className="border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{label}</h3><p className="mt-1 text-xs text-gray-500">{group.createdAt ? new Date(group.createdAt).toLocaleString('zh-CN') : '历史来源'} · {REVIEW_POLICY_LABELS[group.reviewPolicy] ?? '初审方式待确认'}</p></div><div className="flex flex-wrap gap-3 text-xs"><span>待生成 <b>{counts.ready}</b></span><span>初审中 <b>{counts.editing}</b></span><span>待定稿 <b>{counts.confirming}</b></span><span>已定稿 <b>{counts.finalized}</b></span></div></div><details className="mt-3"><summary className="cursor-pointer text-sm text-blue-700">查看 {group.cases.length} 条案例</summary><div className="mt-3 space-y-2">{group.cases.map((item) => <div key={item.id} className="border-t pt-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs text-gray-500">阶段 {item.phase} · {TUTOR_SPLIT_LABELS[item.split] ?? '用途待确认'} · {TRIGGER_TYPE_LABELS[item.triggerType] ?? '触发方式待确认'} · {TOPIC_DISCIPLINE_LABELS[item.topicCard?.subject ?? ''] ?? '生产回流'}</div><h4 className="mt-1 font-medium">{item.topicCard?.displayTitle ?? '生产授权会话回流'}</h4></div><span className="bg-gray-100 px-2 py-1 text-xs">{dataLabStatusLabel(item.status)}</span></div><p className="mt-2 bg-gray-50 p-2 text-xs leading-5">{item.studentMessage || '平台状态触发，本回合没有学生发言。'}</p><div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500"><span>候选 {item._count.candidates}</span><span>审核任务 {item._count.reviewTasks}</span>{item.finalizedTurn && <span>{TRAINING_ELIGIBILITY_LABELS[item.finalizedTurn.trainingEligibility] ?? '训练资格待确认'}</span>}<span className="ml-auto">{item.status === 'NEEDS_CRITIC' ? <button disabled={pending} onClick={() => retryCritics(item.id)} className="bg-amber-700 px-3 py-1.5 text-white disabled:opacity-40">补齐交叉检查</button> : item.status === 'IN_REVIEW' && item.generationRun?.reviewPolicy === 'AI_DIRECT_TO_REVIEWER' ? <button disabled={pending} onClick={async () => { start(); try { const response = await fetch(`/api/data-lab/tutor-cases/${item.id}/ai-draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'AI 初审失败'); setFeedback({ tone: 'success', text: 'AI 建议稿已送入正式定稿队列。' }); router.refresh(); } catch (error) { fail(error); } finally { setPending(false); } }} className="bg-violet-700 px-3 py-1.5 text-white disabled:opacity-40">运行 AI 初审</button> : <button disabled={pending || !['READY', 'NEEDS_REGEN', 'IN_REVIEW'].includes(item.status)} onClick={() => generate(item.id)} className="bg-blue-700 px-3 py-1.5 text-white disabled:opacity-40">生成或重新生成双候选</button>}</span></div></div>)}</div></details></article>; })}{groupedRuns.length === 0 && <p className="border bg-white p-6 text-sm text-gray-500">暂无案例批次。请先批准话题卡，再从冒烟验证开始创建。</p>}</section>

    <ConfirmDialog open={confirmingGeneration} title="确认批量生成双候选" description={`将为 ${targets.length} 条待处理案例生成两个独立候选，并执行双向交叉检查。`} consequence={`预计产生约 ${targets.length * 4} 次模型调用。操作可能持续较长时间，已完成的案例会逐条保存。`} confirmLabel="开始批量生成" pending={pending} onClose={() => setConfirmingGeneration(false)} onConfirm={generateAll} />
    <Dialog open={signoffOpen} title="签署 36 条试验人工复盘" description="自动指标通过后，团队仍需逐条确认没有系统性主题漂移或伪学生表达。" onClose={() => { if (!pending) setSignoffOpen(false); }} maxWidth="max-w-2xl" footer={<><button type="button" disabled={pending} onClick={() => setSignoffOpen(false)} className="border px-4 py-2 text-sm">取消</button><button type="button" disabled={pending || !signoff.drift.trim() || !signoff.studentVoice.trim() || !signoff.signer.trim() || !signoff.confirmed} onClick={signoffTrial} className="bg-green-800 px-4 py-2 text-sm text-white disabled:opacity-40">确认签署</button></>}>
      <div className="space-y-4"><label className="block text-sm font-medium">主题漂移复盘结论<textarea value={signoff.drift} onChange={(event) => setSignoff({ ...signoff, drift: event.target.value })} placeholder="逐条抽查了哪些情境，是否出现偏离话题卡核心机制的案例" className="mt-1 min-h-24 w-full border p-3 font-normal" /></label><label className="block text-sm font-medium">伪学生表达复盘结论<textarea value={signoff.studentVoice} onChange={(event) => setSignoff({ ...signoff, studentVoice: event.target.value })} placeholder="是否存在像测试指令、评分标准或教师话术的学生表达" className="mt-1 min-h-24 w-full border p-3 font-normal" /></label><label className="block text-sm font-medium">签署人<input value={signoff.signer} onChange={(event) => setSignoff({ ...signoff, signer: event.target.value })} className="mt-1 w-full border px-3 py-2 font-normal" /></label><label className="flex items-start gap-2 border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={signoff.confirmed} onChange={(event) => setSignoff({ ...signoff, confirmed: event.target.checked })} className="mt-1" /><span>我确认团队已逐条完成复盘，上述结论将作为正式扩产的审计依据。</span></label></div>
    </Dialog>
  </div>;
}
