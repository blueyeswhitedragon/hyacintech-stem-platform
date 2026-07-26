"use client";

import React, { useState } from 'react';
import type { Stage5Data, Stage2Column } from '@/app/models/stageData';
import ReportDocument from './ReportDocument';
import { limitationsDiscussion } from '@/app/lib/reportFields';
import { REPORT_IMPORT_FIELDS } from '@/app/lib/reportDocxImport';
import Button, { buttonClass } from './ui/Button';
import Callout from './ui/Callout';
import Card from './ui/Card';
import { Field, Textarea } from './ui/Field';

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
  /** 确认服务器识别出的章节映射并写入权威报告字段。 */
  onConfirmImport?: (previewHash: string) => Promise<string | null>;
  submitLabel?: string;
}

export default function ReportViewer({
  stage5,
  schemaColumns,
  dataRows,
  onSave,
  onSubmit,
  onExport,
  onImport,
  onConfirmImport,
  submitLabel = '提交报告，等待教师审核',
}: Props) {
  const sections = stage5?.sections;
  const [conclusion, setConclusion] = useState(sections?.conclusion ?? '');
  const [limitations, setLimitations] = useState(sections ? limitationsDiscussion(sections) : '');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);
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
    if (err2) setErr(err2); else setMsg('已识别 Word 章节，请核对下方导入预览');
  };

  const handleConfirmImport = async () => {
    const preview = stage5?.importPreview;
    if (!preview || !onConfirmImport) return;
    setConfirmingImport(true); setMsg(null); setErr(null);
    const error = await onConfirmImport(preview.previewHash);
    setConfirmingImport(false);
    if (error) setErr(error); else setMsg('章节已导入平台报告字段');
  };

  if (!sections) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <span className="inline-block size-3 animate-spin rounded-full border-2 border-hairline border-t-coral" />
        正在根据前序阶段自动生成报告框架，请稍候…
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="display-sm">实验报告</h3>
        <div className="flex items-center gap-2">
          {onImport && (
            <label className={buttonClass('secondary', 'sm', importing ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')}>
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
            <Button size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? '导出中…' : '导出为 Word'}
            </Button>
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

      {stage5?.importPreview && (
        <Callout tone="warning" title="Word 章节导入预览">
          <p>
            已识别 {stage5.importPreview.detectedFields.length}/8 节。确认后仅用下列识别内容覆盖对应平台字段，原 Word 仍作为附件保留。
          </p>
          <div className="mt-3 space-y-2">
            {REPORT_IMPORT_FIELDS.filter(({ key }) => stage5.importPreview?.detectedFields.includes(key)).map(({ key, label }) => (
              <div key={key} className="rounded-md border border-hairline bg-canvas p-2">
                <div className="text-xs font-medium text-body-strong">识别为：{label}</div>
                <div className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-muted">
                  {stage5.importPreview?.sections[key]}
                </div>
              </div>
            ))}
          </div>
          {stage5.importPreview.missingFields.length > 0 && (
            <p className="mt-3 text-xs leading-5">
              未识别：{REPORT_IMPORT_FIELDS.filter(({ key }) => stage5.importPreview?.missingFields.includes(key)).map(({ label }) => label).join('、')}。这些字段将保留平台当前内容。
            </p>
          )}
          {stage5.importPreview.complete && (
            <p className="mt-2 text-xs text-[#2f7a43]">全部必需章节均已识别；导入后可按现有提交门禁直接提交。</p>
          )}
          {onConfirmImport && (
            <div className="mt-4">
              <Button size="sm" variant="primary" onClick={handleConfirmImport} disabled={confirmingImport}>
                {confirmingImport ? '导入中…' : '确认映射并导入'}
              </Button>
            </div>
          )}
        </Callout>
      )}

      {/* 学生填写结论与局限讨论 */}
      <Field label="结论（请你填写）" htmlFor="report-conclusion">
        <Textarea
          id="report-conclusion"
          value={conclusion}
          onChange={(e) => setConclusion(e.target.value)}
          rows={4}
          placeholder="根据数据分析，回答你的研究问题……"
        />
      </Field>
      <Field label="局限与讨论（请你填写）" htmlFor="report-limitations">
        <Textarea
          id="report-limitations"
          value={limitations}
          onChange={(e) => setLimitations(e.target.value)}
          rows={4}
          placeholder="说明实验局限、可能的误差来源，以及下一次可怎样改进。"
        />
      </Field>

      {/* AI 参考分与教师分：AI 分是参考，教师分才是门禁，视觉上不能等重 */}
      {stage5?.aiReferenceScore && (
        <Card tone="soft">
          <div className="flex items-baseline justify-between gap-3">
            <span className="caption-upper">AI 参考评分</span>
            <span className="font-lineage text-lg text-ink">{stage5.aiReferenceScore.overall}/10</span>
          </div>
          {stage5.aiReferenceScore.highlights?.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-sm leading-6 text-body">
              {stage5.aiReferenceScore.highlights.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          )}
        </Card>
      )}
      {stage5?.teacherScore !== undefined && (
        <Callout
          tone={stage5.teacherScore >= 6 ? 'success' : 'warning'}
          title={
            <span className="flex flex-wrap items-baseline gap-2">
              教师评分：<span className="font-lineage text-lg">{stage5.teacherScore}/10</span>
              {stage5.teacherScore < 6 && <span className="text-sm font-normal text-error">需重新修改并提交</span>}
            </span>
          }
        >
          {stage5.teacherFeedback && <div className="whitespace-pre-wrap">{stage5.teacherFeedback}</div>}
        </Callout>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
        <Button onClick={handleSave} disabled={saving || submitting}>
          {saving ? '保存中…' : '保存报告'}
        </Button>
        {onSubmit && (
          <Button variant="primary" onClick={handleSubmit} disabled={saving || submitting}>
            {submitting ? '提交中…' : submitLabel}
          </Button>
        )}
        {msg && <span className="text-sm text-[#2f7a43]">{msg}</span>}
        {err && <span className="text-sm text-error">{err}</span>}
      </div>
    </div>
  );
}
