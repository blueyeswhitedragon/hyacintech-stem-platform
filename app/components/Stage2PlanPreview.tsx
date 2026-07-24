"use client";

import React, { useState } from 'react';
import type { Stage2ExperimentPlan, Stage2PlanProvenance, Stage2Readiness } from '../models/stageData';
import { STAGE2_CORE_FIELD_LABELS } from '../lib/stage2Readiness';

interface Props {
  plan?: Stage2ExperimentPlan;
  draftHash?: string;
  readiness: Stage2Readiness;
  provenance?: Stage2PlanProvenance;
  confirmed: boolean;
  onConfirm?: (draftHash: string) => Promise<string | null>;
  confirmLabel?: string;
}

function ListValue({ values, emptyLabel = '无（已确认）' }: { values: string[]; emptyLabel?: string }) {
  return <span>{values.length ? values.join('、') : emptyLabel}</span>;
}

function SourceLabel({ source }: { source?: 'student_fact' | 'server_composed' | 'server_baseline' }) {
  if (!source) return null;
  const label = source === 'student_fact' ? '学生提供' : source === 'server_baseline' ? '安全基线' : '系统组装';
  return <span className="ml-2 text-xs font-normal text-gray-500">{label}</span>;
}

export default function Stage2PlanPreview({ plan, draftHash, readiness, provenance, confirmed, onConfirm, confirmLabel = '确认当前方案' }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!onConfirm || !draftHash || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onConfirm(draftHash);
      if (result) setError(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-gray-200 bg-white px-4 py-4" aria-label="实验方案预览">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">{plan ? '实验方案预览' : '方案完成度'}</h2>
        <span className={`text-xs font-medium ${confirmed ? 'text-green-700' : readiness.complete ? 'text-amber-700' : 'text-gray-600'}`}>
          {confirmed ? '已确认并冻结' : readiness.complete ? '待确认' : `已完成 ${readiness.completedFields.length}/7`}
        </span>
      </div>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="方案核心字段状态">
        {readiness.completedFields.map((field) => (
          <span key={field} className="rounded border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-800">
            {STAGE2_CORE_FIELD_LABELS[field]} 已完成
          </span>
        ))}
        {readiness.missingFields.map((field, index) => (
          <span key={field} className={`rounded border px-2 py-1 text-xs ${index === 0 ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
            {STAGE2_CORE_FIELD_LABELS[field]} 待补充
          </span>
        ))}
      </div>
      {!plan && (
        <p className="text-sm text-gray-700">
          当前请先补充：{STAGE2_CORE_FIELD_LABELS[readiness.missingFields[0] ?? 'hypothesis']}。
        </p>
      )}
      {plan && <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-gray-500">研究问题</dt><dd className="text-gray-900">{plan.researchQuestion}</dd>
        <dt className="text-gray-500">假设</dt><dd className="text-gray-900">{plan.hypothesis}</dd>
        <dt className="text-gray-500">自变量</dt><dd className="text-gray-900">{plan.independentVariable.name}</dd>
        <dt className="text-gray-500">水平</dt><dd className="text-gray-900"><ListValue values={plan.independentVariable.levels} /></dd>
        <dt className="text-gray-500">因变量</dt><dd className="text-gray-900">{plan.dependentVariable.name}</dd>
        <dt className="text-gray-500">测量方式</dt><dd className="text-gray-900">{plan.dependentVariable.measurement}{plan.dependentVariable.unit ? `（${plan.dependentVariable.unit}）` : ''}</dd>
        <dt className="text-gray-500">控制条件</dt><dd className="text-gray-900"><ListValue values={plan.controlledVariables} /></dd>
        <dt className="text-gray-500">材料</dt><dd className="text-gray-900"><ListValue values={plan.materials} emptyLabel="尚未说明" /><SourceLabel source={provenance?.materials?.source} /></dd>
        <dt className="text-gray-500">重复次数</dt><dd className="text-gray-900">每个水平 {plan.repeatCount} 次</dd>
        <dt className="text-gray-500">安全事项</dt><dd className="text-gray-900"><ListValue values={plan.safetyNotes} /><SourceLabel source={provenance?.safetyNotes?.source} /></dd>
        <dt className="text-gray-500">步骤</dt>
        <dd className="text-gray-900">
          <SourceLabel source={provenance?.procedure?.source} />
          <ol className="list-decimal space-y-1 pl-5">
            {plan.procedure.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
          </ol>
        </dd>
      </dl>}
      {plan && !confirmed && onConfirm && draftHash && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? '正在确认…' : confirmLabel}
          </button>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </section>
  );
}
