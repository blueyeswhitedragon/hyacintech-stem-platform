'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function EvaluationImportForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/data-lab/evaluations/import', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '导入失败');
      setFeedback({ tone: 'success', text: '评测产物已导入并完成格式核验。' });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  }

  return <form action={submit} className="grid gap-3 border bg-white p-4 md:grid-cols-[1fr_2fr_auto]">
    <label className="text-sm">评测名称<input name="name" required placeholder="qwen-v1-vs-dsv4-smoke" className="mt-1 w-full border px-3 py-2" /></label>
    <label className="text-sm">评测产物 JSON 文件<input name="artifacts" type="file" accept="application/json,.json" multiple required className="mt-2 block w-full text-sm" /><span className="mt-1 block text-xs text-gray-500">选择基线对话、候选对话和裁决结果三个文件。</span></label>
    <div className="flex items-end"><button disabled={pending} className="bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">{pending ? '导入中…' : '导入评测'}</button></div>
    {feedback && <span className={`border p-3 text-sm md:col-span-3 ${feedback.tone === 'success' ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>{feedback.text}</span>}
  </form>;
}
