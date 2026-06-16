"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  studentAssignmentId: string;
  stage: 2 | 5;
}

export default function ReviewActionForm({ studentAssignmentId, stage }: Props) {
  const router = useRouter();
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const act = async (action: 'approve' | 'reject') => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/teacher/review/${studentAssignmentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          stage,
          score: stage === 5 && score !== '' ? Number(score) : undefined,
          feedback: feedback || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || '操作失败'); return; }
      router.push('/teacher/review');
      router.refresh();
    } catch {
      setErr('网络错误，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <h3 className="font-medium">审核操作</h3>
      {stage === 5 && (
        <div>
          <label className="block text-sm text-gray-700 mb-1">评分（0–10，可选）</label>
          <input
            type="number"
            min={0}
            max={10}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className="w-24 border rounded p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}
      <div>
        <label className="block text-sm text-gray-700 mb-1">评语 / 驳回理由</label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          className="w-full border rounded p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={stage === 2 ? '对实验方案的意见…' : '对报告的评价…'}
        />
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex gap-2">
        <button
          onClick={() => act('approve')}
          disabled={busy}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
        >
          通过
        </button>
        <button
          onClick={() => act('reject')}
          disabled={busy}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
        >
          驳回
        </button>
      </div>
    </div>
  );
}
