"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from './ui/Button';
import { Input } from './ui/Field';

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
    <form onSubmit={handleSubmit} className="flex flex-col items-start gap-2 sm:flex-row">
      <Input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="新班级名称"
        className="min-w-0 flex-1"
      />
      <Button type="submit" variant="primary" disabled={loading || name.trim() === ''}>
        {loading ? '创建中…' : '创建班级'}
      </Button>
      {error && <span className="self-center text-sm text-error">{error}</span>}
    </form>
  );
}
