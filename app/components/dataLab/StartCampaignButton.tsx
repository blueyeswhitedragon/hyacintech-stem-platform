"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function StartCampaignButton({ id }: { id: string }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  async function start() { setPending(true); setError(null); try { const response = await fetch(`/api/data-lab/campaigns/${id}/start`, { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '启动失败'); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setPending(false); } }
  return <div className="flex items-center gap-2"><button type="button" onClick={start} disabled={pending} className="border border-gray-900 px-3 py-1 text-xs disabled:opacity-50">{pending ? '启动中…' : '启动'}</button>{error && <span className="text-xs text-red-600">{error}</span>}</div>;
}
