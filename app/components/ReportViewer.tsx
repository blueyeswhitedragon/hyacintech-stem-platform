"use client";

import React, { useState } from 'react';
import type { Stage5Data, Stage2Column } from '@/app/models/stageData';

interface Props {
  stage5?: Stage5Data;
  /** 阶段2的表结构 */
  schemaColumns?: Stage2Column[];
  /** 阶段3的实验数据 */
  dataRows?: Record<string, unknown>[];
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

export default function ReportViewer({ stage5, schemaColumns, dataRows, onSave, onSubmit }: Props) {
  const sections = stage5?.sections;
  const [conclusion, setConclusion] = useState(sections?.conclusion ?? '');
  const [reflection, setReflection] = useState(sections?.reflection ?? '');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true); setMsg(null); setErr(null);
    const e = await onSave(conclusion, reflection);
    setSaving(false);
    if (e) setErr(e); else setMsg('报告已保存');
  };

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
        还没有报告框架。请等待 AI 自动生成报告框架。
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-medium text-lg">📝 实验报告</h3>

      {/* AI 预填的报告各节 */}
      {AI_FIELDS.map(({ key, label }) => (
        <div key={key}>
          <div className="text-sm font-medium text-gray-600 mb-1">{label}</div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded p-2">
            {sections[key] || <span className="text-gray-400">（AI 未预填）</span>}
          </div>
        </div>
      ))}

      {/* 嵌入的实验数据表 */}
      {dataRows && dataRows.length > 0 && schemaColumns && schemaColumns.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-600 mb-1">📊 实验数据记录</div>
          <div className="overflow-x-auto border rounded">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="p-1.5 border text-center w-8">#</th>
                  {schemaColumns.map((c) => (
                    <th key={c.key} className="p-1.5 border text-left whitespace-nowrap">
                      {c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="p-1.5 border text-center text-gray-400">{i + 1}</td>
                    {schemaColumns.map((c) => (
                      <td key={c.key} className="p-1.5 border text-gray-800">
                        {c.type === 'image' && row[c.key] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={String(row[c.key])} alt="" className="h-8 w-8 object-cover rounded" />
                        ) : (
                          String(row[c.key] ?? '—')
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 简单图表提示（阶段4的分析在数据概述中体现） */}
      {dataRows && dataRows.length > 0 && (
        <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded p-2">
          💡 图表分析请在「数据分析」阶段查看右侧 ChartViewer 面板。此处展示原始数据表供报告参考。
        </div>
      )}

      {/* 学生填写结论与反思 */}
      <div>
        <div className="text-sm font-medium text-blue-700 mb-1">✏️ 结论（请你填写）</div>
        <textarea
          value={conclusion}
          onChange={(e) => setConclusion(e.target.value)}
          rows={4}
          className="w-full border rounded p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="根据数据分析，回答你的研究问题……"
        />
      </div>
      <div>
        <div className="text-sm font-medium text-blue-700 mb-1">✏️ 反思（请你填写）</div>
        <textarea
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          rows={4}
          className="w-full border rounded p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="这次探究有哪些不足？如果重来你会怎样改进？"
        />
      </div>

      {/* 教师评分展示 */}
      {stage5?.aiReferenceScore && (
        <div className="bg-purple-50 border border-purple-200 rounded p-3 text-sm">
          <div className="font-medium text-purple-800 mb-1">🤖 AI 参考评分</div>
          <div className="text-purple-700">
            综合评分：{stage5.aiReferenceScore.overall}/10
            {stage5.aiReferenceScore.highlights?.length > 0 && (
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                {stage5.aiReferenceScore.highlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}
      {stage5?.teacherScore !== undefined && (
        <div className={`border rounded p-3 text-sm ${stage5.teacherScore >= 6 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className={`font-medium mb-1 ${stage5.teacherScore >= 6 ? 'text-green-800' : 'text-red-800'}`}>
            👨‍🏫 教师评分：{stage5.teacherScore}/10
            {stage5.teacherScore < 6 && <span className="ml-2 text-red-600 font-bold">—— 需重新修改并提交</span>}
          </div>
          {stage5.teacherFeedback && (
            <div className="whitespace-pre-wrap text-gray-700 mt-1">{stage5.teacherFeedback}</div>
          )}
        </div>
      )}

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
