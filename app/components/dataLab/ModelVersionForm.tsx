'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select } from '@/app/components/ui/Field';

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
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');

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
          artifactKind: String(formData.get('artifactKind') ?? 'BASE'),
          modelFamily: String(formData.get('modelFamily') ?? ''),
          checkpointId: String(formData.get('checkpointId') ?? ''),
          weightsSha256: String(formData.get('weightsSha256') ?? ''),
          parameterScale: String(formData.get('parameterScale') ?? ''),
          architecture: String(formData.get('architecture') ?? ''),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '登记失败');
      setMessageTone('success');
      setMessage('模型版本已登记');
      router.refresh();
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={submit} className="grid gap-3 border border-hairline bg-canvas p-4 md:grid-cols-3">
      <p className="border border-info/40 bg-info/8 p-3 text-xs leading-5 text-body-strong md:col-span-3"><b>模型身份与调用地址分开登记。</b>这里的“来源/兼容协议”和“外部模型 ID”用于不可变身份、训练与评测血缘；实际请求地址、密钥和远程模型名由“AI 服务”中的 Endpoint 决定。</p>
      <label className="text-sm">
        稳定模型标签
        <Input name="tag" required placeholder="qwen-stem-sft-v1" className="mt-1" />
      </label>
      <label className="text-sm">
        来源/兼容协议
        <Input name="provider" required placeholder="deepseek / openai / local" className="mt-1" />
      </label>
      <label className="text-sm">
        外部模型 ID（兼容快照）
        <Input name="externalModelId" required placeholder="Qwen3.5-35B-A3B" className="mt-1" />
      </label>
      <label className="text-sm">产物类型<Select name="artifactKind" className="mt-1"><option value="BASE">基础模型</option><option value="FINE_TUNED">训练产物</option><option value="EXTERNAL">外部产物</option></Select></label>
      <label className="text-sm">模型家族<Input name="modelFamily" placeholder="qwen" className="mt-1" /></label>
      <label className="text-sm">参数规模<Input name="parameterScale" placeholder="35B-A3B" className="mt-1" /></label>
      <label className="text-sm">架构<Input name="architecture" placeholder="MoE / Dense" className="mt-1" /></label>
      <label className="text-sm">Checkpoint ID<Input name="checkpointId" placeholder="组织/仓库@revision" className="mt-1" /></label>
      <label className="text-sm md:col-span-2">权重 SHA-256（可选）<Input name="weightsSha256" placeholder="64 位十六进制；不知道时留空并标记待核验" className="mt-1 font-mono" /></label>
      <label className="text-sm">
        父模型版本
        <Select name="parentModelVersionId" className="mt-1">
          <option value="">无 / 外部基线</option>
          {parents.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-sm">
        来源训练登记
        <Select name="trainingRunId" className="mt-1">
          <option value="">无 / 非本平台训练</option>
          {trainingRuns.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-sm">
        当前状态
        <Select name="status" className="mt-1">
          <option value="DRAFT">草稿</option>
          <option value="TRAINED">已训练</option>
          <option value="BLOCKED">已阻断</option>
        </Select>
      </label>
      <div className="flex items-center gap-3 md:col-span-3">
        <button disabled={pending} className={buttonClass('primary', 'md')}>
          {pending ? '登记中…' : '登记模型版本'}
        </button>
        {message && <span className={`text-sm ${messageTone === 'success' ? 'text-[#2f7a43]' : 'text-error'}`}>{message}</span>}
      </div>
    </form>
  );
}
