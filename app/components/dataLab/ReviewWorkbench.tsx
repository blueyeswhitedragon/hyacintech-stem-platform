"use client";

import { useEffect, useState } from 'react';
import type { ShareGPTRecord } from '@/app/lib/dataLab/types';

interface ReviewPayload {
  id: string;
  phase: number;
  scenario: string;
  original: ShareGPTRecord;
  candidates: Array<{ label: string; id: string; record: ShareGPTRecord }>;
  autoCheck: unknown;
}

function assistantText(record: ShareGPTRecord) {
  return record.conversations.filter((message) => message.from === 'gpt').map((message, index) => {
    try { return `${index + 1}. ${(JSON.parse(message.value) as { dialogue?: string }).dialogue ?? message.value}`; }
    catch { return `${index + 1}. ${message.value}`; }
  }).join('\n\n');
}

export default function ReviewWorkbench() {
  const [item, setItem] = useState<ReviewPayload | null>(null); const [selected, setSelected] = useState<string>(''); const [tier, setTier] = useState<'human_gold'|'reviewed_silver'|'reject'>('human_gold'); const [reason, setReason] = useState(''); const [message, setMessage] = useState<string | null>(null); const [pending, setPending] = useState(false);
  async function claim() { setPending(true); setMessage(null); try { const response = await fetch('/api/data-lab/reviews/claim', { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '领取失败'); setItem(data.reviewCase); setSelected(''); if (!data.reviewCase) setMessage('当前没有待仲裁任务。'); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); } }
  useEffect(() => {
    let cancelled = false;
    fetch('/api/data-lab/reviews/claim', { method: 'POST' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '领取失败');
        if (!cancelled) setItem(data.reviewCase);
        if (!cancelled && !data.reviewCase) setMessage('当前没有待仲裁任务。');
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);
  async function decide(action: 'SELECT'|'RETURN'|'REJECT') { if (!item) return; if (action === 'SELECT' && !selected) { setMessage('请选择一个候选版本'); return; } setPending(true); setMessage(null); try { const response = await fetch(`/api/data-lab/reviews/${item.id}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, selectedRevisionId: action === 'SELECT' ? selected : undefined, finalTier: action === 'REJECT' ? 'reject' : tier, reason }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '提交失败'); await claim(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); } }
  if (!item) return <div className="border bg-white p-8 text-center"><p className="text-gray-500">{message ?? '正在领取仲裁任务…'}</p><button onClick={claim} disabled={pending} className="mt-4 bg-gray-950 px-4 py-2 text-sm text-white">重新领取</button></div>;
  return <div className="space-y-5"><div className="border bg-white p-4"><div className="text-xs font-medium text-blue-700">P{item.phase} · 匿名仲裁</div><h2 className="mt-1 text-lg font-semibold">{item.scenario}</h2><div className="mt-3 max-w-4xl space-y-2">{item.original.conversations.filter((message) => message.from === 'human').map((message, index) => <p key={index} className="border-l-4 border-gray-300 pl-3 text-sm leading-6">{message.value}</p>)}</div></div>
    <div className="grid gap-4 xl:grid-cols-2">{item.candidates.map((candidate) => <label key={candidate.id} className={`block cursor-pointer border bg-white p-4 ${selected === candidate.id ? 'border-blue-600 ring-1 ring-blue-600' : ''}`}><div className="flex items-center justify-between"><span className="text-lg font-semibold">版本 {candidate.label}</span><input type="radio" name="candidate" value={candidate.id} checked={selected === candidate.id} onChange={() => setSelected(candidate.id)} /></div><pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-6 text-gray-800">{assistantText(candidate.record)}</pre></label>)}</div>
    <div className="grid gap-4 border bg-white p-4 lg:grid-cols-[220px_1fr_auto]"><label className="text-sm">最终等级<select value={tier} onChange={(event) => setTier(event.target.value as typeof tier)} className="mt-1 w-full border px-2 py-2"><option value="human_gold">Human Gold</option><option value="reviewed_silver">Reviewed Silver</option><option value="reject">Reject</option></select></label><label className="text-sm">仲裁理由<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-20 w-full border p-2" /></label><div className="flex flex-wrap items-end gap-2"><button onClick={() => decide('SELECT')} disabled={pending} className="bg-gray-950 px-3 py-2 text-sm text-white">接受所选</button><button onClick={() => decide('RETURN')} disabled={pending} className="border px-3 py-2 text-sm">退回</button><button onClick={() => decide('REJECT')} disabled={pending} className="border border-red-600 px-3 py-2 text-sm text-red-700">拒绝</button></div></div>{message && <p className="text-sm text-red-600">{message}</p>}
  </div>;
}
