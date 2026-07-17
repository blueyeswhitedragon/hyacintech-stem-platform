import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/app/lib/session';
const links = [
  ['/data-lab/batches', '旧数据批次'], ['/data-lab/campaigns', '旧标注活动'], ['/data-lab/annotate', '旧标注工作台'], ['/data-lab/review', '旧仲裁'], ['/data-lab/workload', '旧工作量审核'], ['/data-lab/candidates', '线上候选历史'],
] as const;
export default async function HistoryPage() { const user = await getCurrentUser(); if (!user || user.role !== 'admin') redirect('/data-lab'); return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">历史数据</h1><p className="mt-1 text-sm text-gray-500">旧流程只读、导出和审计继续保留；不再创建或启动新批次/五风格活动。</p></div><div className="grid gap-3 md:grid-cols-2">{links.map(([href, label]) => <Link key={href} href={href} className="rounded-xl border bg-white p-5 hover:border-blue-400"><h2 className="font-medium">{label}</h2><p className="mt-2 text-sm text-gray-500">查看历史记录与审计血缘</p></Link>)}</div></div>; }
