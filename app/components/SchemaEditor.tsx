"use client";

import React from 'react';
import type { Stage2Column } from '@/app/models/stageData';

interface Props {
  columns: Stage2Column[];
  onSave: (columns: Stage2Column[]) => Promise<string | null>;
}

export default function SchemaEditor({ columns: initial, onSave }: Props) {
  const [columns, setColumns] = React.useState<Stage2Column[]>(() =>
    initial.map((c) => ({ ...c }))
  );
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const setCol = (idx: number, patch: Partial<Stage2Column>) => {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const addColumn = () => {
    setColumns((prev) => [
      ...prev,
      { key: `col_${prev.length + 1}`, title: '新列', type: 'text', required: false },
    ]);
  };

  const removeColumn = (idx: number) => {
    if (columns.length <= 1) return;
    setColumns((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async (): Promise<string | null> => {
    const keys = new Set<string>();
    for (const c of columns) {
      if (!c.key.trim() || !c.title.trim()) return '每列必须填写 key 和中文名';
      if (keys.has(c.key)) return `列 key「${c.key}」重复`;
      keys.add(c.key);
    }
    return onSave(columns);
  };

  const doSave = async () => {
    setSaving(true); setMsg(null); setErr(null);
    const e = await handleSave();
    setSaving(false);
    if (e) setErr(e); else setMsg('✓ 已保存');
  };

  return (
    <div className="p-4">
      <h3 className="font-medium mb-2">📋 数据表结构（可修改）</h3>
      <p className="text-xs text-gray-500 mb-3">
        AI 生成了以下列结构。你可以修改列名、调整类型、增减列，确认无误后点击保存。
      </p>

      <div className="overflow-x-auto mb-3">
        <table className="w-full text-sm border">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="p-2 border text-left w-12">#</th>
              <th className="p-2 border text-left">key</th>
              <th className="p-2 border text-left">中文名</th>
              <th className="p-2 border text-left w-24">类型</th>
              <th className="p-2 border text-center w-16">必填</th>
              <th className="p-2 border text-center w-12"></th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="p-1 border text-center text-gray-400 text-xs">{i + 1}</td>
                <td className="p-1 border">
                  <input value={col.key} onChange={(e) => setCol(i, { key: e.target.value })}
                    className="w-full border rounded px-1 py-0.5 text-xs font-mono text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </td>
                <td className="p-1 border">
                  <input value={col.title} onChange={(e) => setCol(i, { title: e.target.value })}
                    className="w-full border rounded px-1 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </td>
                <td className="p-1 border">
                  <select value={col.type} onChange={(e) => setCol(i, { type: e.target.value as Stage2Column['type'] })}
                    className="w-full border rounded px-1 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option value="text">text</option><option value="number">number</option><option value="image">image</option>
                  </select>
                </td>
                <td className="p-1 border text-center">
                  <input type="checkbox" checked={col.required} onChange={(e) => setCol(i, { required: e.target.checked })} className="h-3.5 w-3.5" />
                </td>
                <td className="p-1 border text-center">
                  <button onClick={() => removeColumn(i)} disabled={columns.length <= 1}
                    className="text-red-400 hover:text-red-600 disabled:opacity-30 text-xs" title="删除列">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={addColumn}
          className="px-3 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-100">+ 添加列</button>
        <button onClick={doSave} disabled={saving}
          className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">
          {saving ? '保存中…' : '保存列定义'}
        </button>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}
