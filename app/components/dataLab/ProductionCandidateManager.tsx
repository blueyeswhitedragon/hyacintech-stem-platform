'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Dialog from '@/app/components/dataLab/Dialog';
import { dataLabStatusLabel, dataLabValueLabel } from '@/app/lib/dataLab/labels';

interface CandidateView {
  id: string;
  status: string;
  stage: number;
  styleFamily: string;
  modelTag: string;
  triggerNote: string;
  human: string;
  assistant: string;
  replacements: number;
  exactMatches: number;
  nearDuplicates: number;
}

export default function ProductionCandidateManager({ candidates }: { candidates: CandidateView[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [batchName, setBatchName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  async function review(id: string, action: 'APPROVE' | 'REJECT', reason = '') {
    if (action === 'REJECT' && !reason.trim()) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/candidates/${id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '审核失败');
      setRejectingId(null);
      setRejectReason('');
      setMessage(action === 'APPROVE' ? '候选已通过脱敏审核。' : '候选已拒绝并记录理由。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  async function convert() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/data-lab/candidates/convert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selected, batchName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '转换失败');
      setSelected([]);
      setBatchName('');
      setMessage(`已转换 ${data.summary.records} 条候选为导师回合案例。`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-4">
        <label className="text-sm">转换备注（可选）<input value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="线上问题回流-2026-07" className="mt-1 block border px-3 py-2" /></label>
        <button disabled={pending || selected.length === 0} onClick={convert} className="bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">转换为导师回合案例（{selected.length}）</button>
        {message && <span className="text-sm text-gray-600">{message}</span>}
      </div>
      {candidates.map((candidate) => (
        <article key={candidate.id} className="rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><span className="font-medium">阶段 {candidate.stage}</span><span className="rounded bg-gray-100 px-2 py-1 text-xs">{dataLabStatusLabel(candidate.status)}</span><span className="text-xs text-gray-500">{dataLabValueLabel(candidate.styleFamily)} · {candidate.modelTag}</span></div>
            {candidate.status === 'APPROVED' && <label className="text-xs"><input type="checkbox" checked={selected.includes(candidate.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, candidate.id] : selected.filter((id) => id !== candidate.id))} /> 选择转换</label>}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded bg-gray-50 p-3 text-sm"><div className="mb-1 text-xs font-medium text-gray-500">学生输入（已脱敏）</div><p className="whitespace-pre-wrap">{candidate.human}</p></div><div className="rounded bg-gray-50 p-3 text-sm"><div className="mb-1 text-xs font-medium text-gray-500">导师回复（已脱敏）</div><p className="whitespace-pre-wrap">{candidate.assistant}</p></div></div>
          <div className="mt-3 text-xs text-gray-500">脱敏替换 {candidate.replacements} 处 · 精确重复 {candidate.exactMatches} · 近重复 {candidate.nearDuplicates}{candidate.triggerNote && <> · 提名说明：{candidate.triggerNote}</>}</div>
          {candidate.status === 'NOMINATED' && <div className="mt-3 flex gap-2"><button disabled={pending} onClick={() => review(candidate.id, 'APPROVE')} className="rounded bg-green-600 px-3 py-1.5 text-xs text-white">通过脱敏候选</button><button disabled={pending} onClick={() => { setRejectingId(candidate.id); setRejectReason(''); }} className="rounded bg-red-600 px-3 py-1.5 text-xs text-white">拒绝</button></div>}
        </article>
      ))}
      {candidates.length === 0 && <p className="text-sm text-gray-500">暂无生产候选。</p>}
      <Dialog open={Boolean(rejectingId)} title="拒绝线上问题候选" description="请填写可供后续审计和重新提名参考的具体原因。" onClose={() => { if (!pending) setRejectingId(null); }} footer={<><button type="button" disabled={pending} onClick={() => setRejectingId(null)} className="rounded border px-4 py-2 text-sm">取消</button><button type="button" disabled={pending || !rejectReason.trim()} onClick={() => rejectingId && review(rejectingId, 'REJECT', rejectReason)} className="rounded bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-40">确认拒绝</button></>}>
        <label className="block text-sm font-medium">拒绝理由<textarea autoFocus value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mt-2 min-h-28 w-full border p-3 font-normal" placeholder="例如：脱敏后仍可识别个人身份，或内容不具备训练价值" /></label>
      </Dialog>
    </div>
  );
}
