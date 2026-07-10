import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { dataLabOverview } from '@/app/lib/dataLab/service';

export default async function DataLabPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const stats = await dataLabOverview(user);
  const cards = [
    ['数据批次', stats.batches],
    ['基线样本', stats.samples],
    ['标注活动', stats.campaigns],
    ['待办标注', stats.pendingTasks],
    ['待仲裁', stats.pendingReviews],
    ['冻结版本', stats.releases],
    ['训练任务', stats.trainingRuns],
    ['评测记录', stats.evaluations],
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">数据闭环概览</h1>
        <p className="mt-1 text-sm text-gray-500">采集、标注、仲裁、发布和评测采用同一条可追溯证据链。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={String(label)} className="border bg-white p-4">
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 text-sm text-gray-500">{label}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Link href="/data-lab/annotate" className="border bg-white p-5 hover:border-blue-400">
          <h2 className="font-medium">领取下一条标注</h2><p className="mt-2 text-sm text-gray-500">结构化编辑导师回复，不接触 ShareGPT JSON。</p>
        </Link>
        {user.role !== 'annotator' && <Link href="/data-lab/review" className="border bg-white p-5 hover:border-blue-400"><h2 className="font-medium">进入匿名仲裁</h2><p className="mt-2 text-sm text-gray-500">比较匿名版本，决定 Gold、Silver 或退回。</p></Link>}
        {user.role === 'admin' && <Link href="/data-lab/batches" className="border bg-white p-5 hover:border-blue-400"><h2 className="font-medium">导入数据批次</h2><p className="mt-2 text-sm text-gray-500">上传 clean ShareGPT 与可选 manifest，自动生成检查报告。</p></Link>}
      </div>
    </div>
  );
}
