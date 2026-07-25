'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface BundleOption {
  id: string;
  label: string;
  status: string;
  modelTag: string;
  modelVersionId: string;
  promptVersion: string;
  promptPolicyVersionId: string;
  endpointName: string;
  endpointId: string;
}

interface PlannedEvaluation {
  id: string;
  name: string;
  runtimeBundleAId: string;
  runtimeBundleBId: string;
  modelATag: string;
  modelBTag: string;
}

function difference(a?: BundleOption, b?: BundleOption) {
  if (!a || !b) return { label: '请选择两个运行组合', details: [] as string[] };
  const details = [
    ...(a.modelVersionId !== b.modelVersionId ? [`模型：${a.modelTag} → ${b.modelTag}`] : []),
    ...(a.promptPolicyVersionId !== b.promptPolicyVersionId ? [`Prompt：${a.promptVersion} → ${b.promptVersion}`] : []),
    ...(a.endpointId !== b.endpointId ? [`Endpoint：${a.endpointName} → ${b.endpointName}`] : []),
  ];
  const label = a.modelVersionId !== b.modelVersionId && a.promptPolicyVersionId !== b.promptPolicyVersionId
    ? '模型和 Prompt 同时变化'
    : a.modelVersionId !== b.modelVersionId
      ? '只换模型'
      : a.promptPolicyVersionId !== b.promptPolicyVersionId
        ? '只换 Prompt'
        : a.endpointId !== b.endpointId
          ? 'Endpoint 迁移'
          : '没有运行差异';
  return { label, details };
}

export default function EvaluationImportForm({ bundles, planned }: {
  bundles: BundleOption[];
  planned: PlannedEvaluation[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [runtimeBundleAId, setRuntimeBundleAId] = useState('');
  const [runtimeBundleBId, setRuntimeBundleBId] = useState('');
  const [evaluationRunId, setEvaluationRunId] = useState('');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const a = bundles.find((item) => item.id === runtimeBundleAId);
  const b = bundles.find((item) => item.id === runtimeBundleBId);
  const change = useMemo(() => difference(a, b), [a, b]);

  function selectPlan(id: string) {
    setEvaluationRunId(id);
    const run = planned.find((item) => item.id === id);
    if (!run) return;
    setName(run.name);
    setRuntimeBundleAId(run.runtimeBundleAId);
    setRuntimeBundleBId(run.runtimeBundleBId);
  }

  async function createPlan() {
    setPending(true); setFeedback(null);
    try {
      const response = await fetch('/api/data-lab/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, runtimeBundleAId, runtimeBundleBId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '创建失败');
      setEvaluationRunId(data.run.id);
      setFeedback({ tone: 'success', text: `离线评测已创建。产物必须使用 A=${data.run.modelATag}、B=${data.run.modelBTag}。` });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  }

  async function submit(formData: FormData) {
    setPending(true); setFeedback(null);
    try {
      const response = await fetch('/api/data-lab/evaluations/import', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '导入失败');
      setFeedback({ tone: 'success', text: '评测产物已导入，模型、Prompt、Endpoint 身份和 scenarioId 已完成核验。' });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  }

  return <section className="rounded-xl border bg-white p-4">
    <h2 className="font-semibold">创建与导入离线评测</h2>
    <p className="mt-1 text-xs text-gray-500">先冻结基线与候选运行组合，再由外部评测流程生成两份六阶段对话记录和一份裁决结果。导入时身份不一致会直接阻断。</p>
    {planned.length > 0 && <label className="mt-3 block text-sm">继续待导入任务
      <select value={evaluationRunId} onChange={(event) => selectPlan(event.target.value)} className="mt-1 w-full border bg-white px-3 py-2">
        <option value="">新建评测</option>
        {planned.map((run) => <option key={run.id} value={run.id}>{run.name} · {run.modelATag} vs {run.modelBTag}</option>)}
      </select>
    </label>}
    <div className="mt-3 grid gap-3 md:grid-cols-3">
      <label className="text-sm">评测名称<input value={name} onChange={(event) => setName(event.target.value)} required placeholder="qwen-v2.3-six-phase" className="mt-1 w-full border px-3 py-2" /></label>
      <label className="text-sm">基线运行组合 A<select value={runtimeBundleAId} onChange={(event) => { setRuntimeBundleAId(event.target.value); setEvaluationRunId(''); }} className="mt-1 w-full border bg-white px-3 py-2"><option value="">请选择</option>{bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.label}</option>)}</select></label>
      <label className="text-sm">候选运行组合 B<select value={runtimeBundleBId} onChange={(event) => { setRuntimeBundleBId(event.target.value); setEvaluationRunId(''); }} className="mt-1 w-full border bg-white px-3 py-2"><option value="">请选择</option>{bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.label}</option>)}</select></label>
    </div>
    <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
      <b>{change.label}</b>
      <div className="mt-1 text-xs">{change.details.length ? change.details.join('；') : '选择后会列出本次评测中的模型、Prompt 和 Endpoint 差异。'}</div>
    </div>
    <button type="button" disabled={pending || Boolean(evaluationRunId) || !name.trim() || !a || !b || a.id === b.id} onClick={createPlan} className="mt-3 bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40">创建离线评测</button>

    <form action={submit} className="mt-4 border-t pt-4">
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="evaluationRunId" value={evaluationRunId} />
      <input type="hidden" name="runtimeBundleAId" value={runtimeBundleAId} />
      <input type="hidden" name="runtimeBundleBId" value={runtimeBundleBId} />
      <label className="text-sm">评测产物 JSON 文件<input name="artifacts" type="file" accept="application/json,.json" multiple required className="mt-2 block w-full text-sm" /><span className="mt-1 block text-xs text-gray-500">选择基线对话、候选对话和裁决结果三个文件；产物 A/B 标签必须与已创建任务一致。</span></label>
      <button disabled={pending || !evaluationRunId} className="mt-3 bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">{pending ? '处理中…' : '导入评测产物'}</button>
    </form>
    {feedback && <div aria-live="polite" className={`mt-3 border p-3 text-sm ${feedback.tone === 'success' ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>{feedback.text}</div>}
  </section>;
}
