"use client";

import React, { useState } from 'react';
import type { Stage5Data } from '@/app/models/stageData';

interface Props {
  stage5?: Stage5Data;
  onSave: (conclusion: string, reflection: string) => Promise<string | null>;
  /** 提交报告进入教师审核；为 undefined 时（如已提交待审）隐藏提交按钮。 */
  onSubmit?: () => Promise<string | null>;
}

const AI_FIELDS: { key: keyof Stage5Data['sections']; label: string }[] = [
  { key: 'purpose', label: '研究目的' },
  { key: 'hypothesis', label: '假设' },
  { key: 'materials', label: '实验材料' },
  { key: 'procedure', label: '实验步骤' },
  { key: 'dataSummary', label: '数据概述' },
  { key: 'analysis', label: '数据分析' },
];

export default function ReportViewer({ stage5, onSave, onSubmit }: Props) {
  const sections = stage5?.sections;
  const [conclusion, setConclusion] = useState(sections?.conclusion ?? '');
  const [reflection, setReflection] = useState(sections?.reflection ?? '');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!onSubmit) return;
    setSubmitting(true); setMsg(null); setErr(null);
    // 先保存再提交
    const se = await onSave(conclusion, reflection);
    if (se) { setSubmitting(false); setErr(se); return; }
    const e = await onSubmit();
    setSubmitting(false);
    if (e) setErr(e);
  };

  if (!sections) {
    return (
      <div className="text-sm text-gray-500 p-4">
        还没有报告框架。请在对话中请 AI「生成报告框架」，它会根据前面阶段的内容预填报告各节。
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true); setMsg(null); setErr(null);
    const e = await onSave(conclusion, reflection);
    setSaving(false);
    if (e) setErr(e); else setMsg('报告已保存');
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-medium">实验报告</h3>

      {AI_FIELDS.map(({ key, label }) => (
        <div key={key}>
          <div className="text-sm font-medium text-gray-600 mb-1">{label}</div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded p-2">
            {sections[key] || <span className="text-gray-400">（AI 未预填）</span>}
          </div>
        </div>
      ))}

      <div>
        <div className="text-sm font-medium text-blue-700 mb-1">结论（请你填写）</div>
        <textarea
          value={conclusion}
          onChange={(e) => setConclusion(e.target.value)}
          rows={4}
          className="w-full border rounded p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="根据数据分析，回答你的研究问题……"
        />
      </div>
      <div>
        <div className="text-sm font-medium text-blue-700 mb-1">反思（请你填写）</div>
        <textarea
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          rows={4}
          className="w-full border rounded p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="这次探究有哪些不足？如果重来你会怎样改进？"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || submitting}
          className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存报告'}
        </button>
        {onSubmit && (
          <button
            onClick={handleSubmit}
            disabled={saving || submitting}
            className="px-4 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
          >
            {submitting ? '提交中…' : '提交报告，等待教师审核'}
          </button>
        )}
        {msg && <span className="text-sm text-green-600">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}
