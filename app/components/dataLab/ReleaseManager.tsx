'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import { dataLabValueLabel } from '@/app/lib/dataLab/labels';

export default function ReleaseManager({ turns }: { turns: Array<{ id: string; label: string; phase: number; eligible: boolean; provenance: string; reviewerEditType: string }> }) {
  const router = useRouter();
  const [version, setVersion] = useState('');
  const [selected, setSelected] = useState<string[]>(turns.filter((turn) => turn.eligible).map((turn) => turn.id));
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [pending, setPending] = useState(false);
  const [confirmingCreate, setConfirmingCreate] = useState(false);
  async function create() {
    setPending(true); setMessage(null);
    try {
      const response = await fetch('/api/data-lab/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, finalizedTutorTurnIds: selected }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '创建失败');
      setMessageTone('success'); setMessage(`数据版本已冻结：监督微调数据 ${data.summary.training} 条，偏好对 ${data.summary.preference} 条。`); setVersion(''); router.refresh();
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }
  return <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">从已定稿的导师回合创建数据版本</h2><p className="mt-1 text-xs text-gray-500">选择具备训练资格的数据并冻结为不可修改版本。导出只包含导师教学语言；平台状态、确认书和结构化产物不会写入模型训练目标。</p><label className="mt-3 block max-w-md text-sm">版本号<input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="tutor-language-v1-2026-07" className="mt-1 w-full border px-3 py-2" /></label><div className="mt-4 max-h-72 space-y-2 overflow-auto rounded border p-3">{turns.map((turn) => <label key={turn.id} className={`flex items-center gap-2 text-sm ${turn.eligible ? '' : 'text-gray-400'}`}><input type="checkbox" disabled={!turn.eligible} checked={selected.includes(turn.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, turn.id] : selected.filter((id) => id !== turn.id))} /><span>阶段 {turn.phase} · {turn.label} · {dataLabValueLabel(turn.provenance)} · 定稿人{dataLabValueLabel(turn.reviewerEditType)}</span>{!turn.eligible && <span className="text-xs">（评测集专用或不具备训练资格）</span>}</label>)}{turns.length === 0 && <p className="text-sm text-gray-500">暂无完成正式人工审核的导师回合。</p>}</div><div className="mt-4 flex items-center gap-3"><button onClick={() => setConfirmingCreate(true)} disabled={pending || !version.trim() || selected.length === 0} className="bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">创建并冻结</button>{message && <span className={`text-sm ${messageTone === 'success' ? 'text-green-700' : 'text-red-700'}`}>{message}</span>}</div><ConfirmDialog open={confirmingCreate} title="创建并冻结数据版本" description={`将 ${selected.length} 条已定稿数据写入版本“${version}”。`} consequence="冻结后不能增删条目或修改内容；如需调整，必须创建新的版本。" confirmLabel="确认创建并冻结" pending={pending} onClose={() => setConfirmingCreate(false)} onConfirm={async () => { await create(); setConfirmingCreate(false); }} /></section>;
}

export function FreezeReleaseButton({ id }: { id: string }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null); const [confirming, setConfirming] = useState(false);
  async function freeze() { setPending(true); setError(null); try { const response = await fetch(`/api/data-lab/releases/${id}/freeze`, { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '冻结失败'); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setPending(false); } }
  return <div><button onClick={() => setConfirming(true)} disabled={pending} className="border border-gray-900 px-3 py-1 text-xs">{pending ? '冻结中…' : '冻结草稿版本'}</button>{error && <div className="mt-1 text-xs text-red-600">{error}</div>}<ConfirmDialog open={confirming} title="冻结草稿版本" description="将这个尚未冻结的历史版本转为正式交付版本。" consequence="冻结后内容不可修改，只能通过新建版本继续调整。" confirmLabel="确认冻结" pending={pending} onClose={() => setConfirming(false)} onConfirm={async () => { await freeze(); setConfirming(false); }} /></div>;
}
