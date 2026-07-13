'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Option {
  id: string;
  label: string;
}

export default function ModelVersionForm({
  parents,
  trainingRuns,
}: {
  parents: Option[];
  trainingRuns: Option[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/data-lab/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: String(formData.get('tag') ?? ''),
          provider: String(formData.get('provider') ?? ''),
          externalModelId: String(formData.get('externalModelId') ?? ''),
          parentModelVersionId: String(formData.get('parentModelVersionId') ?? ''),
          trainingRunId: String(formData.get('trainingRunId') ?? ''),
          status: String(formData.get('status') ?? 'DRAFT'),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '登记失败');
      setMessage('模型版本已登记');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={submit} className="grid gap-3 border bg-white p-4 md:grid-cols-3">
      <label className="text-sm">
        稳定模型标签
        <input
          name="tag"
          required
          placeholder="qwen-stem-sft-v1"
          className="mt-1 w-full border px-3 py-2"
        />
      </label>
      <label className="text-sm">
        服务商
        <input
          name="provider"
          required
          placeholder="deepseek / openai / local"
          className="mt-1 w-full border px-3 py-2"
        />
      </label>
      <label className="text-sm">
        外部模型 ID
        <input
          name="externalModelId"
          required
          placeholder="Qwen3.5-35B-A3B"
          className="mt-1 w-full border px-3 py-2"
        />
      </label>
      <label className="text-sm">
        父模型版本
        <select name="parentModelVersionId" className="mt-1 w-full border px-3 py-2">
          <option value="">无 / 外部基线</option>
          {parents.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        来源训练登记
        <select name="trainingRunId" className="mt-1 w-full border px-3 py-2">
          <option value="">无 / 非本平台训练</option>
          {trainingRuns.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        当前状态
        <select name="status" className="mt-1 w-full border px-3 py-2">
          <option value="DRAFT">草稿</option>
          <option value="TRAINED">已训练</option>
          <option value="BLOCKED">已阻断</option>
        </select>
      </label>
      <div className="flex items-center gap-3 md:col-span-3">
        <button disabled={pending} className="bg-gray-950 px-4 py-2 text-sm text-white">
          {pending ? '登记中…' : '登记模型版本'}
        </button>
        {message && <span className="text-sm text-gray-600">{message}</span>}
      </div>
    </form>
  );
}
