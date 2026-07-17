"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PHASE_META } from '@/app/lib/dataLab/types';
import { ConfirmDialog } from '@/app/components/dataLab/Dialog';

interface ExpiredTaskItem {
  id: string;
  campaignName: string;
  phase: number;
  scenario: string;
  sourceRecordId: string;
  assignedTo: { displayName: string; username: string } | null;
  leaseExpiresAt: string | null;
  hasDraft: boolean;
}

export default function ExpiredTaskManager({ tasks }: { tasks: ExpiredTaskItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingTask, setConfirmingTask] = useState<ExpiredTaskItem | null>(null);

  async function release(task: ExpiredTaskItem) {
    setPendingId(task.id); setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/tasks/${task.id}/release`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '释放失败');
      setMessage('任务已释放，可由其他合格标注员领取。');
      setConfirmingTask(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingId(null);
    }
  }

  return <section className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
    <div><h2 className="font-semibold">过期任务管理</h2><p className="mt-1 text-sm text-gray-500">原标注员重新进入工作台会自动续租。只有确认需要换人时才释放；释放会清除未提交草稿。</p></div>
    {tasks.length === 0 ? <p className="text-sm text-gray-500">当前没有过期任务。</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b bg-gray-50"><tr><th className="p-3">活动/阶段</th><th className="p-3">场景</th><th className="p-3">原标注员</th><th className="p-3">过期时间</th><th className="p-3">草稿</th><th className="p-3"></th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id} className="border-b last:border-0"><td className="p-3"><div>{task.campaignName}</div><div className="text-xs text-gray-500">阶段 {task.phase} · {PHASE_META[task.phase]?.label}</div></td><td className="max-w-sm p-3">{task.scenario}</td><td className="p-3">{task.assignedTo ? `${task.assignedTo.displayName}（${task.assignedTo.username}）` : '-'}</td><td className="p-3 tabular-nums">{task.leaseExpiresAt ? new Date(task.leaseExpiresAt).toLocaleString('zh-CN') : '-'}</td><td className="p-3">{task.hasDraft ? <span className="text-amber-700">有，释放将清除</span> : '无'}</td><td className="p-3"><button type="button" disabled={pendingId === task.id} onClick={() => setConfirmingTask(task)} className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 disabled:opacity-50">释放任务</button></td></tr>)}</tbody></table></div>}
    {message && <p className="text-sm text-gray-600">{message}</p>}
    <ConfirmDialog open={Boolean(confirmingTask)} title="释放过期任务" description="任务将重新进入可领取队列，原标注员的领取记录仍会保留以保护双盲。" consequence={confirmingTask?.hasDraft ? '该任务含未提交草稿。释放后草稿会被永久清空。' : '当前没有未提交草稿，已提交记录不会受影响。'} confirmLabel="确认释放" danger={Boolean(confirmingTask?.hasDraft)} pending={Boolean(pendingId)} onClose={() => setConfirmingTask(null)} onConfirm={() => confirmingTask && release(confirmingTask)} />
  </section>;
}
