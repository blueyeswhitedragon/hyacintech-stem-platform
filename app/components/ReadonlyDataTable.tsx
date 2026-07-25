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
    <div className="max-w-full overflow-x-auto border rounded">
      <table className="min-w-max w-full text-xs">
        <thead className="sticky top-0 z-10 bg-gray-50 text-gray-600">
          <tr>
            <th className="sticky left-0 z-20 w-8 border bg-gray-50 p-1.5 text-center">#</th>
            {columns.map((column) => (
              <th key={column.key} className="p-1.5 border text-left whitespace-nowrap">
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className={`sticky left-0 z-[1] border p-1.5 text-center text-gray-400 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>{index + 1}</td>
              {columns.map((column) => (
                <td key={column.key} className="whitespace-nowrap border p-1.5 text-gray-800">
                  {column.type === 'image' && row[column.key] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={String(row[column.key])} alt="" className="h-8 w-8 object-cover rounded" />
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
