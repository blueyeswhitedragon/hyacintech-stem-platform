'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import { DEPLOYMENT_OBSERVATION_META } from '@/app/lib/dataLab/labels';

interface RuntimeBundleOption {
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

interface ActiveDeployment {
  id: string;
  runtimeBundleId: string | null;
  modelVersionId: string;
  rolloutPercent: number;
  previousRuntimeBundleId: string | null;
  previousModelVersionId: string | null;
  observationJson: string;
}

function parsePaused(value: string) {
  try { return (JSON.parse(value) as { promotionPaused?: boolean }).promotionPaused === true; } catch { return false; }
}

export default function DeploymentControls({ bundles, active }: {
  bundles: RuntimeBundleOption[];
  active: ActiveDeployment | null;
}) {
  const router = useRouter();
  const [bundleId, setBundleId] = useState(active?.runtimeBundleId ?? '');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmingDeploy, setConfirmingDeploy] = useState(false);
  const [confirmingRollback, setConfirmingRollback] = useState(false);
  const [observation, setObservation] = useState({ sessions: 0, criticalErrors: 0, structureFailureRate: 0, baselineStructureFailureRate: 0, teacherRejectRate: 0, baselineTeacherRejectRate: 0, earlyTerminationRate: 0, baselineEarlyTerminationRate: 0 });
  const selected = bundles.find((bundle) => bundle.id === bundleId);
  const current = bundles.find((bundle) => bundle.id === active?.runtimeBundleId);
  const legacyDeployment = Boolean(active && !active.runtimeBundleId);
  const rollbackTarget = legacyDeployment ? '上一模型版本' : '上一运行组合';
  const same = active?.runtimeBundleId === bundleId;
  const nextPercent = same ? active?.rolloutPercent === 10 ? 30 : active?.rolloutPercent === 30 ? 100 : null : 10;
  const paused = active ? parsePaused(active.observationJson) : false;
  const change = useMemo(() => {
    if (!selected) return '等待选择候选运行组合';
    if (!current) return '首次运行组合部署';
    const model = current.modelVersionId !== selected.modelVersionId;
    const prompt = current.promptPolicyVersionId !== selected.promptPolicyVersionId;
    if (model && prompt) return '模型和 Prompt 同时变化';
    if (model) return '只换模型';
    if (prompt) return '只换 Prompt';
    if (current.endpointId !== selected.endpointId) return 'Endpoint 迁移';
    return '同一运行组合继续晋级';
  }, [current, selected]);

  async function action(url: string, body?: unknown) {
    setPending(true); setMessage('');
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '操作失败');
      router.refresh();
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setPending(false);
    }
  }

  async function calculateGate() {
    if (!bundleId) return;
    try {
      const data = await action(`/api/data-lab/runtime-bundles/${bundleId}/action`, { action: 'DEPLOYMENT_GATE' });
      setMessage(data.result === 'PASS' ? '部署资格已通过。' : `部署资格未通过：${data.failures.join('、')}`);
    } catch {}
  }

  async function promote() {
    if (!nextPercent) return;
    try {
      await action('/api/data-lab/deployments', { runtimeBundleId: bundleId, rolloutPercent: nextPercent });
      setMessage(`已进入 ${nextPercent}% 灰度；仅新会话按该比例路由，已有会话保持固定。`);
    } catch {}
  }

  async function saveObservation() {
    if (!active) return;
    try {
      await action(`/api/data-lab/deployments/${active.id}/observation`, observation);
      setMessage('线上观察指标已保存。');
    } catch {}
  }

  async function togglePause() {
    if (!active) return;
    try {
      await action(`/api/data-lab/deployments/${active.id}/pause`, { paused: !paused });
      setMessage(paused ? '已恢复晋级。' : '已暂停晋级；当前流量比例保持不变。');
    } catch {}
  }

  async function rollback() {
    if (!active) return;
    try {
      await action(`/api/data-lab/deployments/${active.id}/rollback`);
      setMessage('已回滚新会话的默认运行组合；此前固定的会话未被切换。');
    } catch {}
  }

  return <section className="rounded-xl border bg-white p-4">
    <h2 className="font-semibold">灰度部署与回滚</h2>
    <p className="mt-1 text-xs text-gray-500">部署单位是模型 + Endpoint + Prompt + 合同 + 生成参数组成的运行组合。10% 和 30% 晋级还需要满足线上观察门槛。</p>
    <div className="mt-3 grid gap-3 md:grid-cols-[2fr_1fr]">
      <label className="text-sm">候选运行组合<select value={bundleId} onChange={(event) => setBundleId(event.target.value)} className="mt-1 w-full border bg-white px-3 py-2"><option value="">请选择</option>{bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.label}</option>)}</select></label>
      <div className="border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"><div className="text-xs">本次差异</div><b>{change}</b></div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={pending || !bundleId} onClick={calculateGate} className="border border-blue-700 px-3 py-2 text-sm text-blue-800 disabled:opacity-40">计算部署资格</button>
      <button type="button" disabled={pending || !bundleId || !nextPercent || paused} onClick={() => setConfirmingDeploy(true)} className="bg-green-700 px-3 py-2 text-sm text-white disabled:opacity-40">{nextPercent === 10 ? '开始 10% 灰度' : nextPercent ? `晋级到 ${nextPercent}%` : '已完成 100%'}</button>
      {active && [10, 30].includes(active.rolloutPercent) && <button type="button" disabled={pending} onClick={togglePause} className="border border-red-500 px-3 py-2 text-sm text-red-700 disabled:opacity-40">{paused ? '恢复晋级' : '暂停晋级'}</button>}
      <button type="button" disabled={pending || !active?.previousModelVersionId} onClick={() => setConfirmingRollback(true)} className="border border-red-500 px-3 py-2 text-sm text-red-700 disabled:opacity-40">回滚到{rollbackTarget}</button>
    </div>
    {active && [10, 30].includes(active.rolloutPercent) && <details className="mt-4 rounded border bg-gray-50 p-3">
      <summary className="cursor-pointer text-sm font-medium">记录 {active.rolloutPercent}% 线上观察指标</summary>
      <p className="mt-1 text-xs text-gray-500">10%：至少 48 小时 / 50 会话；30%：至少 72 小时 / 150 会话。严重错误会阻断晋级。</p>
      <div className="mt-3 grid gap-3 md:grid-cols-4">{Object.entries(observation).map(([key, value]) => { const meta = DEPLOYMENT_OBSERVATION_META[key] ?? { label: key, unit: '' }; return <label key={key} className="text-xs font-medium">{meta.label}<span className="ml-1 font-normal text-gray-500">（{meta.unit}）</span><input type="number" min="0" max={key === 'sessions' || key === 'criticalErrors' ? undefined : 1} step={key === 'sessions' || key === 'criticalErrors' ? 1 : 0.001} value={value} onChange={(event) => setObservation({ ...observation, [key]: Number(event.target.value) })} className="mt-1 w-full border px-2 py-1.5 font-normal" /></label>; })}</div>
      <button type="button" disabled={pending} onClick={saveObservation} className="mt-3 border px-3 py-1.5 text-xs">保存观察指标</button>
    </details>}
    {message && <p aria-live="polite" className={`mt-3 text-sm ${/失败|未通过|错误/.test(message) ? 'text-red-700' : 'text-green-700'}`}>{message}</p>}
    <ConfirmDialog open={confirmingDeploy} title={nextPercent === 10 ? '开始灰度部署' : '晋级灰度部署'} description={`当前组合：${current?.label ?? '旧版环境配置'}；候选组合：${selected?.label ?? '未选择'}；变化：${change}。`} consequence={`仅影响部署后新建且尚未固定的会话，其中 ${nextPercent ?? 0}% 使用候选。已固定旧会话不会被静默切换。`} confirmLabel={nextPercent === 10 ? '确认开始 10% 灰度' : `确认晋级到 ${nextPercent}%`} pending={pending} onClose={() => setConfirmingDeploy(false)} onConfirm={async () => { await promote(); setConfirmingDeploy(false); }} />
    <ConfirmDialog open={confirmingRollback} title={`回滚到${rollbackTarget}`} description={legacyDeployment ? '当前为历史模型部署；将恢复上一模型版本供新会话使用。' : `当前组合：${current?.label ?? '未识别'}；将恢复上一运行组合供新会话使用。`} consequence="已固定旧会话继续使用原配置，不会被批量改写；回滚只改变之后的新会话路由。" confirmLabel="确认回滚新会话路由" pending={pending} onClose={() => setConfirmingRollback(false)} onConfirm={async () => { await rollback(); setConfirmingRollback(false); }} />
  </section>;
}
