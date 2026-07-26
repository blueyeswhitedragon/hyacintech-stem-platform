"use client";

import React, { useState } from 'react';
import type { Stage2Data, Stage3Data, Stage3FileAssociation } from '@/app/models/stageData';
import Button from './ui/Button';
import Callout from './ui/Callout';
import EmptyState from './ui/EmptyState';
import { Input } from './ui/Field';

interface Props {
  schema?: Stage2Data['schema'];
  initial?: Stage3Data;
  onSave: (rows: Record<string, unknown>[], fileAssociations: Stage3FileAssociation[]) => Promise<string | null>;
  onComplete: () => Promise<string | null>;
  /** 体验模式禁用图片上传。 */
  allowUpload?: boolean;
  /** 安全问答未通过时禁用所有数据录入操作。 */
  disabledReason?: string;
}

export default function DataTableEditor({ schema, initial, onSave, onComplete, allowUpload = true, disabledReason }: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[]>(initial?.rows ?? []);
  const [fileAssoc, setFileAssoc] = useState<Stage3FileAssociation[]>(initial?.fileAssociations ?? []);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!schema || schema.columns.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          art="flask"
          title="还没有数据表结构"
          description="数据表的列由「方案设计」阶段确认的方案生成。请先回到第 2 阶段与 AI 导师确认实验方案，确认后这里会自动出现可录入的表格。"
        />
      </div>
    );
  }

  const { columns, minRows, maxRows } = schema;
  const disabled = Boolean(disabledReason);

  const setCell = (rowIdx: number, key: string, value: unknown) => {
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)));
  };

  const addRow = () => {
    if (rows.length >= maxRows) return;
    setRows((prev) => [...prev, {}]);
  };
  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setFileAssoc((prev) => prev.filter((f) => f.rowIndex !== idx).map((f) => (f.rowIndex > idx ? { ...f, rowIndex: f.rowIndex - 1 } : f)));
  };

  const uploadImage = async (rowIdx: number, colKey: string, file: File) => {
    setErr(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/uploads', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || '上传失败'); return; }
      setCell(rowIdx, colKey, data.url);
      setFileAssoc((prev) => [
        ...prev.filter((f) => !(f.rowIndex === rowIdx && f.colKey === colKey)),
        { rowIndex: rowIdx, colKey, fileUrl: data.url },
      ]);
    } catch {
      setErr('上传失败，请重试');
    }
  };

  const handleSave = async () => {
    setSaving(true); setMsg(null); setErr(null);
    const e = await onSave(rows, fileAssoc);
    setSaving(false);
    if (e) setErr(e); else setMsg('✓ 已保存');
  };

  const handleComplete = async () => {
    setCompleting(true); setErr(null);
    const se = await onSave(rows, fileAssoc);
    if (se) { setCompleting(false); setErr(se); return; }
    const e = await onComplete();
    setCompleting(false);
    if (e) setErr(e);
  };

  return (
    <div className="p-4">
      <h3 className="display-sm mb-3">实验数据表</h3>
      {schema.provenance === 'teacher_release' && (
        <Callout tone="warning">
          这是教师放行时补充的通用最小数据表，不代表你确认过完整实验方案。请按真实实验填写每次的条件与测量结果。
        </Callout>
      )}
      {rows.length === 0 ? (
        <EmptyState
          art="chart"
          title="还没有记录任何数据"
          description={`按方案做一次实验，就在这里记一行。建议至少 ${minRows} 行，这样第 4 阶段才看得出规律。`}
          action={<Button variant="primary" onClick={addRow} disabled={disabled}>记录第一行数据</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-hairline bg-surface-soft">
              <tr>
                <th className="w-10 px-2 py-2 text-center text-xs font-medium text-muted">#</th>
                {columns.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-2 py-2 text-left text-xs font-medium text-muted">
                    {c.title}{c.required && <span className="ml-0.5 text-coral">*</span>}
                  </th>
                ))}
                <th className="w-12 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-soft">
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5 text-center text-xs tabular-nums text-muted-soft">{i + 1}</td>
                  {columns.map((c) => (
                    <td key={c.key} className="px-1.5 py-1">
                      {c.type === 'image' ? (
                        allowUpload ? (
                          <div className="flex items-center gap-2">
                            {row[c.key] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={String(row[c.key])} alt="" className="size-10 rounded object-cover" />
                            ) : null}
                            <label className={`text-xs text-coral hover:text-coral-active ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                              {row[c.key] ? '更换' : '上传'}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={disabled}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(i, c.key, f); }}
                              />
                            </label>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-soft">体验模式不支持上传</span>
                        )
                      ) : (
                        <Input
                          type={c.type === 'number' ? 'number' : 'text'}
                          value={String(row[c.key] ?? '')}
                          onChange={(e) =>
                            setCell(i, c.key, c.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)
                          }
                          disabled={disabled}
                          className={c.type === 'number' ? 'tabular-nums' : ''}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1.5 py-1 text-center">
                    <button
                      onClick={() => removeRow(i)}
                      disabled={disabled}
                      className="text-xs text-muted-soft transition-colors duration-[120ms] hover:text-error disabled:opacity-40"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {disabledReason && (
          <div className="w-full">
            <Callout tone="warning">{disabledReason}</Callout>
          </div>
        )}
        <Button size="sm" onClick={addRow} disabled={disabled || rows.length >= maxRows}>
          + 添加一行
        </Button>
        <Button size="sm" onClick={handleSave} disabled={disabled || saving || completing}>
          {saving ? '保存中…' : '保存'}
        </Button>
        <Button size="sm" variant="primary" onClick={handleComplete} disabled={disabled || saving || completing}>
          {completing ? '推进中…' : '完成数据收集，进入分析'}
        </Button>
        <span className="text-xs text-muted-soft">建议至少 {minRows} 行，最多 {maxRows} 行</span>
        {msg && <span className="text-sm text-[#2f7a43]">{msg}</span>}
        {err && <span className="text-sm text-error">{err}</span>}
      </div>
    </div>
  );
}
