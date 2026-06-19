"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function JoinClassForm() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/classes/_/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加入失败');
        return;
      }
      setInviteCode('');
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 items-start">
      <input
        type="text"
        value={inviteCode}
        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
        placeholder="输入班级邀请码"
        className="border rounded-lg p-2 text-gray-900 tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 min-w-0"
        maxLength={6}
      />
      <button type="submit" disabled={loading || inviteCode.trim() === ''}
        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
        {loading ? '加入中…' : '加入班级'}
      </button>
      {error && <span className="text-sm text-red-600 self-center">{error}</span>}
    </form>
  );
}
