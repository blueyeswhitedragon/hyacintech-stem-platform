"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CampaignLifecycleSummary {
  id: string;
  name: string;
  status: string;
  unfinishedTaskCount: number;
  inProgressTaskCount: number;
  draftTaskCount: number;
  submittedTaskCount: number;
  pendingWorkReviewCount: number;
  pendingReviewCount: number;
  releaseCount: number;
  canDelete: boolean;
}

export default function CampaignLifecycleActions({ campaign }: { campaign: CampaignLifecycleSummary }) {
  const router = useRouter();
  const [panel, setPanel] = useState<'archive' | 'delete' | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (pending) return;
    setPanel(null);
    setReason('');
    setConfirmation('');
    setError(null);
  }

  async function submit() {
    if (!panel) return;
    if (panel === 'archive' && !reason.trim()) {
      setError('请填写结束活动的原因。');
      return;
    }
    if (panel === 'delete' && confirmation !== campaign.name) {
      setError('请输入完整活动名称以确认删除。');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/data-lab/campaigns/${campaign.id}`, panel === 'archive'
        ? {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'archive', reason: reason.trim() }),
          }
        : { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? (panel === 'archive' ? '归档失败' : '删除失败'));
      setPanel(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  const canArchive = campaign.status === 'ACTIVE';
  const canPermanentlyDelete = campaign.status === 'DRAFT' && campaign.canDelete;
  if (!canArchive && campaign.status !== 'DRAFT') return null;

  return <>
    <div className="flex flex-wrap items-center gap-2">
      {canArchive && <button type="button" onClick={() => setPanel('archive')} className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-50">结束并归档</button>}
      {campaign.status === 'DRAFT' && <button type="button" disabled={!canPermanentlyDelete} title={canPermanentlyDelete ? '永久删除这个尚未启动的空草稿' : '该活动已有业务记录，只能归档'} onClick={() => setPanel('delete')} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 disabled:cursor-not-allowed disabled:opacity-35">永久删除草稿</button>}
    </div>

    {panel && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-label={panel === 'archive' ? '结束并归档活动' : '永久删除草稿活动'} className="w-full max-w-xl rounded-2xl border bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">{panel === 'archive' ? '结束并归档活动' : '永久删除草稿活动'}</h3><p className="mt-1 text-sm text-gray-500">{campaign.name}</p></div><button type="button" onClick={close} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100" aria-label="关闭">×</button></div>

        {panel === 'archive' ? <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-medium">执行后将停止分发这个活动的所有未完成任务。</p>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              <div><dt className="text-xs text-amber-700">将取消的未完成任务</dt><dd className="font-semibold tabular-nums">{campaign.unfinishedTaskCount} 条</dd></div>
              <div><dt className="text-xs text-amber-700">其中正在处理或已退回</dt><dd className="font-semibold tabular-nums">{campaign.inProgressTaskCount} 条</dd></div>
              <div><dt className="text-xs text-amber-700">包含未提交草稿</dt><dd className="font-semibold tabular-nums">{campaign.draftTaskCount} 条</dd></div>
              <div><dt className="text-xs text-amber-700">保留的已提交任务</dt><dd className="font-semibold tabular-nums">{campaign.submittedTaskCount} 条</dd></div>
              <div><dt className="text-xs text-amber-700">仍需工作量审核 / 仲裁</dt><dd className="font-semibold tabular-nums">{campaign.pendingWorkReviewCount} / {campaign.pendingReviewCount}</dd></div>
              <div><dt className="text-xs text-amber-700">保留的发布版本</dt><dd className="font-semibold tabular-nums">{campaign.releaseCount} 个</dd></div>
            </dl>
          </div>
          <p className="text-sm leading-6 text-gray-600">已提交内容、审核记录、有效工作量、仲裁结果和数据集版本都会保留。归档后不能再把任务退回给标注员修改。</p>
          <label className="block text-sm font-medium">归档原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：试运行已结束，正式标注改用新活动" className="mt-2 min-h-24 w-full rounded-lg border px-3 py-2 font-normal" /></label>
        </div> : <div className="mt-5 space-y-4">
          <div className="rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-800">该活动尚未启动且没有任务、仲裁或发布记录，可以永久删除。此操作不可恢复。</div>
          <label className="block text-sm font-medium">请输入完整活动名称确认<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={campaign.name} className="mt-2 w-full rounded-lg border px-3 py-2 font-normal" /></label>
        </div>}

        {error && <p aria-live="polite" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={close} disabled={pending} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">取消</button><button type="button" onClick={submit} disabled={pending || (panel === 'archive' ? !reason.trim() : confirmation !== campaign.name)} className={`rounded-lg px-4 py-2 text-sm text-white disabled:opacity-40 ${panel === 'archive' ? 'bg-amber-700' : 'bg-red-600'}`}>{pending ? '处理中…' : panel === 'archive' ? '确认结束并归档' : '确认永久删除'}</button></div>
      </section>
    </div>}
  </>;
}
