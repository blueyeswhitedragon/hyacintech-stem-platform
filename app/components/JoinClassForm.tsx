"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from './ui/Button';
import { Input } from './ui/Field';

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
    <form onSubmit={handleSubmit} className="flex flex-col items-start gap-2 sm:flex-row">
      <Input
        type="text"
        value={inviteCode}
        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
        placeholder="输入班级邀请码"
        className="min-w-0 flex-1 font-lineage uppercase tracking-[0.2em]"
        maxLength={6}
      />
      <Button type="submit" variant="primary" disabled={loading || inviteCode.trim() === ''}>
        {loading ? '加入中…' : '加入班级'}
      </Button>
      {error && <span className="self-center text-sm text-error">{error}</span>}
    </form>
  );
}
