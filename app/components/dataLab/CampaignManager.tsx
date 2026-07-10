"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { STYLE_FAMILIES, STYLE_LABELS } from '@/app/lib/dataLab/types';

export default function CampaignManager({ batches }: { batches: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function create(formData: FormData) {
    setPending(true); setMessage(null);
    const phases = formData.getAll('phases').map(Number);
    const candidateTiers = formData.getAll('tiers').map(String);
    const styleQuota = Object.fromEntries(STYLE_FAMILIES.map((style) => [style, Number(formData.get(`style_${style}`) ?? 0)]));
    const payload = {
      name: String(formData.get('name') ?? ''),
      selection: {
        batchIds: formData.getAll('batchIds').map(String),
        phases,
        candidateTiers,
        limit: Number(formData.get('limit') || 0) || undefined,
      },
      styleQuota,
      goldSlots: Number(formData.get('goldSlots') ?? 2),
      silverDoubleReviewPercent: Number(formData.get('silverDoubleReviewPercent') ?? 30),
      maxActivePerAnnotator: 1,
    };
    try {
      const response = await fetch('/api/data-lab/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '创建失败');
      setMessage('活动草稿已创建'); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }
  return <form action={create} className="space-y-4 border bg-white p-4">
    <div className="grid gap-3 md:grid-cols-4"><label className="text-sm">活动名称<input name="name" required className="mt-1 w-full border px-3 py-2" placeholder="dataset-base-v1-human-review" /></label><label className="text-sm">Gold独立标注数<input name="goldSlots" type="number" min="1" max="3" defaultValue="2" className="mt-1 w-full border px-3 py-2" /></label><label className="text-sm">Silver双审比例<input name="silverDoubleReviewPercent" type="number" min="0" max="100" defaultValue="30" className="mt-1 w-full border px-3 py-2" /></label><label className="text-sm">样本上限（0=全部）<input name="limit" type="number" min="0" defaultValue="0" className="mt-1 w-full border px-3 py-2" /></label></div>
    <fieldset><legend className="text-sm font-medium">数据批次</legend><div className="mt-2 flex flex-wrap gap-3">{batches.map((batch) => <label key={batch.id} className="text-sm"><input name="batchIds" type="checkbox" value={batch.id} defaultChecked className="mr-1" />{batch.name}</label>)}</div></fieldset>
    <fieldset><legend className="text-sm font-medium">阶段</legend><div className="mt-2 flex flex-wrap gap-3">{[1,2,3,4,5,6].map((phase) => <label key={phase} className="text-sm"><input name="phases" type="checkbox" value={phase} defaultChecked className="mr-1" />P{phase}</label>)}</div></fieldset>
    <fieldset><legend className="text-sm font-medium">候选等级</legend><div className="mt-2 flex gap-4"><label className="text-sm"><input name="tiers" type="checkbox" value="gold_candidate" defaultChecked className="mr-1" />Gold candidate</label><label className="text-sm"><input name="tiers" type="checkbox" value="silver" defaultChecked className="mr-1" />Silver</label></div></fieldset>
    <fieldset><legend className="text-sm font-medium">风格配额权重（0=禁用）</legend><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{STYLE_FAMILIES.map((style) => <label key={style} className="text-sm">{STYLE_LABELS[style]}<input name={`style_${style}`} type="number" min="0" defaultValue="1" className="mt-1 w-full border px-2 py-1.5" /></label>)}</div></fieldset>
    <div className="flex items-center gap-3"><button disabled={pending} className="bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-50">创建活动</button>{message && <span className="text-sm text-gray-600">{message}</span>}</div>
  </form>;
}
