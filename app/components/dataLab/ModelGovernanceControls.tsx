'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import { dataLabStatusLabel } from '@/app/lib/dataLab/labels';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select } from '@/app/components/ui/Field';

export function TrainingRunStatusControl({ id, currentStatus, currentExternalTaskId }: {
  id: string;
  currentStatus: string;
  currentExternalTaskId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(currentStatus);
  const [externalTaskId, setExternalTaskId] = useState(currentExternalTaskId ?? '');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    setPending(true); setMessage('');
    try {
      const response = await fetch(`/api/data-lab/training-runs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, externalTaskId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '更新失败');
      setMessage('训练状态已更新。'); setOpen(false); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }
  return <div>
    <button type="button" onClick={() => setOpen((value) => !value)} className={buttonClass('secondary', 'sm')}>更新训练状态</button>
    {open && <div className="mt-2 grid gap-2 rounded-md border border-hairline bg-surface-soft p-3 sm:grid-cols-2">
      <label className="text-xs">状态<Select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1">{['DRAFT', 'SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].map((item) => <option key={item} value={item}>{dataLabStatusLabel(item)}</option>)}</Select></label>
      <label className="text-xs">外部任务 ID<Input value={externalTaskId} onChange={(event) => setExternalTaskId(event.target.value)} className="mt-1" /></label>
      <button type="button" disabled={pending} onClick={save} className={buttonClass('primary', 'sm')}>保存训练状态</button>
    </div>}
    {message && <p aria-live="polite" className={`mt-1 text-xs ${message.includes('已更新') ? 'text-[#2f7a43]' : 'text-error'}`}>{message}</p>}
  </div>;
}

export function DisableModelButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  async function disable() {
    setPending(true); setMessage('');
    try {
      const response = await fetch(`/api/data-lab/models/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'DISABLE' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '停用失败');
      setMessage('模型产物已停用。'); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }
  return <div><button type="button" disabled={pending} onClick={() => setConfirming(true)} className={buttonClass('danger', 'sm')}>停用模型产物</button>{message && <p aria-live="polite" className="mt-1 text-xs text-error">{message}</p>}<ConfirmDialog open={confirming} title="停用模型产物" description="禁止新运行组合使用此模型，并停用其非生产运行组合。" consequence="历史训练、评测和生成轨迹会保留；生产中的模型必须先回滚或切换。" confirmLabel="确认停用模型产物" pending={pending} onClose={() => setConfirming(false)} onConfirm={async () => { await disable(); setConfirming(false); }} /></div>;
}
