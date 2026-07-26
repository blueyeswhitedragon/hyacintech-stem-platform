'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Dialog, { ConfirmDialog } from './Dialog';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select, Textarea } from '@/app/components/ui/Field';

interface PolicyItem {
  id: string;
  version: string;
  displayName: string;
  status: string;
  revision: number;
  builtIn: boolean;
  defaultForDataLab: boolean;
  rendererVersion: string;
  visibleStateVersion: string;
  focusPlannerVersion: string;
  semanticValidatorVersion: string;
  fallbackVersion: string;
  tutorContractVersion: string;
  stageContractVersion: string;
  extractorVersion: string;
  extractorPromptVersion: string;
  sourceCommit: string;
  manifestSha256: string;
  manifestJson: string;
  compatibilityJson: string;
  createdAt: string;
  approvedAt: string | null;
  revisionOf: { id: string; version: string } | null;
  counts: { cases: number; trainingRuns: number; runtimeBundles: number; trainedModels: number };
}

const GROUPS = [
  ['DRAFT', '草稿'],
  ['CANDIDATE', '候选评测'],
  ['APPROVED', '已批准可用于新数据'],
  ['SUPERSEDED', '已被新版替代'],
  ['DISABLED', '已停用'],
] as const;

const FOCUS_BY_PHASE: Record<number, string> = {
  1: 'research_question',
  2: 'variable_design',
  3: 'safety_checkpoint',
  4: 'cite_evidence',
  5: 'report_gap',
  6: 'reflection_coaching',
};

export default function PromptPolicyManager({ policies }: { policies: PolicyItem[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<PolicyItem | null>(null);
  const [previewPhase, setPreviewPhase] = useState(2);
  const [visibleFacts, setVisibleFacts] = useState('{"学生已说明的方案事实":{"要改变的因素":"光照时长","因素水平":["2小时","6小时"],"要观察的结果":"幼苗高度"}}');
  const [preview, setPreview] = useState<null | {
    sanitizedVisibleFacts: unknown;
    selectedFocus: string;
    systemPrompt: string;
    promptSha256: string;
    semanticValidatorVersion: string;
    fallbackVersion: string;
    baselines: Array<{ version: string; promptSha256: string; changed: boolean; characterDelta: number }>;
  }>(null);
  const [revisionTarget, setRevisionTarget] = useState<PolicyItem | null>(null);
  const [disableTarget, setDisableTarget] = useState<PolicyItem | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ policy: PolicyItem; action: 'APPROVE' | 'SET_DEFAULT' } | null>(null);
  const grouped = useMemo(
    () => Object.fromEntries(GROUPS.map(([status]) => [status, policies.filter((policy) => policy.status === status)])),
    [policies],
  );

  async function call(url: string, init: RequestInit, success: string) {
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch(url, init);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '操作失败');
      setFeedback({ tone: 'success', text: success });
      router.refresh();
      return data;
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      setPending(false);
    }
  }

  async function registerCodePolicies() {
    await call('/api/data-lab/prompt-policies', { method: 'POST' }, '当前代码中的内置策略已核验；已有版本未被覆盖。');
  }

  async function action(policy: PolicyItem, value: 'SUBMIT' | 'APPROVE' | 'SET_DEFAULT' | 'DISABLE') {
    await call(`/api/data-lab/prompt-policies/${policy.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: value }),
    }, value === 'SUBMIT' ? '策略已进入候选评测。' : value === 'APPROVE' ? '策略已批准用于新数据批次。' : value === 'SET_DEFAULT' ? '该策略已成为 Data Lab 默认，仅影响未来批次。' : '策略已停用，历史引用保持不变。');
  }

  async function createRevision(formData: FormData) {
    if (!revisionTarget) return;
    await call(`/api/data-lab/prompt-policies/${revisionTarget.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CREATE_REVISION',
        version: String(formData.get('version') ?? ''),
        displayName: String(formData.get('displayName') ?? ''),
      }),
    }, '新版修订草稿已创建；原策略未被覆盖。');
    setRevisionTarget(null);
  }

  async function renderPreview() {
    if (!previewTarget) return;
    let facts: unknown;
    try { facts = JSON.parse(visibleFacts); } catch { setFeedback({ tone: 'error', text: '学生可见事实必须是合法 JSON。' }); return; }
    const data = await call(`/api/data-lab/prompt-policies/${previewTarget.id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase: previewPhase,
        triggerType: 'USER_MESSAGE',
        visibleFacts: facts,
        allowedFocusIds: [FOCUS_BY_PHASE[previewPhase]],
      }),
    }, '动态 Prompt 已按当前输入重放。');
    setPreview(data);
  }

  return <div className="space-y-6">
    <section className="flex flex-wrap items-start justify-between gap-4 border border-hairline bg-canvas p-5"><div><h2 className="font-semibold">可执行 Prompt 策略包</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted">策略包登记 renderer、学生可见状态投影、focus planner、语义校验、fallback 与合同。它不是可随意覆盖的一段文本；代码内容变化必须创建新版本。</p></div><button disabled={pending} onClick={registerCodePolicies} className={buttonClass('primary', 'md')}>登记当前代码策略</button></section>
    {feedback && <p aria-live="polite" className={`border border-hairline p-3 text-sm ${feedback.tone === 'success' ? 'border-success/40 bg-success/8 text-body-strong' : 'border-error/40 bg-error/8 text-body-strong'}`}>{feedback.text}</p>}

    {GROUPS.map(([status, label]) => <section key={status} className="space-y-3"><h2 className="font-semibold">{label}（{grouped[status]?.length ?? 0}）</h2>{(grouped[status] ?? []).map((policy) => <article key={policy.id} className="border border-hairline bg-canvas p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs text-muted">第 {policy.revision} 版 · {policy.builtIn ? '代码内置' : '登记草稿'} · 来源提交 {policy.sourceCommit.slice(0, 12) || '未记录'}</div><h3 className="mt-1 font-semibold">{policy.displayName}</h3><p className="mt-1 font-mono text-sm text-body">{policy.version}</p>{policy.revisionOf && <span className="mt-2 inline-block border border-hairline bg-surface-card px-2 py-1 text-xs text-body">修订自 {policy.revisionOf.version}</span>}</div><div className="flex items-center gap-2">{policy.defaultForDataLab && <span className="bg-info/10 px-2 py-1 text-xs text-body-strong">Data Lab 默认</span>}<span className="bg-surface-card px-2 py-1 text-xs">{label}</span></div></div>
      <div className="mt-4 grid gap-2 text-xs md:grid-cols-3"><div className="border border-hairline bg-surface-soft p-3"><b>执行结构</b><p className="mt-1 text-muted">{policy.rendererVersion}<br />{policy.visibleStateVersion}<br />{policy.focusPlannerVersion}</p></div><div className="border border-hairline bg-surface-soft p-3"><b>校验与降级</b><p className="mt-1 text-muted">{policy.semanticValidatorVersion}<br />{policy.fallbackVersion}</p></div><div className="border border-hairline bg-surface-soft p-3"><b>合同组合</b><p className="mt-1 text-muted">{policy.tutorContractVersion}<br />{policy.stageContractVersion}<br />{policy.extractorVersion}</p></div></div>
      <div className="mt-3 grid gap-2 text-center text-xs sm:grid-cols-4"><div className="border border-hairline p-2"><b>{policy.counts.cases}</b><br />案例</div><div className="border border-hairline p-2"><b>{policy.counts.trainingRuns}</b><br />训练任务</div><div className="border border-hairline p-2"><b>{policy.counts.trainedModels}</b><br />训练产物</div><div className="border border-hairline p-2"><b>{policy.counts.runtimeBundles}</b><br />运行组合</div></div>
      <details className="mt-3 border border-hairline p-3"><summary className="cursor-pointer text-sm font-medium">查看策略结构</summary><div className="mt-3 grid gap-3 text-xs md:grid-cols-2"><div><b>1. 基本身份</b><pre className="mt-1 whitespace-pre-wrap bg-surface-soft p-2">version: {policy.version}{'\n'}manifest: {policy.manifestSha256}</pre></div><div><b>2. 组件与合同</b><pre className="mt-1 whitespace-pre-wrap bg-surface-soft p-2">{JSON.stringify(JSON.parse(policy.manifestJson), null, 2)}</pre></div><div><b>3. 兼容边界</b><pre className="mt-1 whitespace-pre-wrap bg-surface-soft p-2">{JSON.stringify(JSON.parse(policy.compatibilityJson), null, 2)}</pre></div><div><b>4. 动态预览</b><p className="mt-1 bg-surface-soft p-2 leading-5">动态预览用于核对清洗事实、服务器 focus、最终 system Prompt、校验器与版本差异。</p></div></div></details>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => { setPreviewTarget(policy); setPreview(null); }} className={buttonClass('secondary', 'sm')}>预览动态注入与基线差异</button>
        <Link href={`/data-lab/case-generation?prompt=${encodeURIComponent(policy.version)}`} className={buttonClass('secondary', 'sm')}>生成验证案例</Link>
        {status === 'DRAFT' && <button onClick={() => action(policy, 'SUBMIT')} className={buttonClass('secondary', 'sm')}>提交候选评测</button>}
        {['DRAFT', 'CANDIDATE'].includes(status) && <button onClick={() => setConfirmAction({ policy, action: 'APPROVE' })} className={buttonClass('primary', 'sm')}>批准用于新数据批次</button>}
        {status === 'APPROVED' && !policy.defaultForDataLab && <button onClick={() => setConfirmAction({ policy, action: 'SET_DEFAULT' })} className={buttonClass('primary', 'sm')}>设为 Data Lab 默认</button>}
        {['APPROVED', 'SUPERSEDED'].includes(status) && <button onClick={() => setRevisionTarget(policy)} className={buttonClass('secondary', 'sm')}>创建新版修订</button>}
        {!policy.defaultForDataLab && status !== 'DISABLED' && <button onClick={() => setDisableTarget(policy)} className={buttonClass('danger', 'sm')}>停用策略</button>}
      </div>
    </article>)}{(grouped[status]?.length ?? 0) === 0 && <p className="border border-hairline bg-canvas p-4 text-sm text-muted">当前没有{label}策略。</p>}</section>)}

    <Dialog open={Boolean(previewTarget)} title={`动态注入预览 · ${previewTarget?.version ?? ''}`} description="输入仅用于本次只读重放，不会创建案例或修改策略。" onClose={() => !pending && setPreviewTarget(null)} maxWidth="max-w-5xl">
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]"><div className="space-y-3"><label className="block text-sm">阶段<Select value={previewPhase} onChange={(event) => { setPreviewPhase(Number(event.target.value)); setPreview(null); }} className="mt-1">{[1, 2, 3, 4, 5, 6].map((phase) => <option key={phase} value={phase}>P{phase}</option>)}</Select></label><label className="block text-sm">学生可见事实 JSON<Textarea value={visibleFacts} onChange={(event) => { setVisibleFacts(event.target.value); setPreview(null); }} className="mt-1 min-h-64 font-mono" /></label><button disabled={pending} onClick={renderPreview} className={buttonClass('secondary', 'md')}>渲染完整 Prompt</button></div><div className="min-w-0 space-y-3">{preview ? <><div className="grid gap-2 text-xs sm:grid-cols-3"><div className="border border-hairline p-2"><b>服务器 focus</b><p>{preview.selectedFocus}</p></div><div className="border border-hairline p-2"><b>校验器</b><p>{preview.semanticValidatorVersion}</p></div><div className="border border-hairline p-2"><b>fallback</b><p>{preview.fallbackVersion}</p></div></div><details open className="border border-hairline p-3"><summary className="cursor-pointer text-sm font-medium">清洗后的学生可见事实</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap bg-surface-soft p-2 text-xs">{JSON.stringify(preview.sanitizedVisibleFacts, null, 2)}</pre></details><details open className="border border-hairline p-3"><summary className="cursor-pointer text-sm font-medium">最终 system Prompt · {preview.promptSha256.slice(0, 16)}…</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap bg-surface-dark p-3 text-xs text-on-dark">{preview.systemPrompt}</pre></details><div className="border border-hairline p-3"><b className="text-sm">与基线比较</b><div className="mt-2 space-y-2">{preview.baselines.map((item) => <div key={item.version} className="flex flex-wrap justify-between gap-2 bg-surface-soft p-2 text-xs"><span>{item.version}</span><span>{item.changed ? `有差异 · 字符变化 ${item.characterDelta >= 0 ? '+' : ''}${item.characterDelta}` : '完全一致'} · {item.promptSha256.slice(0, 12)}…</span></div>)}</div></div></> : <p className="border border-hairline bg-surface-soft p-6 text-sm text-muted">预览结果将依次呈现清洗事实、focus、最终 Prompt、哈希和 V1/V2.3 差异。</p>}</div></div>
    </Dialog>
    <Dialog open={Boolean(revisionTarget)} title="创建新版修订" description="复制组件清单形成新草稿；原版本、案例、Release 和运行组合不会改变。" onClose={() => !pending && setRevisionTarget(null)}>
      <p className="border border-hairline bg-surface-card p-3 text-xs leading-5 text-body"><b>这里不是在线 Prompt 文本编辑器。</b>新版本需要先在代码中实现 renderer 并部署；此操作只用于登记、比对和审批已实现的版本。未进入代码注册表的版本无法预览或批准为可执行策略。</p>
      <form action={createRevision} className="mt-3 space-y-3"><label className="block text-sm">新策略版本<Input name="version" required placeholder="tutor-language-prompt-v2.4" className="mt-1" /></label><label className="block text-sm">显示名称<Input name="displayName" placeholder="Tutor Prompt V2.4" className="mt-1" /></label><button disabled={pending} className={buttonClass('secondary', 'md')}>创建新版修订</button></form>
    </Dialog>
    <ConfirmDialog open={Boolean(confirmAction)} title={confirmAction?.action === 'SET_DEFAULT' ? '设为 Data Lab 默认策略' : '批准 Prompt 策略'} description={`目标版本：${confirmAction?.policy.version ?? ''}。`} consequence={confirmAction?.action === 'SET_DEFAULT' ? '今后新建的 Data Lab 批次会默认使用该策略；已冻结案例、Release 和运行组合不会被改写。' : '批准后该策略可被新数据批次和新运行组合引用；已有历史不会被替换。'} confirmLabel={confirmAction?.action === 'SET_DEFAULT' ? '确认设为默认' : '确认批准'} pending={pending} onClose={() => setConfirmAction(null)} onConfirm={async () => { if (confirmAction) await action(confirmAction.policy, confirmAction.action); setConfirmAction(null); }} />
    <ConfirmDialog open={Boolean(disableTarget)} title="停用 Prompt 策略" description={`将禁止新任务引用“${disableTarget?.version ?? ''}”。`} consequence="已有案例、Release、训练血缘和运行组合历史不会被改写；仍被可用或已部署组合引用时会阻断。" confirmLabel="确认停用" danger pending={pending} onClose={() => setDisableTarget(null)} onConfirm={async () => { if (disableTarget) await action(disableTarget, 'DISABLE'); setDisableTarget(null); }} />
  </div>;
}
