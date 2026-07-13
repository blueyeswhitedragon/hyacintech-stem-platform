"use client";

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WORK_REVIEW_LABELS, type WorkReviewStatus } from '@/app/lib/dataLab/types';

interface PersonSummary {
  id: string;
  username: string;
  displayName: string;
  role: string;
  assigned: number;
  inProgress: number;
  pending: number;
  approved: number;
  returned: number;
  invalid: number;
}

interface WorkItem {
  id: string;
  taskId: string;
  revisionId: string;
  participant: { id: string; username: string; displayName: string; role: string };
  campaign: { id: string; name: string };
  phase: number;
  scenario: string;
  sourceRecordId: string;
  submittedAt: string;
  status: WorkReviewStatus;
  note: string;
  reviewer: { displayName: string } | null;
  preview: string[];
}

const badgeClass: Record<WorkReviewStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  RETURNED: 'bg-blue-50 text-blue-700',
  INVALID: 'bg-red-50 text-red-700',
};

export default function WorkloadReviewTable({ people, items }: { people: PersonSummary[]; items: WorkItem[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<WorkReviewStatus | 'ALL'>('PENDING');
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const filtered = useMemo(() => items.filter((item) => {
    if (status !== 'ALL' && item.status !== status) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [item.participant.displayName, item.participant.username, item.campaign.name, item.scenario, item.sourceRecordId]
      .some((value) => value.toLowerCase().includes(needle));
  }), [items, query, status]);

  async function review(item: WorkItem, nextStatus: Exclude<WorkReviewStatus, 'PENDING'>) {
    const note = notes[item.id]?.trim() ?? '';
    if (nextStatus !== 'APPROVED' && !note) {
      setMessage('退回修改或判定无效时，请先填写审核说明。');
      return;
    }
    if (nextStatus === 'INVALID' && !window.confirm('判定无效后，该任务会重新进入公共队列，原参与者不计有效条数。确定继续吗？')) return;
    setPendingId(item.id); setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/work-reviews/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '审核失败');
      router.refresh();
      setMessage(nextStatus === 'APPROVED' ? '已计入有效工作量。' : nextStatus === 'RETURNED' ? '已退回原参与者修改。' : '已标记无效并重新开放任务。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingId(null);
    }
  }

  return <div className="space-y-6">
    <section className="overflow-hidden rounded-xl border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div><h2 className="font-semibold">参与者工作量</h2><p className="mt-1 text-xs text-gray-500">有效条数只统计审核通过的任务，不包含草稿、待审核和退回记录。</p></div>
        <a href="/api/data-lab/workload/export" className="rounded-lg border px-3 py-2 text-sm text-blue-700 hover:bg-blue-50">导出逐条明细 CSV</a>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-gray-50 text-xs text-gray-600"><tr><th className="p-3">参与者</th><th className="p-3">已分配</th><th className="p-3">进行中</th><th className="p-3">待审核</th><th className="p-3">审核通过</th><th className="p-3">退回修改</th><th className="p-3">无效</th><th className="p-3">有效条数</th></tr></thead><tbody>{people.map((person) => <tr key={person.id} className="border-t"><td className="p-3"><div className="font-medium">{person.displayName}</div><div className="text-xs text-gray-500">{person.username}{person.role !== 'annotator' ? ' · 内部账号' : ''}</div></td><td className="p-3 tabular-nums">{person.assigned}</td><td className="p-3 tabular-nums">{person.inProgress}</td><td className="p-3 tabular-nums text-amber-700">{person.pending}</td><td className="p-3 tabular-nums text-emerald-700">{person.approved}</td><td className="p-3 tabular-nums text-blue-700">{person.returned}</td><td className="p-3 tabular-nums text-red-700">{person.invalid}</td><td className="p-3 text-lg font-semibold tabular-nums">{person.approved}</td></tr>)}</tbody></table></div>
    </section>

    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">逐条审核</h2><p className="mt-1 text-xs text-gray-500">工作量审核和数据集最终选版互相独立；双标结果可以同时通过。</p></div><div className="flex flex-wrap gap-2"><label className="text-xs text-gray-600">状态<select value={status} onChange={(event) => setStatus(event.target.value as WorkReviewStatus | 'ALL')} className="ml-2 rounded-lg border bg-white px-3 py-2 text-sm text-gray-900"><option value="PENDING">待审核</option><option value="APPROVED">审核通过</option><option value="RETURNED">退回修改</option><option value="INVALID">无效</option><option value="ALL">全部</option></select></label><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索人员、活动或样本" className="w-64 rounded-lg border px-3 py-2 text-sm" /></div></div>
      {message && <p aria-live="polite" className="rounded-lg border bg-white px-3 py-2 text-sm text-gray-700">{message}</p>}
      {filtered.length === 0 ? <div className="rounded-xl border bg-white p-8 text-center text-sm text-gray-500">当前筛选条件下没有记录。</div> : <div className="space-y-3">{filtered.map((item) => <article key={item.id} className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs ${badgeClass[item.status]}`}>{WORK_REVIEW_LABELS[item.status]}</span><span className="text-xs text-blue-700">阶段 {item.phase}</span><span className="text-xs text-gray-500">{item.campaign.name}</span></div><h3 className="mt-2 font-medium">{item.scenario}</h3><p className="mt-1 break-all text-xs text-gray-500">{item.sourceRecordId}</p></div><div className="text-right text-sm"><div className="font-medium">{item.participant.displayName}</div><div className="text-xs text-gray-500">{item.participant.username} · {new Date(item.submittedAt).toLocaleString('zh-CN')}</div></div></div><details className="mt-3 rounded-lg bg-gray-50 p-3"><summary className="cursor-pointer text-sm font-medium">查看本次提交内容</summary><div className="mt-3 space-y-2">{item.preview.map((text, index) => <p key={index} className="whitespace-pre-wrap border-l-2 border-gray-300 pl-3 text-sm leading-6 text-gray-700">{text}</p>)}</div></details>{item.status === 'PENDING' ? <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]"><input value={notes[item.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="审核说明（退回或无效时必填）" className="rounded-lg border px-3 py-2 text-sm" /><div className="flex flex-wrap gap-2"><button onClick={() => review(item, 'APPROVED')} disabled={pendingId === item.id} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50">通过并计 1 条</button><button onClick={() => review(item, 'RETURNED')} disabled={pendingId === item.id} className="rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-700 disabled:opacity-50">退回修改</button><button onClick={() => review(item, 'INVALID')} disabled={pendingId === item.id} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-50">标记无效</button></div></div> : <div className="mt-3 text-xs text-gray-600">审核人：{item.reviewer?.displayName ?? '-'}{item.note ? ` · ${item.note}` : ''}</div>}</article>)}</div>}
    </section>
  </div>;
}
