'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import { DATA_LAB_STATUS_LABELS, DEPLOYMENT_OBSERVATION_META } from '@/app/lib/dataLab/labels';

interface ActiveDeployment { id: string; modelVersionId: string; rolloutPercent: number; previousModelVersionId: string | null; startedAt?: string | Date | null; observationJson?: string }

export default function DeploymentControls({ models, active }: { models: Array<{ id: string; tag: string; status: string }>; active: ActiveDeployment | null }) {
  const router = useRouter();
  const [modelId, setModelId] = useState(active?.modelVersionId ?? models.find((model) => model.status === 'ELIGIBLE')?.id ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingRollback, setConfirmingRollback] = useState(false);
  const [observation, setObservation] = useState({ sessions: 0, criticalErrors: 0, structureFailureRate: 0, baselineStructureFailureRate: 0, teacherRejectRate: 0, baselineTeacherRejectRate: 0, earlyTerminationRate: 0, baselineEarlyTerminationRate: 0 });
  const same = active?.modelVersionId === modelId;
  const nextPercent = same ? active?.rolloutPercent === 10 ? 30 : active?.rolloutPercent === 30 ? 100 : null : 10;

  async function promote() {
    if (!nextPercent) return; setPending(true); setMessage(null);
    try { const response = await fetch('/api/data-lab/deployments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelVersionId: modelId, rolloutPercent: nextPercent }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '部署失败'); setMessage(`已进入 ${nextPercent}% 灰度`); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }
  async function saveObservation() {
    if (!active) return; setPending(true); setMessage(null);
    try { const response = await fetch(`/api/data-lab/deployments/${active.id}/observation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(observation) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '保存失败'); setMessage('线上观察指标已保存'); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }
  async function rollback() {
    if (!active) return; setPending(true); setMessage(null);
    try { const response = await fetch(`/api/data-lab/deployments/${active.id}/rollback`, { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '回滚失败'); setMessage('已回滚到上一生产模型'); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }
  return <div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">灰度部署控制</h2><p className="mt-1 text-xs text-gray-500">离线门禁按六个阶段、关键错误、结构解析和评测产物完整性判断；10% 和 30% 晋级还必须满足线上观察窗口。</p><div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-sm">候选模型<select value={modelId} onChange={(e) => setModelId(e.target.value)} className="mt-1 block border px-3 py-2"><option value="">请选择</option>{models.filter((model) => ['ELIGIBLE', 'DEPLOYED'].includes(model.status)).map((model) => <option key={model.id} value={model.id}>{model.tag} · {DATA_LAB_STATUS_LABELS[model.status] ?? '状态待确认'}</option>)}</select></label><button disabled={pending || !modelId || !nextPercent} onClick={promote} className="bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">{nextPercent ? `晋级到 ${nextPercent}%` : '已完成 100%'}</button><button disabled={pending || !active?.previousModelVersionId} onClick={() => setConfirmingRollback(true)} className="border border-red-500 px-4 py-2 text-sm text-red-700 disabled:opacity-40">回滚到上一版本</button></div>
    {active && [10, 30].includes(active.rolloutPercent) && <details className="mt-4 rounded border bg-gray-50 p-3"><summary className="cursor-pointer text-sm font-medium">记录 {active.rolloutPercent}% 线上观察指标</summary><p className="mt-1 text-xs text-gray-500">10%：至少 48 小时 / 50 会话；30%：至少 72 小时 / 150 会话。出现任何严重错误都会立即阻断。</p><div className="mt-3 grid gap-3 md:grid-cols-4">{Object.entries(observation).map(([key, value]) => { const meta = DEPLOYMENT_OBSERVATION_META[key] ?? { label: '其他指标' }; return <label key={key} className="text-xs font-medium">{meta.label}<span className="ml-1 font-normal text-gray-500">（{meta.unit}）</span><input type="number" min="0" max={key === 'sessions' || key === 'criticalErrors' ? undefined : 1} step={key === 'sessions' || key === 'criticalErrors' ? 1 : 0.001} value={value} onChange={(e) => setObservation({ ...observation, [key]: Number(e.target.value) })} className="mt-1 w-full border px-2 py-1.5 font-normal" />{meta.help && <span className="mt-1 block font-normal leading-4 text-gray-500">{meta.help}</span>}</label>; })}</div><button disabled={pending} onClick={saveObservation} className="mt-3 border px-3 py-1.5 text-xs">保存观察指标</button></details>}
    {message && <p className="mt-3 text-sm text-gray-600">{message}</p>}
    <ConfirmDialog open={confirmingRollback} title="回滚生产模型" description="当前候选模型将退出生产流量，仍使用它的会话会重新固定到上一生产模型。" consequence="这是影响线上会话的操作。回滚会创建新的生产部署记录，历史评测与观察记录继续保留。" confirmLabel="确认回滚" danger pending={pending} onClose={() => setConfirmingRollback(false)} onConfirm={async () => { await rollback(); setConfirmingRollback(false); }} />
  </div>;
}
