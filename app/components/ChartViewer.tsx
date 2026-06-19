"use client";

import React, { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { Stage2Data, Stage3Data } from '@/app/models/stageData';

interface Props {
  schema?: Stage2Data['schema'];
  stage3?: Stage3Data;
  onComplete: () => Promise<string | null>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function ChartViewer({ schema, stage3, onComplete }: Props) {
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = stage3?.rows ?? [];

  if (rows.length === 0) {
    return <div className="text-sm text-gray-500 p-4">还没有可分析的数据。请先在「过程执行」阶段录入实验数据。</div>;
  }

  const columns = schema?.columns ?? [];
  const numberKeys = columns.filter((c) => c.type === 'number').map((c) => c.key);
  // x 轴：第一列（不论类型）；y 轴：除 x 外的数值列
  const xKey = columns[0]?.key ?? Object.keys(rows[0])[0];
  const yKeys = numberKeys.filter((k) => k !== xKey);
  const titleOf = (key: string) => columns.find((c) => c.key === key)?.title ?? key;

  const data = rows.map((r) => {
    const o: Record<string, unknown> = { [xKey]: r[xKey] };
    yKeys.forEach((k) => (o[k] = typeof r[k] === 'number' ? r[k] : Number(r[k])));
    return o;
  });

  const handleComplete = async () => {
    setBusy(true); setErr(null);
    const e = await onComplete();
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">数据图表</h3>
        <div className="flex gap-1 text-sm">
          <button
            onClick={() => setChartType('line')}
            className={`px-2 py-0.5 rounded text-xs ${chartType === 'line' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          >折线</button>
          <button
            onClick={() => setChartType('bar')}
            className={`px-2 py-0.5 rounded text-xs ${chartType === 'bar' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          >柱状</button>
        </div>
      </div>

      {yKeys.length === 0 ? (
        <div className="text-sm text-gray-500">数据表中没有可作为纵轴的数值列。</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          {chartType === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} name={titleOf(xKey)} />
              <YAxis />
              <Tooltip />
              <Legend />
              {yKeys.map((k, i) => (
                <Line key={k} type="monotone" dataKey={k} name={titleOf(k)} stroke={COLORS[i % COLORS.length]} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} name={titleOf(xKey)} />
              <YAxis />
              <Tooltip />
              <Legend />
              {yKeys.map((k, i) => (
                <Bar key={k} dataKey={k} name={titleOf(k)} fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleComplete}
          disabled={busy}
          className="px-4 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
        >
          {busy ? '推进中…' : '完成分析，进入报告'}
        </button>
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}
