"use client";

import React, { useMemo, useState } from 'react';
import type {
  Stage2ExperimentPlan,
  Stage2PlanProvenance,
  Stage2Readiness,
  Stage2SectionId,
} from '../models/stageData';
import {
  STAGE2_CORE_FIELD_LABELS,
  STAGE2_SECTIONS,
} from '../lib/stage2Readiness';
import { buildDataTableSchema } from '../lib/stageArtifacts';

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

export default function Stage2PlanPreview({
  plan,
  draftHash,
  readiness,
  provenance,
  confirmed,
  onConfirm,
  confirmLabel = '确认当前方案',
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<Stage2SectionId | null>(null);
  const completedSections = new Set(readiness.completedSections ?? []);
  const activeSection = readiness.missingSections?.[0] ?? null;
  const schema = useMemo(() => plan ? buildDataTableSchema(plan) : null, [plan]);

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
        <h2 className="text-base font-semibold text-gray-900">{plan ? '实验方案预览' : '方案设计四环节'}</h2>
        <span className={`text-xs font-medium ${confirmed ? 'text-green-700' : readiness.complete ? 'text-amber-700' : 'text-gray-600'}`}>
          {confirmed
            ? '已确认并冻结'
            : readiness.complete
              ? '待确认'
              : `已完成 ${completedSections.size}/4 个环节`}
        </span>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2" aria-label="方案四环节状态">
        {STAGE2_SECTIONS.map((section, index) => {
          const done = completedSections.has(section.id);
          const active = section.id === activeSection;
          return (
            <div
              key={section.id}
              className={`rounded-lg border px-3 py-2 ${
                done
                  ? 'border-green-200 bg-green-50'
                  : active
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={`text-sm font-medium ${done ? 'text-green-900' : active ? 'text-amber-900' : 'text-gray-700'}`}>
                  {index + 1}. {section.title.replace(/^环节[一二三四]：/, '')}
                </p>
                <span className="text-xs">{done ? '已完成' : active ? '进行中' : '待开始'}</span>
              </div>
              <p className="mt-1 text-xs text-gray-600">{section.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {section.fields.map((field) => (
                  <span
                    key={field}
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      readiness.completedFields.includes(field)
                        ? 'bg-white text-green-800'
                        : 'bg-white/70 text-gray-500'
                    }`}
                  >
                    {STAGE2_CORE_FIELD_LABELS[field]}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {!plan && activeSection && (
        <p className="text-sm text-gray-700">
          当前进行：{STAGE2_SECTIONS.find((section) => section.id === activeSection)?.title}。
          本环节可以在一条消息中完整说明，平台会一次接收所有明确内容。
        </p>
      )}

      {plan && (
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium text-gray-900">环节一：明确变量设计</h3>
              {!confirmed && (
                <button type="button" onClick={() => setEditingSection('variable_design')} className="text-xs text-green-700 hover:underline">
                  修改本环节
                </button>
              )}
            </div>
            <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              <dt className="text-gray-500">研究问题</dt><dd>{plan.researchQuestion}</dd>
              <dt className="text-gray-500">唯一变量</dt><dd>{plan.independentVariable.name}</dd>
              <dt className="text-gray-500">变量水平</dt><dd><ListValue values={plan.independentVariable.levels} /></dd>
              <dt className="text-gray-500">观测指标</dt><dd>{plan.dependentVariable.name}</dd>
            </dl>
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium text-gray-900">环节二：思考数据记录</h3>
              {!confirmed && (
                <button type="button" onClick={() => setEditingSection('data_recording')} className="text-xs text-green-700 hover:underline">
                  修改本环节
                </button>
              )}
            </div>
            <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              <dt className="text-gray-500">测量工具</dt><dd>{plan.dataRecording?.tool || plan.dependentVariable.measurement}</dd>
              <dt className="text-gray-500">读数时间</dt><dd>{plan.dataRecording?.timing || '见测量方式（历史方案）'}</dd>
              <dt className="text-gray-500">记录数据</dt><dd><ListValue values={plan.dataRecording?.recordedFields ?? [plan.dependentVariable.name]} /></dd>
              <dt className="text-gray-500">完整方式</dt>
              <dd>{plan.dependentVariable.measurement}{plan.dependentVariable.unit ? `（${plan.dependentVariable.unit}）` : ''}</dd>
            </dl>
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium text-gray-900">环节三：规划实验过程</h3>
              {!confirmed && (
                <button type="button" onClick={() => setEditingSection('experiment_process')} className="text-xs text-green-700 hover:underline">
                  修改本环节
                </button>
              )}
            </div>
            <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              <dt className="text-gray-500">控制条件</dt><dd><ListValue values={plan.controlledVariables} /></dd>
              {plan.sampleSizePerLevel && <><dt className="text-gray-500">每组样本</dt><dd>{plan.sampleSizePerLevel} 个实验对象</dd></>}
              <dt className="text-gray-500">独立重复</dt><dd>每个水平 {plan.repeatCount} 轮</dd>
              <dt className="text-gray-500">材料</dt>
              <dd><ListValue values={plan.materials} emptyLabel="尚未说明" /><SourceLabel source={provenance?.materials?.source} /></dd>
              <dt className="text-gray-500">操作步骤</dt>
              <dd>
                <ol className="list-decimal space-y-1 pl-5">
                  {plan.procedure.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
                </ol>
              </dd>
              <dt className="text-gray-500">安全事项</dt>
              <dd><ListValue values={plan.safetyNotes} /><SourceLabel source={provenance?.safetyNotes?.source} /></dd>
            </dl>
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium text-gray-900">环节四：推测实验结果</h3>
              {!confirmed && (
                <button type="button" onClick={() => setEditingSection('expected_result')} className="text-xs text-green-700 hover:underline">
                  修改本环节
                </button>
              )}
            </div>
            <p className="text-gray-900">{plan.hypothesis}</p>
          </div>

          {schema && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              <h3 className="font-medium text-gray-900">原始数据记录表预览</h3>
              <p className="mt-1 text-xs text-gray-600">确认后将冻结以下列结构，至少记录 {schema.minRows} 行。</p>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {schema.columns.map((column) => (
                        <th key={column.key} className="whitespace-nowrap border border-blue-200 bg-white px-2 py-1.5 text-left font-medium text-gray-700">
                          {column.title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {editingSection && !confirmed && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          请在左侧对话中直接说明要更正的内容，例如“把读数时间改为第10天”。平台会生成新的方案预览，旧确认不会沿用。
          <button type="button" onClick={() => setEditingSection(null)} className="ml-2 text-xs underline">知道了</button>
        </div>
      )}

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
