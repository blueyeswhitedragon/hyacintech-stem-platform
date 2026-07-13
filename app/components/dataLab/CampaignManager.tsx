"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PHASE_META, STYLE_FAMILIES, STYLE_LABELS } from '@/app/lib/dataLab/types';
import { STYLE_POLICIES } from '@/app/lib/stylePolicy';

interface AnnotatorOption {
  id: string;
  username: string;
  displayName: string;
}

export default function CampaignManager({ batches, annotators }: { batches: Array<{ id: string; name: string }>; annotators: AnnotatorOption[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function create(formData: FormData) {
    setPending(true); setMessage(null);
    try {
      const participantIds = formData.getAll('participants').map(String);
      if (participantIds.length === 0) throw new Error('请至少选择一名参与者');
      const qualityMode = String(formData.get('qualityMode') ?? 'double');
      const quality = qualityMode === 'single'
        ? { goldSlots: 1, silverDoubleReviewPercent: 0 }
        : qualityMode === 'mixed'
          ? { goldSlots: 2, silverDoubleReviewPercent: 30 }
          : { goldSlots: 2, silverDoubleReviewPercent: 100 };
      const styleQuota = Object.fromEntries(STYLE_FAMILIES.map((style) => [style, Number(formData.get(`style_${style}`) ?? 0)]));
      const payload = {
        name: String(formData.get('name') ?? ''),
        selection: {
          batchIds: formData.getAll('batchIds').map(String),
          phases: formData.getAll('phases').map(Number),
          candidateTiers: formData.getAll('tiers').map(String),
          limit: Number(formData.get('limit') || 0) || undefined,
        },
        participants: participantIds.map((userId) => ({
          userId,
          taskLimit: Math.max(0, Number(formData.get(`participant_limit_${userId}`) || 0)),
        })),
        styleQuota,
        ...quality,
        maxActivePerAnnotator: 1,
      };
      const response = await fetch('/api/data-lab/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '创建失败');
      setMessage('任务分配草稿已创建，请在下方确认后启动。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  return <form action={create} className="space-y-5 rounded-xl border bg-white p-4 shadow-sm md:p-5">
    <div><h2 className="font-semibold">创建任务分配</h2><p className="mt-1 text-sm text-gray-500">只需要确认数据、参与人员和审核强度；技术参数已放入高级选项。</p></div>
    <section className="grid gap-4 rounded-xl bg-gray-50 p-4 lg:grid-cols-[1fr_220px]"><label className="text-sm font-medium">1. 任务名称<input name="name" required className="mt-2 w-full rounded-lg border bg-white px-3 py-2.5 font-normal" placeholder="例如：七月第一批人工标注" /></label><label className="text-sm font-medium">最多处理多少条样本<input name="limit" type="number" min="0" defaultValue="0" className="mt-2 w-full rounded-lg border bg-white px-3 py-2.5 font-normal" /><span className="mt-1 block text-xs font-normal text-gray-500">填写 0 表示处理所选批次的全部样本。</span></label></section>

    <fieldset className="rounded-xl border p-4"><legend className="px-2 text-sm font-semibold">2. 选择数据</legend><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{batches.map((batch) => <label key={batch.id} className="flex items-center gap-3 rounded-lg border bg-white p-3 text-sm"><input name="batchIds" type="checkbox" value={batch.id} defaultChecked className="size-4" /><span>{batch.name}</span></label>)}</div></fieldset>

    <fieldset className="rounded-xl border p-4"><legend className="px-2 text-sm font-semibold">3. 选择参与人员</legend><p className="mb-3 text-xs text-gray-500">“最多领取”按任务条数限制；填写 0 表示不限制。参与者只能领取这里分配给自己的活动。</p>{annotators.length === 0 ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">当前没有标注员账号，请先在“后台账号”中创建。</p> : <div className="grid gap-2 lg:grid-cols-2">{annotators.map((annotator) => <div key={annotator.id} className="grid grid-cols-[1fr_120px] items-center gap-3 rounded-lg border p-3"><label className="flex min-w-0 items-center gap-3 text-sm"><input name="participants" type="checkbox" value={annotator.id} defaultChecked className="size-4" /><span className="min-w-0"><span className="block font-medium">{annotator.displayName}</span><span className="block truncate text-xs text-gray-500">{annotator.username}</span></span></label><label className="text-xs text-gray-500">最多领取<input name={`participant_limit_${annotator.id}`} type="number" min="0" defaultValue="0" className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm text-gray-900" /></label></div>)}</div>}</fieldset>

    <fieldset className="rounded-xl border p-4"><legend className="px-2 text-sm font-semibold">4. 选择审核强度</legend><div className="grid gap-2 lg:grid-cols-3"><label className="flex cursor-pointer gap-3 rounded-lg border p-3"><input name="qualityMode" type="radio" value="single" className="mt-1" /><span><span className="block text-sm font-medium">每条由 1 人标注</span><span className="mt-1 block text-xs leading-5 text-gray-500">速度最快，适合规则明确、风险较低的数据。</span></span></label><label className="flex cursor-pointer gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3"><input name="qualityMode" type="radio" value="double" defaultChecked className="mt-1" /><span><span className="block text-sm font-medium text-blue-900">每条由 2 人独立标注</span><span className="mt-1 block text-xs leading-5 text-blue-700">推荐。两人的有效工作量分别审核，之后再匿名仲裁版本。</span></span></label><label className="flex cursor-pointer gap-3 rounded-lg border p-3"><input name="qualityMode" type="radio" value="mixed" className="mt-1" /><span><span className="block text-sm font-medium">重点样本双标</span><span className="mt-1 block text-xs leading-5 text-gray-500">重点候选全部双标，其他样本约 30% 双标抽检。</span></span></label></div></fieldset>

    <details className="rounded-xl border bg-gray-50 p-4"><summary className="cursor-pointer text-sm font-medium">高级选项：阶段、候选等级和回复风格</summary><div className="mt-4 space-y-4"><fieldset><legend className="text-sm font-medium">实验阶段</legend><div className="mt-2 flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6].map((phase) => <label key={phase} className="rounded-lg border bg-white px-3 py-2 text-sm"><input name="phases" type="checkbox" value={phase} defaultChecked className="mr-2" />{phase}. {PHASE_META[phase].label}</label>)}</div></fieldset><fieldset><legend className="text-sm font-medium">候选等级</legend><div className="mt-2 flex flex-wrap gap-2"><label className="rounded-lg border bg-white px-3 py-2 text-sm"><input name="tiers" type="checkbox" value="gold_candidate" defaultChecked className="mr-2" />重点候选</label><label className="rounded-lg border bg-white px-3 py-2 text-sm"><input name="tiers" type="checkbox" value="silver" defaultChecked className="mr-2" />普通候选</label></div></fieldset><fieldset><legend className="text-sm font-medium">回复风格轮换权重（0 表示不使用）</legend><p className="mt-1 text-xs text-gray-500">权重按样本轮换；同一样本的两位独立标注者会执行同一种目标风格。</p><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{STYLE_FAMILIES.map((style) => <label key={style} title={STYLE_POLICIES[style].summary} className="text-xs text-gray-600">{STYLE_LABELS[style]}<span className="mt-0.5 block min-h-8 text-[11px] leading-4 text-gray-400">{STYLE_POLICIES[style].summary}</span><input name={`style_${style}`} type="number" min="0" defaultValue="1" className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-sm text-gray-900" /></label>)}</div></fieldset></div></details>

    <div className="flex flex-wrap items-center gap-3"><button disabled={pending || annotators.length === 0} className="rounded-lg bg-gray-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">创建任务分配</button>{message && <span aria-live="polite" className="text-sm text-gray-600">{message}</span>}</div>
  </form>;
}
