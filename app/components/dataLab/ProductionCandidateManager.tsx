'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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

  async function review(id: string, action: 'APPROVE' | 'REJECT') {
    const reason = action === 'REJECT' ? window.prompt('请输入拒绝理由') ?? '' : '';
    if (action === 'REJECT' && !reason.trim()) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/candidates/${id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '审核失败');
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
      setMessage(`已转换 ${data.summary.records} 条候选为隔离数据批次`);
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
        <label className="text-sm">新批次名称<input value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="线上问题回流-2026-07" className="mt-1 block border px-3 py-2" /></label>
        <button disabled={pending || selected.length === 0 || !batchName.trim()} onClick={convert} className="bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">转换已选 APPROVED（{selected.length}）</button>
        {message && <span className="text-sm text-gray-600">{message}</span>}
      </div>
      {candidates.map((candidate) => (
        <article key={candidate.id} className="rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><span className="font-medium">阶段 {candidate.stage}</span><span className="rounded bg-gray-100 px-2 py-1 text-xs">{candidate.status}</span><span className="text-xs text-gray-500">{candidate.styleFamily} · {candidate.modelTag}</span></div>
            {candidate.status === 'APPROVED' && <label className="text-xs"><input type="checkbox" checked={selected.includes(candidate.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, candidate.id] : selected.filter((id) => id !== candidate.id))} /> 选择转换</label>}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded bg-gray-50 p-3 text-sm"><div className="mb-1 text-xs font-medium text-gray-500">学生输入（已脱敏）</div><p className="whitespace-pre-wrap">{candidate.human}</p></div><div className="rounded bg-gray-50 p-3 text-sm"><div className="mb-1 text-xs font-medium text-gray-500">导师回复（已脱敏）</div><p className="whitespace-pre-wrap">{candidate.assistant}</p></div></div>
          <div className="mt-3 text-xs text-gray-500">脱敏替换 {candidate.replacements} 处 · 精确重复 {candidate.exactMatches} · 近重复 {candidate.nearDuplicates}{candidate.triggerNote && <> · 提名说明：{candidate.triggerNote}</>}</div>
          {candidate.status === 'NOMINATED' && <div className="mt-3 flex gap-2"><button disabled={pending} onClick={() => review(candidate.id, 'APPROVE')} className="rounded bg-green-600 px-3 py-1.5 text-xs text-white">通过脱敏候选</button><button disabled={pending} onClick={() => review(candidate.id, 'REJECT')} className="rounded bg-red-600 px-3 py-1.5 text-xs text-white">拒绝</button></div>}
        </article>
      ))}
      {candidates.length === 0 && <p className="text-sm text-gray-500">暂无生产候选。</p>}
    </div>
  );
}
