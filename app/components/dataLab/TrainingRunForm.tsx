'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DATA_LAB_STATUS_LABELS } from '@/app/lib/dataLab/labels';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select, Textarea } from '@/app/components/ui/Field';

const TRAINING_RUN_STATUSES = ['DRAFT', 'SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;

export default function TrainingRunForm({
  releases,
  models,
}: {
  releases: Array<{ id: string; version: string }>;
  models: Array<{ id: string; tag: string }>;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [pending, setPending] = useState(false);

  async function create(formData: FormData) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/data-lab/training-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(formData.get('name')),
          releaseId: String(formData.get('releaseId')),
          baseModel: String(formData.get('baseModel')),
          parentModelVersionId: String(formData.get('parentModelVersionId') || ''),
          externalTaskId: String(formData.get('externalTaskId') || ''),
          parameters: JSON.parse(String(formData.get('parameters') || '{}')),
          status: String(formData.get('status')),
          modelTag: String(formData.get('modelTag') || ''),
          notes: String(formData.get('notes') || ''),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '登记失败');
      setMessageTone('success');
      setMessage('训练任务已登记并保存资格报告');
      router.refresh();
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  return <form action={create} className="grid gap-3 border border-hairline bg-canvas p-4 md:grid-cols-3">
    <label className="text-sm">任务名称<Input name="name" required className="mt-1" /></label>
    <label className="text-sm">数据版本<Select name="releaseId" required className="mt-1"><option value="">请选择</option>{releases.map((release) => <option key={release.id} value={release.id}>{release.version}</option>)}</Select></label>
    <label className="text-sm">父模型版本<Select name="parentModelVersionId" className="mt-1"><option value="">仅草稿可暂不选择</option>{models.map((model) => <option key={model.id} value={model.id}>{model.tag}</option>)}</Select></label>
    <label className="text-sm">基础模型显示名<Input name="baseModel" required placeholder="Qwen3.5-35B-A3B" className="mt-1" /></label>
    <label className="text-sm">主办方任务 ID<Input name="externalTaskId" className="mt-1" /></label>
    <label className="text-sm">输出模型标签<Input name="modelTag" className="mt-1" /></label>
    <label className="text-sm">外部训练状态<Select name="status" className="mt-1">{TRAINING_RUN_STATUSES.map((status) => <option key={status} value={status}>{DATA_LAB_STATUS_LABELS[status]}</option>)}</Select></label>
    <label className="text-sm md:col-span-2">训练参数 JSON<Textarea name="parameters" defaultValue={'{"epochs":3,"learningRate":0.00002,"batchSize":4,"gradientAccumulationSteps":8}'} className="mt-1 min-h-20 font-mono" /><span className="mt-1 block text-xs text-muted">按外部训练平台的实际参数记录；字段不会由本平台执行。</span></label>
    <label className="text-sm">备注<Textarea name="notes" className="mt-1 min-h-20" /></label>
    <div className="flex items-center gap-3 md:col-span-3"><button disabled={pending} className={buttonClass('primary', 'md')}>登记并检查资格</button>{message && <span className={`text-sm ${messageTone === 'success' ? 'text-[#2f7a43]' : 'text-error'}`}>{message}</span>}</div>
  </form>;
}
