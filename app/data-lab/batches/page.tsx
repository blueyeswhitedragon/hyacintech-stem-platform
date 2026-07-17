import { redirect } from 'next/navigation';
import { listBatches } from '@/app/lib/dataLab/service';
import { parseJson } from '@/app/lib/dataLab/validation';
import { datasetBatchStatusLabel } from '@/app/lib/dataLab/datasetPolicy';
import { getCurrentUser } from '@/app/lib/session';

export default async function BatchesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const batches = await listBatches();
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">历史数据批次</h1><p className="mt-1 text-sm text-gray-500">历史数据，只读。旧批次不再接收导入；原始记录与审计血缘继续保留。</p></div>
    <div className="overflow-x-auto border bg-white">
      <table className="w-full text-left text-sm"><thead className="border-b bg-gray-50"><tr><th className="p-3">批次</th><th className="p-3">用途状态</th><th className="p-3">来源文件</th><th className="p-3">样本</th><th className="p-3">自动检查</th><th className="p-3">导入者</th><th className="p-3">时间</th></tr></thead>
        <tbody>{batches.map((batch) => { const summary = parseJson<{ autoCheck?: { ok: number; warning: number; error: number } }>(batch.summaryJson, {}); return <tr key={batch.id} className="border-b last:border-0"><td className="p-3 font-medium">{batch.name}</td><td className={batch.status === 'ACTIVE' ? 'p-3 text-green-700' : 'p-3 font-medium text-amber-700'}>{datasetBatchStatusLabel(batch.status)}</td><td className="p-3 text-gray-600">{batch.sourceFileName}</td><td className="p-3 tabular-nums">{batch._count.samples}</td><td className="p-3 text-gray-600">{summary.autoCheck ? `${summary.autoCheck.ok} 正常 / ${summary.autoCheck.warning} 提醒 / ${summary.autoCheck.error} 错误` : '-'}</td><td className="p-3">{batch.importedBy.displayName}</td><td className="p-3 text-gray-500">{batch.importedAt.toLocaleString('zh-CN')}</td></tr>; })}</tbody>
      </table>
    </div>
  </div>;
}
