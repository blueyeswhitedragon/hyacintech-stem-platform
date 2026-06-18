"use client";

import React, { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { Stage2Data, Stage3Data } from '@/app/models/stageData';
import Button from './ui/Button';
import SubmitButton from './SubmitButton';

interface Props {
  schema?: Stage2Data['schema'];
  stage3?: Stage3Data;
  onComplete: () => Promise<string | null>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function ChartViewer({ schema, stage3, onComplete }: Props) {
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');

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

  const handleComplete = async () => onComplete();

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">数据图表</h3>
        <div className="flex gap-1 text-sm">
          <Button variant={chartType === 'line' ? 'primary' : 'ghost'} size="sm" onClick={() => setChartType('line')}>折线</Button>
          <Button variant={chartType === 'bar' ? 'primary' : 'ghost'} size="sm" onClick={() => setChartType('bar')}>柱状</Button>
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
        <SubmitButton label="完成分析，进入报告" loadingLabel="推进中…" variant="success" size="sm" onSubmit={handleComplete} />
      </div>
    </div>
  );
}
