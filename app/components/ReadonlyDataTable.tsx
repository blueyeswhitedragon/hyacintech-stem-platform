import React from 'react';
import type { Stage2Column } from '@/app/models/stageData';

export default function ReadonlyDataTable({
  columns,
  rows,
}: {
  columns: Stage2Column[];
  rows: Record<string, unknown>[];
}) {
  if (columns.length === 0 || rows.length === 0) return null;
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full min-w-max border-collapse text-xs">
        <thead className="sticky top-0 z-10 border-b border-hairline bg-surface-soft">
          <tr>
            <th className="sticky left-0 z-20 w-8 bg-surface-soft p-1.5 text-center font-medium text-muted">#</th>
            {columns.map((column) => (
              <th key={column.key} className="whitespace-nowrap p-1.5 text-left font-medium text-muted">
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline-soft">
          {/* 斑马纹用 canvas / surface-soft 两层奶油，比灰白交替更贴设计体系 */}
          {rows.map((row, index) => (
            <tr key={index} className={index % 2 === 0 ? 'bg-canvas' : 'bg-surface-soft/60'}>
              <td className={`sticky left-0 z-[1] p-1.5 text-center tabular-nums text-muted-soft ${index % 2 === 0 ? 'bg-canvas' : 'bg-surface-soft'}`}>{index + 1}</td>
              {columns.map((column) => (
                <td key={column.key} className={`whitespace-nowrap p-1.5 text-body ${column.type === 'number' ? 'tabular-nums' : ''}`}>
                  {column.type === 'image' && row[column.key] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={String(row[column.key])} alt="" className="size-8 rounded object-cover" />
                  ) : (
                    String(row[column.key] ?? '—')
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
