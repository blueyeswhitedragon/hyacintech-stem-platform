"use client";

import React from 'react';
import type { Stage2Column } from '@/app/models/stageData';
import Button from './ui/Button';
import { Input, Select } from './ui/Field';

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
    if (e) setErr(e); else setMsg('已保存');
  };

  return (
    <div className="p-4">
      <h3 className="display-sm mb-1.5">数据表结构（可修改）</h3>
      <p className="mb-3 text-sm leading-6 text-muted">
        AI 生成了以下列结构。你可以修改列名、调整类型、增减列，确认无误后点击保存。
      </p>

      {/* 这是一张密集编辑网格：即使在学生端的宽松版式里，逐格输入也要用紧凑密度，
          否则一行会撑到两指高，反而更难对照修改。 */}
      <div className="density-compact mb-3 overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full border-collapse text-xs">
          <thead className="border-b border-hairline bg-surface-soft">
            <tr>
              <th className="w-10 p-2 text-center font-medium text-muted">#</th>
              <th className="p-2 text-left font-medium text-muted">key</th>
              <th className="p-2 text-left font-medium text-muted">中文名</th>
              <th className="w-28 p-2 text-left font-medium text-muted">类型</th>
              <th className="w-14 p-2 text-center font-medium text-muted">必填</th>
              <th className="w-10 p-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {columns.map((col, i) => (
              <tr key={i}>
                <td className="p-1.5 text-center tabular-nums text-muted-soft">{i + 1}</td>
                <td className="p-1.5">
                  <Input
                    value={col.key}
                    onChange={(e) => setCol(i, { key: e.target.value })}
                    className="font-mono text-xs"
                  />
                </td>
                <td className="p-1.5">
                  <Input
                    value={col.title}
                    onChange={(e) => setCol(i, { title: e.target.value })}
                    className="text-xs"
                  />
                </td>
                <td className="p-1.5">
                  <Select
                    value={col.type}
                    onChange={(e) => setCol(i, { type: e.target.value as Stage2Column['type'] })}
                    className="text-xs"
                  >
                    <option value="text">text</option>
                    <option value="number">number</option>
                    <option value="image">image</option>
                  </Select>
                </td>
                <td className="p-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={col.required}
                    onChange={(e) => setCol(i, { required: e.target.checked })}
                    className="size-3.5 accent-coral"
                  />
                </td>
                <td className="p-1.5 text-center">
                  <button
                    onClick={() => removeColumn(i)}
                    disabled={columns.length <= 1}
                    className="text-muted-soft transition-colors duration-[120ms] hover:text-error disabled:opacity-30 disabled:hover:text-muted-soft"
                    title="删除列"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={addColumn}>添加列</Button>
        <Button size="sm" variant="primary" onClick={doSave} disabled={saving}>
          {saving ? '保存中…' : '保存列定义'}
        </Button>
        {msg && <span className="text-sm text-[#2f7a43]">{msg}</span>}
        {err && <span className="text-sm text-error">{err}</span>}
      </div>
    </div>
  );
}
