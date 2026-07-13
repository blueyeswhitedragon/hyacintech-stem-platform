'use client';

import { useState } from 'react';

export default function DataConsentCard({
  studentAssignmentId,
  initialStatus,
}: {
  studentAssignmentId: string;
  initialStatus: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function decide(decision: 'GRANT' | 'DECLINE' | 'WITHDRAW') {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/student/assignments/${studentAssignmentId}/data-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '操作失败');
      setStatus(data.status);
      setMessage(decision === 'GRANT' ? '已授权；你仍可随时撤回。' : decision === 'DECLINE' ? '已拒绝；不影响完成作业。' : '授权已撤回，未进入训练的数据将停止使用。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
      <div className="font-medium">自愿参与模型改进（不影响作业成绩）</div>
      <p className="mt-1 text-xs leading-5 text-blue-800">
        只有教师提名的导师回复片段会在本机删除姓名、账号、班级、联系方式、链接和附件后交给管理员审核。拒绝或撤回不会影响学习；已完成训练的模型参数无法直接撤销。
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {status !== 'GRANTED' && (
          <button disabled={pending} onClick={() => decide('GRANT')} className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white">同意参与</button>
        )}
        {status === 'PENDING' && (
          <button disabled={pending} onClick={() => decide('DECLINE')} className="rounded border border-blue-300 bg-white px-3 py-1.5 text-xs">拒绝</button>
        )}
        {status === 'GRANTED' && (
          <button disabled={pending} onClick={() => decide('WITHDRAW')} className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700">撤回授权</button>
        )}
        <span className="text-xs">当前：{status === 'GRANTED' ? '已授权' : status === 'DECLINED' ? '已拒绝' : status === 'WITHDRAWN' ? '已撤回' : '待选择'}</span>
      </div>
      {message && <p className="mt-2 text-xs">{message}</p>}
    </div>
  );
}
