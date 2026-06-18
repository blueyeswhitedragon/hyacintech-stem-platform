"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from './ui/Button';

interface ClassOption {
  id: string;
  name: string;
}

export default function PublishAssignmentForm({ classes }: { classes: ClassOption[] }) {
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [topicDirection, setTopicDirection] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          title,
          topicDirection: topicDirection || undefined,
          dueDate: dueDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '发布失败');
        return;
      }
      setTitle('');
      setTopicDirection('');
      setDueDate('');
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (classes.length === 0) {
    return <p className="text-sm text-gray-500">请先创建班级，才能发布作业。</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 max-w-lg">
      <div>
        <label className="block text-sm text-gray-700 mb-1">班级</label>
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          className="w-full border rounded-lg p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">作业标题</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border rounded-lg p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">研究方向（可选，限定阶段1选题）</label>
        <input
          type="text"
          value={topicDirection}
          onChange={(e) => setTopicDirection(e.target.value)}
          className="w-full border rounded-lg p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">截止日期（可选）</label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-full border rounded-lg p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <Button type="submit" variant="primary" loading={loading} loadingText="发布中…" disabled={title.trim() === ''}>
        发布作业
      </Button>
    </form>
  );
}
