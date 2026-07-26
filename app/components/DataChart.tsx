"use client";

import React, { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { Stage2Column } from '@/app/models/stageData';

interface Props {
  columns: Stage2Column[];
  rows: Record<string, unknown>[];
  /** 图表标题；阶段4用「数据图表」，报告里用「数据图表（同第 4 阶段）」。 */
  title?: string;
  height?: number;
}

/*
 * 图表配色：珊瑚打头（第一条数据线通常是主变量），其余用深墨与低饱和辅色。
 * 不用 Tailwind 默认的蓝/绿/紫——那套饱和度在奶油底上会显得刺眼且不成体系。
 */
const COLORS = ['#cc785c', '#3d3d3a', '#5db8a6', '#d4a017', '#a9583e'];
const AXIS = '#8e8b82';
const GRID = '#e6dfd8';

/**
 * 第 4 阶段的折线/柱状图本体，从 ChartViewer 抽出以便第 5、6 阶段的报告在数据表下
 * 原样复用同一套坐标轴选择与配色——图表结论要和分析阶段看到的完全一致，
 * 不能因为换了面板就换一种画法。这里只画图，不含推进门禁与引用示例。
 */
export default function DataChart({ columns, rows, title = '数据图表', height = 300 }: Props) {
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');

  if (rows.length === 0) return null;

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

  const axisProps = { stroke: AXIS, tick: { fill: AXIS, fontSize: 12 } };
  const tooltipStyle = {
    contentStyle: { background: '#faf9f5', border: '1px solid #e6dfd8', borderRadius: 8, fontSize: 12 },
    labelStyle: { color: '#141413' },
  };

  const segmented = (type: 'line' | 'bar', label: string) => (
    <button
      onClick={() => setChartType(type)}
      className={`rounded px-2.5 py-1 text-xs transition-colors duration-[120ms] ${
        chartType === type ? 'bg-canvas text-ink shadow-sm' : 'text-muted hover:text-ink'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="display-sm">{title}</h3>
        {/* 分段控件：选中态靠"抬起来的奶油块"表示，不用实心色块 */}
        <div className="flex gap-0.5 rounded-md border border-hairline bg-surface-soft p-0.5">
          {segmented('line', '折线')}
          {segmented('bar', '柱状')}
        </div>
      </div>

      {yKeys.length === 0 ? (
        <p className="text-sm text-muted">数据表中没有可作为纵轴的数值列。</p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          {chartType === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey={xKey} name={titleOf(xKey)} {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: AXIS }} />
              {yKeys.map((k, i) => (
                <Line key={k} type="monotone" dataKey={k} name={titleOf(k)} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey={xKey} name={titleOf(xKey)} {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#f5f0e8' }} />
              <Legend wrapperStyle={{ fontSize: 12, color: AXIS }} />
              {yKeys.map((k, i) => (
                <Bar key={k} dataKey={k} name={titleOf(k)} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  );
}
