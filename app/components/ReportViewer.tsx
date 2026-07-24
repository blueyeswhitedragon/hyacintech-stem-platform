"use client";

import React, { useState } from 'react';
import type { Stage5Data, Stage2Column } from '@/app/models/stageData';
import ReportDocument from './ReportDocument';
import { limitationsDiscussion } from '@/app/lib/reportFields';

interface Props {
  stage5?: Stage5Data;
  /** 阶段2的表结构 */
  schemaColumns?: Stage2Column[];
  /** 阶段3的实验数据 */
  dataRows?: Record<string, unknown>[];
  onSave: (conclusion: string, limitationsDiscussion: string) => Promise<string | null>;
  /** 提交报告进入教师审核；为 undefined 时（如已提交待审）隐藏提交按钮。 */
  onSubmit?: () => Promise<string | null>;
  /** 导出报告为 docx（含数据表）。 */
  onExport?: () => Promise<string | null>;
  /** 上传学生自己的 docx 报告（轻量留存 + 文本提取）。 */
  onImport?: (file: File) => Promise<string | null>;
}

export default function ReportViewer({ stage5, schemaColumns, dataRows, onSave, onSubmit, onExport, onImport }: Props) {
  const sections = stage5?.sections;
  const [conclusion, setConclusion] = useState(sections?.conclusion ?? '');
  const [limitations, setLimitations] = useState(sections ? limitationsDiscussion(sections) : '');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true); setMsg(null); setErr(null);
    const e = await onSave(conclusion, limitations);
    setSaving(false);
    if (e) setErr(e); else setMsg('报告已保存');
  };

  const handleSubmit = async () => {
    if (!onSubmit) return;
    setSubmitting(true); setMsg(null); setErr(null);
    // 先保存再提交
    const se = await onSave(conclusion, limitations);
    if (se) { setSubmitting(false); setErr(se); return; }
    const e = await onSubmit();
    setSubmitting(false);
    if (e) setErr(e);
  };

  const handleExport = async () => {
    if (!onExport) return;
    setExporting(true); setMsg(null); setErr(null);
    const e = await onExport();
    setExporting(false);
    if (e) setErr(e);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!file || !onImport) return;
    setImporting(true); setMsg(null); setErr(null);
    const err2 = await onImport(file);
    setImporting(false);
    if (err2) setErr(err2); else setMsg('已上传你的报告');
  };

  if (!sections) {
    return (
      <div className="text-sm text-gray-500 p-4 flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin" />
        正在根据前序阶段自动生成报告框架，请稍候…
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-lg">📝 实验报告</h3>
        <div className="flex items-center gap-2">
          {onImport && (
            <label className="px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 cursor-pointer">
              {importing ? '上传中…' : '上传我的 Word 报告'}
              <input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                disabled={importing}
                onChange={handleImport}
              />
            </label>
          )}
          {onExport && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {exporting ? '导出中…' : '导出为 Word'}
            </button>
          )}
        </div>
      </div>

      {/* 只读报告主体（六节 + 数据表 + 上传报告），结论/局限讨论在下方编辑 */}
      <ReportDocument
        stage5={stage5}
        schemaColumns={schemaColumns}
        dataRows={dataRows}
        showStudentFields={false}
      />

      {/* 简单图表提示（阶段4的分析在数据概述中体现） */}
      {dataRows && dataRows.length > 0 && (
        <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded p-2">
          💡 图表分析请在「数据分析」阶段查看右侧 ChartViewer 面板。此处展示原始数据表供报告参考。
        </div>
      )}

      {/* 学生填写结论与局限讨论 */}
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
        <div className="text-sm font-medium text-blue-700 mb-1">局限与讨论（请你填写）</div>
        <textarea
          value={limitations}
          onChange={(e) => setLimitations(e.target.value)}
          rows={4}
          className="w-full border rounded p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="说明实验局限、可能的误差来源，以及下一次可怎样改进。"
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
