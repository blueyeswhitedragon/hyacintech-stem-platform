"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from './ui/Button';

export default function CreateClassForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '创建失败'); return; }
      setName('');
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 items-start">
      <input type="text" value={name} onChange={(e) => setName(e.target.value)}
        placeholder="新班级名称"
        className="border rounded-lg p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 min-w-0" />
      <Button type="submit" variant="primary" loading={loading} loadingText="创建中…" disabled={name.trim() === ''}>
        创建班级
      </Button>
      {error && <span className="text-sm text-red-600 self-center">{error}</span>}
    </form>
  );
}
