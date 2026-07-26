"use client";

import React, { useState } from 'react';
import type { Stage2Data, Stage3Data, Stage4Data } from '@/app/models/stageData';
import DataChart from './DataChart';
import ReadonlyDataTable from './ReadonlyDataTable';
import { describeStage4LastRound, evaluateStage4Readiness } from '@/app/lib/stage4Readiness';
import Button from './ui/Button';
import EmptyState from './ui/EmptyState';
import Callout from './ui/Callout';

interface Props {
  schema?: Stage2Data['schema'];
  stage3?: Stage3Data;
  stage4?: Stage4Data;
  onComplete: () => Promise<string | null>;
}

function isIndexColumn(key: string, title: string): boolean {
  return /^(?:trial|repeat|repeat_index|index|row_index)$/i.test(key)
    || /(?:重复|试验|实验)?序号|编号/.test(title);
}

function citedCellKeys(stage4?: Stage4Data): Set<string> {
  return new Set((stage4?.evidenceRounds ?? []).flatMap((round) => (
    (round.evidence ?? []).map((item) => `${item.rowIndex}:${item.columnKey}`)
  )));
}

/**
 * 轮次感知的引用示例：优先挑还没被计入过的单元格，
 * 否则学生照抄两遍必然撞上「本轮没有新的单元格」。
 */
function stage4CitationExample(
  rows: Record<string, unknown>[],
  columns: NonNullable<Stage2Data['schema']>['columns'],
  stage4?: Stage4Data,
): string | null {
  if (rows.length < 2) return null;
  const cited = citedCellKeys(stage4);
  const filled = (key: string, index: number) => (
    rows[index][key] !== undefined && String(rows[index][key]).trim() !== ''
  );
  let picked: { key: string; title: string; first: number; second: number } | null = null;
  for (const preferFresh of [true, false]) {
    for (const column of columns) {
      if (isIndexColumn(column.key, column.title)) continue;
      const usable = rows
        .map((_, index) => index)
        .filter((index) => filled(column.key, index) && (!preferFresh || !cited.has(`${index}:${column.key}`)));
      if (usable.length < 2) continue;
      picked = { key: column.key, title: column.title, first: usable[0], second: usable[1] };
      break;
    }
    if (picked) break;
  }
  if (!picked) return null;
  const first = String(rows[picked.first][picked.key]).trim();
  const second = String(rows[picked.second][picked.key]).trim();
  const firstNumber = Number(first);
  const secondNumber = Number(second);
  let comparison = `${second} 与 ${first} 不同`;
  if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
    const difference = Number(Math.abs(secondNumber - firstNumber).toFixed(4));
    comparison = secondNumber === firstNumber
      ? `${second} 与 ${first} 相同`
      : secondNumber > firstNumber
        ? `${second} 比 ${first} 多 ${difference}`
        : `${second} 比 ${first} 少 ${difference}`;
  }
  return `第${picked.first + 1}行的「${picked.title}」是 ${first}，第${picked.second + 1}行的「${picked.title}」是 ${second}，${comparison}。`;
}

export default function ChartViewer({ schema, stage3, stage4, onComplete }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = stage3?.rows ?? [];
  const readiness = evaluateStage4Readiness({ stage4 });

  if (rows.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          art="chart"
          title="还没有可分析的数据"
          description="图表由第 3 阶段录入的数据生成。回到「过程执行」把实验结果记进数据表，这里就会自动画出折线或柱状图。"
        />
      </div>
    );
  }

  const columns = schema?.columns ?? [];
  const citationExample = stage4CitationExample(rows, columns, stage4);
  const lastRoundHint = readiness.ready ? undefined : describeStage4LastRound(stage4);

  const handleComplete = async () => {
    setBusy(true); setErr(null);
    const e = await onComplete();
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <div className="p-4">
      <DataChart columns={columns} rows={rows} />

      {columns.length > 0 && (
        <div className="mt-6">
          <div className="caption-upper mb-2">原始数据表（只读）</div>
          <ReadonlyDataTable columns={columns} rows={rows} />
        </div>
      )}

      {citationExample && (
        <div className="mt-4">
          <Callout tone="info" title="引用示例">
            <p>{citationExample}</p>
            <p className="mt-1 text-xs">一条消息里要同时引用两个不同单元格。</p>
          </Callout>
        </div>
      )}

      <div className={`mt-6 rounded-lg border px-3 py-2.5 text-sm ${
        readiness.ready
          ? 'border-success/35 bg-success/8'
          : 'border-hairline bg-surface-soft'
      }`}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-ink">有效分析进度</span>
          <span className="tabular-nums text-body">{readiness.acceptedRoundCount}/{readiness.requiredRoundCount}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted">{readiness.message}</p>
        {lastRoundHint && (
          <p className="mt-1.5 text-xs leading-5 text-body">
            <span className="font-medium">上一轮：</span>{lastRoundHint}
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="primary" onClick={handleComplete} disabled={busy || !readiness.ready}>
          {busy ? '推进中…' : '完成分析，进入报告'}
        </Button>
        {err && <span className="text-sm text-error">{err}</span>}
      </div>
    </div>
  );
}
