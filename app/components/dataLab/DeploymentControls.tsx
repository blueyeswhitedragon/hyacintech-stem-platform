'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeploymentControls({ models, active }: { models: Array<{ id: string; tag: string; status: string }>; active: { id: string; modelVersionId: string; rolloutPercent: number; previousModelVersionId: string | null } | null }) {
  const router = useRouter();
  const [modelId, setModelId] = useState(active?.modelVersionId ?? models.find((model) => model.status === 'ELIGIBLE')?.id ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const same = active?.modelVersionId === modelId;
  const nextPercent = same ? active?.rolloutPercent === 10 ? 30 : active?.rolloutPercent === 30 ? 100 : null : 10;

  async function promote() {
    if (!nextPercent) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch('/api/data-lab/deployments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelVersionId: modelId, rolloutPercent: nextPercent }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '部署失败');
      setMessage(`已进入 ${nextPercent}% 灰度`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  async function rollback() {
    if (!active) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/deployments/${active.id}/rollback`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '回滚失败');
      setMessage('已回滚到上一生产模型'); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  return <div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">灰度部署控制</h2><p className="mt-1 text-xs text-gray-500">只有五种风格门禁全部通过的模型可部署；会话一旦分桶便保持模型黏性。</p><div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-sm">候选模型<select value={modelId} onChange={(event) => setModelId(event.target.value)} className="mt-1 block border px-3 py-2"><option value="">请选择</option>{models.filter((model) => ['ELIGIBLE', 'DEPLOYED'].includes(model.status)).map((model) => <option key={model.id} value={model.id}>{model.tag} · {model.status}</option>)}</select></label><button disabled={pending || !modelId || !nextPercent} onClick={promote} className="bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">{nextPercent ? `晋级到 ${nextPercent}%` : '已完成 100%'}</button><button disabled={pending || !active?.previousModelVersionId} onClick={rollback} className="border border-red-500 px-4 py-2 text-sm text-red-700 disabled:opacity-40">一键回滚</button>{message && <span className="text-sm text-gray-600">{message}</span>}</div></div>;
}
