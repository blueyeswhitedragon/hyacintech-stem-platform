"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select } from '@/app/components/ui/Field';

export default function BatchImportForm() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(formData: FormData) {
    setPending(true); setMessage(null);
    try {
      const response = await fetch('/api/data-lab/batches/import', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '导入失败');
      setMessage(`导入完成：${data.summary.records} 条`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setPending(false); }
  }
  return (
    <form action={submit} className="grid gap-3 border border-hairline bg-canvas p-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm">批次名称<Input name="name" required className="mt-1" placeholder="dataset-base-v1" /></label>
      <label className="text-sm">来源类型<Select name="sourceType" className="mt-1"><option value="sharegpt_clean">ShareGPT clean</option><option value="human_revision">人工修订</option><option value="external">外部数据</option></Select></label>
      <label className="text-sm">数据集 JSON<input name="dataset" type="file" accept="application/json,.json" required className="mt-1 block w-full text-sm" /></label>
      <label className="text-sm">Manifest（可选）<input name="manifest" type="file" accept="application/json,.json" className="mt-1 block w-full text-sm" /></label>
      <div className="flex items-center gap-3 md:col-span-2 xl:col-span-4">
        <button disabled={pending} className={buttonClass('primary', 'md')}>{pending ? '导入中…' : '导入批次'}</button>
        {message && <span className="text-sm text-muted">{message}</span>}
      </div>
    </form>
  );
}
