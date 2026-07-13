'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface TraceOption {
  assistantMessageId: string;
  stage: number;
  dialogue: string;
  candidateStatus: string | null;
}

export default function CandidateNominationPanel({
  studentAssignmentId,
  traces,
  consentStatus,
}: {
  studentAssignmentId: string;
  traces: TraceOption[];
  consentStatus: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function nominate(assistantMessageId: string) {
    setPendingId(assistantMessageId);
    setMessage(null);
    try {
      const response = await fetch(`/api/teacher/review/${studentAssignmentId}/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantMessageId, triggerType: 'TEACHER_NOMINATION', triggerNote: note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '提名失败');
      setMessage('已生成脱敏候选，等待管理员审核。');
      setNote('');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="font-medium">提名模型改进候选</h2>
      <p className="mt-1 text-xs text-gray-500">只能提名已有不可变生成轨迹的导师回复；提名不是直接加入训练。</p>
      {consentStatus !== 'GRANTED' ? (
        <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-800">学生未授权或已经撤回，当前不能提名。</p>
      ) : (
        <>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="问题说明（可选，例如：导师替学生下结论）" className="mt-3 min-h-16 w-full rounded border p-2 text-sm" />
          <div className="mt-3 space-y-2">
            {traces.map((trace) => (
              <div key={trace.assistantMessageId} className="rounded border p-3 text-sm">
                <div className="mb-1 text-xs text-gray-500">阶段 {trace.stage}</div>
                <p className="line-clamp-3 whitespace-pre-wrap">{trace.dialogue}</p>
                <div className="mt-2">
                  {trace.candidateStatus ? (
                    <span className="text-xs text-blue-700">候选状态：{trace.candidateStatus}</span>
                  ) : (
                    <button disabled={pendingId !== null} onClick={() => nominate(trace.assistantMessageId)} className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white">{pendingId === trace.assistantMessageId ? '处理中…' : '提名这一条'}</button>
                  )}
                </div>
              </div>
            ))}
            {traces.length === 0 && <p className="text-sm text-gray-500">暂无可追踪的导师回复。</p>}
          </div>
        </>
      )}
      {message && <p className="mt-2 text-sm text-gray-600">{message}</p>}
    </section>
  );
}
