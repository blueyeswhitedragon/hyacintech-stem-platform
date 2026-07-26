"use client";

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WORK_REVIEW_LABELS, type AutoCheckResult, type WorkReviewStatus } from '@/app/lib/dataLab/types';
import { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select } from '@/app/components/ui/Field';

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
  campaign: { id: string; name: string; status: string };
  phase: number;
  scenario: string;
  sourceRecordId: string;
  submittedAt: string;
  status: WorkReviewStatus;
  note: string;
  reviewer: { displayName: string } | null;
  preview: string[];
  check: AutoCheckResult;
}

const badgeClass: Record<WorkReviewStatus, string> = {
  PENDING: 'bg-warning/8 text-body-strong',
  APPROVED: 'bg-success/8 text-body-strong',
  RETURNED: 'bg-info/8 text-body-strong',
  INVALID: 'bg-error/8 text-body-strong',
};

export default function WorkloadReviewTable({ people, items }: { people: PersonSummary[]; items: WorkItem[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<WorkReviewStatus | 'ALL'>('PENDING');
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [invalidatingItem, setInvalidatingItem] = useState<WorkItem | null>(null);
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
    if (nextStatus === 'RETURNED' && item.campaign.status !== 'ACTIVE') {
      setMessage('该活动已经归档，不能再退回给标注员修改；可以审核通过或标记无效。');
      return;
    }
    setPendingId(item.id); setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/work-reviews/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '审核失败');
      setInvalidatingItem(null);
      router.refresh();
      setMessage(nextStatus === 'APPROVED' ? '已计入有效工作量。' : nextStatus === 'RETURNED' ? '已退回原参与者修改。' : item.campaign.status === 'ACTIVE' ? '已标记无效并重新开放任务。' : '已标记无效；归档活动不会重新开放任务。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingId(null);
    }
  }

  return <div className="space-y-6">
    <section className="overflow-hidden rounded-lg border border-hairline bg-canvas">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-b-hairline px-4 py-3">
        <div><h2 className="font-semibold">参与者工作量</h2><p className="mt-1 text-xs text-muted">有效条数只统计审核通过的任务，不包含草稿、待审核和退回记录。</p></div>
        <a href="/api/data-lab/workload/export" className={buttonClass('secondary', 'sm')}>导出逐条明细 CSV</a>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-surface-soft text-xs text-muted"><tr><th className="p-3">参与者</th><th className="p-3">已分配</th><th className="p-3">进行中</th><th className="p-3">待审核</th><th className="p-3">审核通过</th><th className="p-3">退回修改</th><th className="p-3">无效</th><th className="p-3">有效条数</th></tr></thead><tbody>{people.map((person) => <tr key={person.id} className="border-t border-t-hairline"><td className="p-3"><div className="font-medium">{person.displayName}</div><div className="text-xs text-muted">{person.username}{person.role !== 'annotator' ? ' · 内部账号' : ''}</div></td><td className="p-3 tabular-nums">{person.assigned}</td><td className="p-3 tabular-nums">{person.inProgress}</td><td className="p-3 tabular-nums text-[#8a6a0f]">{person.pending}</td><td className="p-3 tabular-nums text-[#2f7a43]">{person.approved}</td><td className="p-3 tabular-nums text-[#2f7f70]">{person.returned}</td><td className="p-3 tabular-nums text-error">{person.invalid}</td><td className="p-3 text-lg font-semibold tabular-nums">{person.approved}</td></tr>)}</tbody></table></div>
    </section>

    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">逐条审核</h2><p className="mt-1 text-xs text-muted">工作量审核和数据集最终选版互相独立；双标结果可以同时通过。</p></div><div className="flex flex-wrap gap-2"><label className="text-xs text-muted">状态<Select value={status} onChange={(event) => setStatus(event.target.value as WorkReviewStatus | 'ALL')} className="ml-2"><option value="PENDING">待审核</option><option value="APPROVED">审核通过</option><option value="RETURNED">退回修改</option><option value="INVALID">无效</option><option value="ALL">全部</option></Select></label><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索人员、活动或样本" className="w-64" /></div></div>
      {message && <p aria-live="polite" className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-body">{message}</p>}
      {filtered.length === 0 ? <div className="rounded-lg border border-hairline bg-canvas p-8 text-center text-sm text-muted">当前筛选条件下没有记录。</div> : <div className="space-y-3">{filtered.map((item) => { const errors = item.check.issues.filter((checkIssue) => checkIssue.severity === 'error'); const warnings = item.check.issues.filter((checkIssue) => checkIssue.severity === 'warning'); return <article key={item.id} className="rounded-lg border border-hairline bg-canvas p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs ${badgeClass[item.status]}`}>{WORK_REVIEW_LABELS[item.status]}</span><span className="text-xs text-[#2f7f70]">阶段 {item.phase}</span><span className={`rounded-full px-2 py-1 text-xs ${errors.length > 0 ? 'bg-error/10 text-body-strong' : warnings.length > 0 ? 'bg-warning/10 text-body-strong' : 'bg-success/10 text-body-strong'}`}>{errors.length > 0 ? `${errors.length} 个自动错误` : warnings.length > 0 ? `${warnings.length} 个复核项` : '自动检查通过'}</span><span className="text-xs text-muted">{item.campaign.name}</span>{item.campaign.status === 'ARCHIVED' && <span className="rounded-full bg-surface-card px-2 py-1 text-xs text-body">活动已归档</span>}</div><h3 className="mt-2 font-medium">{item.scenario}</h3><p className="mt-1 break-all text-xs text-muted">{item.sourceRecordId}</p></div><div className="text-right text-sm"><div className="font-medium">{item.participant.displayName}</div><div className="text-xs text-muted">{item.participant.username} · {new Date(item.submittedAt).toLocaleString('zh-CN')}</div></div></div><details className="mt-3 rounded-lg bg-surface-soft p-3"><summary className="cursor-pointer text-sm font-medium">查看本次提交内容与自动检查</summary><div className="mt-3 space-y-2">{item.preview.map((text, index) => <p key={index} className="whitespace-pre-wrap border-l-2 border-hairline pl-3 text-sm leading-6 text-body">{text}</p>)}</div>{item.check.issues.length > 0 && <ul className="mt-3 space-y-1 border-t border-t-hairline pt-3 text-xs">{item.check.issues.map((checkIssue) => <li key={`${checkIssue.ruleCode}-${checkIssue.messageIndex}-${checkIssue.message}`} className={checkIssue.severity === 'error' ? 'text-error' : 'text-[#8a6a0f]'}>• [{checkIssue.severity === 'error' ? '错误' : '人工复核'}] {checkIssue.message}</li>)}</ul>}</details>{item.status === 'PENDING' ? <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]"><Input value={notes[item.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="审核说明（退回或无效时必填）" /><div className="flex flex-wrap gap-2"><button onClick={() => review(item, 'APPROVED')} disabled={pendingId === item.id || errors.length > 0} title={errors.length > 0 ? '存在硬错误，不能计为有效标注' : '通过并计入有效条数'} className={buttonClass('primary', 'sm')}>通过并计 1 条</button><button title={item.campaign.status === 'ACTIVE' ? '退回原参与者修改' : '活动已归档，不能重新开放任务'} onClick={() => review(item, 'RETURNED')} disabled={pendingId === item.id || item.campaign.status !== 'ACTIVE'} className={buttonClass('secondary', 'sm')}>退回修改</button><button onClick={() => { if (!(notes[item.id] ?? '').trim()) { setMessage('判定无效前，请先填写审核说明。'); return; } setInvalidatingItem(item); }} disabled={pendingId === item.id} className={buttonClass('danger', 'sm')}>标记无效</button></div></div> : <div className="mt-3 text-xs text-muted">审核人：{item.reviewer?.displayName ?? '-'}{item.note ? ` · ${item.note}` : ''}</div>}</article>; })}</div>}
      <ConfirmDialog open={Boolean(invalidatingItem)} title="将标注任务判定为无效" description="原参与者不会获得这条有效工作量。" consequence={invalidatingItem?.campaign.status === 'ACTIVE' ? '任务会清除当前分配并重新进入公共队列，供其他参与者领取。' : '活动已经归档，任务会保持取消且不会重新分发。'} confirmLabel="确认标记无效" danger pending={Boolean(pendingId)} onClose={() => setInvalidatingItem(null)} onConfirm={() => invalidatingItem && review(invalidatingItem, 'INVALID')} />
    </section>
  </div>;
}
