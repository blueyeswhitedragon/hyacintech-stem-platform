"use client";

import React from 'react';
import type { Stage2Column } from '@/app/models/stageData';
import Button from './ui/Button';
import SubmitButton from './SubmitButton';

interface Props {
  columns: Stage2Column[];
  onSave: (columns: Stage2Column[]) => Promise<string | null>;
}

export default function SchemaEditor({ columns: initial, onSave }: Props) {
  const [columns, setColumns] = React.useState<Stage2Column[]>(() =>
    initial.map((c) => ({ ...c }))
  );

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
        <Button variant="ghost" size="sm" onClick={addColumn}>+ 添加列</Button>
        <SubmitButton label="保存列定义" loadingLabel="保存中…" successLabel="✓ 已保存" variant="primary" size="sm" onSubmit={handleSave} />
      </div>
    </div>
  );
}
