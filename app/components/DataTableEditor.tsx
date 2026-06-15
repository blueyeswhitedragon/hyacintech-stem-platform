"use client";

import React, { useState } from 'react';
import type { Stage2Data, Stage3Data, Stage3FileAssociation } from '@/app/models/stageData';

interface Props {
  schema?: Stage2Data['schema'];
  initial?: Stage3Data;
  onSave: (rows: Record<string, unknown>[], fileAssociations: Stage3FileAssociation[]) => Promise<string | null>;
  onComplete: () => Promise<string | null>;
  /** 体验模式禁用图片上传。 */
  allowUpload?: boolean;
}

export default function DataTableEditor({ schema, initial, onSave, onComplete, allowUpload = true }: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[]>(initial?.rows ?? []);
  const [fileAssoc, setFileAssoc] = useState<Stage3FileAssociation[]>(initial?.fileAssociations ?? []);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!schema || schema.columns.length === 0) {
    return (
      <div className="text-sm text-gray-500 p-4">
        请先在「方案设计」阶段与 AI 确定实验方案并生成数据表结构，然后回到本阶段录入数据。
      </div>
    );
  }

  const { columns, minRows, maxRows } = schema;

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
    if (e) setErr(e); else setMsg('已保存');
  };

  const handleComplete = async () => {
    setSaving(true); setMsg(null); setErr(null);
    // 先保存再推进
    const se = await onSave(rows, fileAssoc);
    if (se) { setSaving(false); setErr(se); return; }
    const e = await onComplete();
    setSaving(false);
    if (e) setErr(e);
  };

  return (
    <div className="p-4">
      <h3 className="font-medium mb-3">实验数据表</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="p-2 border w-10">#</th>
              {columns.map((c) => (
                <th key={c.key} className="p-2 border text-left whitespace-nowrap">
                  {c.title}{c.required && <span className="text-red-500 ml-0.5">*</span>}
                </th>
              ))}
              <th className="p-2 border w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="p-2 border text-center text-gray-400">{i + 1}</td>
                {columns.map((c) => (
                  <td key={c.key} className="p-1 border">
                    {c.type === 'image' ? (
                      allowUpload ? (
                        <div className="flex items-center gap-2">
                          {row[c.key] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={String(row[c.key])} alt="" className="h-10 w-10 object-cover rounded" />
                          ) : null}
                          <label className="text-blue-600 text-xs cursor-pointer hover:underline">
                            {row[c.key] ? '更换' : '上传'}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(i, c.key, f); }}
                            />
                          </label>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">体验模式不支持上传</span>
                      )
                    ) : (
                      <input
                        type={c.type === 'number' ? 'number' : 'text'}
                        value={String(row[c.key] ?? '')}
                        onChange={(e) =>
                          setCell(i, c.key, c.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)
                        }
                        className="w-full border rounded px-1 py-0.5 text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    )}
                  </td>
                ))}
                <td className="p-1 border text-center">
                  <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 text-xs">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button
          onClick={addRow}
          disabled={rows.length >= maxRows}
          className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
        >
          + 添加一行
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          onClick={handleComplete}
          disabled={saving}
          className="px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
        >
          完成数据收集，进入分析
        </button>
        <span className="text-xs text-gray-400">建议至少 {minRows} 行，最多 {maxRows} 行</span>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}
