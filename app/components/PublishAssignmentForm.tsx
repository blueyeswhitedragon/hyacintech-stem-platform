"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

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
  const [allowDataContribution, setAllowDataContribution] = useState(false);
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
          allowDataContribution,
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
      setAllowDataContribution(false);
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
      <label className="flex items-start gap-2 rounded-lg border bg-gray-50 p-3 text-sm">
        <input
          type="checkbox"
          checked={allowDataContribution}
          onChange={(event) => setAllowDataContribution(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="font-medium text-gray-800">允许学生自愿授权脱敏对话用于模型改进</span>
          <span className="mt-1 block text-xs leading-5 text-gray-500">
            默认关闭。开启后学生可以同意、拒绝或撤回；拒绝不会影响作业完成。只有教师提名且管理员审核通过的脱敏片段才会进入候选池。
          </span>
        </span>
      </label>
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

      <button type="submit" disabled={loading || title.trim() === ''}
        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
        {loading ? '发布中…' : '发布作业'}
      </button>
    </form>
  );
}
