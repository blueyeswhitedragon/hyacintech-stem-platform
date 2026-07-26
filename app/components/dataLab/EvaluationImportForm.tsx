'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select } from '@/app/components/ui/Field';

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
      const diagnostics = Array.isArray(data.run?.importDiagnostics) ? data.run.importDiagnostics as Array<{ message?: string; remediation?: string }> : [];
      setFeedback({
        tone: diagnostics.length ? 'error' : 'success',
        text: diagnostics.length
          ? `评测产物已导入，但产物结构不完整：${diagnostics.map((item) => `${item.message ?? '字段不完整'} ${item.remediation ?? ''}`).join('；')}`
          : '评测产物已导入，模型、Prompt、Endpoint 身份和 scenarioId 已完成核验。',
      });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  }

  return <section className="rounded-lg border border-hairline bg-canvas p-4">
    <h2 className="font-semibold">创建与导入离线评测</h2>
    <p className="mt-1 text-xs text-muted">先冻结基线与候选运行组合，再由外部评测流程生成两份六阶段对话记录和一份裁决结果。导入时身份不一致会直接阻断。</p>
    {planned.length > 0 && <label className="mt-3 block text-sm">继续待导入任务
      <Select value={evaluationRunId} onChange={(event) => selectPlan(event.target.value)} className="mt-1">
        <option value="">新建评测</option>
        {planned.map((run) => <option key={run.id} value={run.id}>{run.name} · {run.modelATag} vs {run.modelBTag}</option>)}
      </Select>
    </label>}
    <div className="mt-3 grid gap-3 md:grid-cols-3">
      <label className="text-sm">评测名称<Input value={name} onChange={(event) => setName(event.target.value)} required placeholder="qwen-v2.3-six-phase" className="mt-1" /></label>
      <label className="text-sm">基线运行组合 A<Select value={runtimeBundleAId} onChange={(event) => { setRuntimeBundleAId(event.target.value); setEvaluationRunId(''); }} className="mt-1"><option value="">请选择</option>{bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.label}</option>)}</Select></label>
      <label className="text-sm">候选运行组合 B<Select value={runtimeBundleBId} onChange={(event) => { setRuntimeBundleBId(event.target.value); setEvaluationRunId(''); }} className="mt-1"><option value="">请选择</option>{bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.label}</option>)}</Select></label>
    </div>
    <div className="mt-3 rounded-md border border-info/40 bg-info/8 p-3 text-sm text-body-strong">
      <b>{change.label}</b>
      <div className="mt-1 text-xs">{change.details.length ? change.details.join('；') : '选择后会列出本次评测中的模型、Prompt 和 Endpoint 差异。'}</div>
    </div>
    <button type="button" disabled={pending || Boolean(evaluationRunId) || !name.trim() || !a || !b || a.id === b.id} onClick={createPlan} className={buttonClass('secondary', 'md', 'mt-3')}>创建离线评测</button>

    <form action={submit} className="mt-4 border-t border-t-hairline pt-4">
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="evaluationRunId" value={evaluationRunId} />
      <input type="hidden" name="runtimeBundleAId" value={runtimeBundleAId} />
      <input type="hidden" name="runtimeBundleBId" value={runtimeBundleBId} />
      <label className="text-sm">评测产物 JSON 文件<input name="artifacts" type="file" accept="application/json,.json" multiple required className="mt-2 block w-full text-sm" /><span className="mt-1 block text-xs leading-5 text-muted">选择三个文件：基线 transcript 需含 schemaVersion、tag、scope、scenarios/turns；候选 transcript 字段相同；verdict 需含 schemaVersion、tags.A/B、scenarioVerdicts，以及 summary.phase、summary.trigger、summary.focus。逐阶段统计还必须含 A/B parse 成功/总数，否则部署资格无法计算。</span></label>
      <div className="mt-2 flex flex-wrap gap-3 text-xs"><a href="/samples/evaluation-baseline-transcript.json" download className="text-coral hover:underline">下载基线样例</a><a href="/samples/evaluation-candidate-transcript.json" download className="text-coral hover:underline">下载候选样例</a><a href="/samples/evaluation-verdict.json" download className="text-coral hover:underline">下载 verdict 样例</a></div>
      <button disabled={pending || !evaluationRunId} className={buttonClass('primary', 'md', 'mt-3')}>{pending ? '处理中…' : '导入评测产物'}</button>
    </form>
    {feedback && <div aria-live="polite" className={`mt-3 border border-hairline p-3 text-sm ${feedback.tone === 'success' ? 'border-success/40 bg-success/8 text-body-strong' : 'border-error/40 bg-error/8 text-body-strong'}`}>{feedback.text}</div>}
  </section>;
}
