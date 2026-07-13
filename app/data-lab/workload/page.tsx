import { redirect } from 'next/navigation';
import WorkloadReviewTable from '@/app/components/dataLab/WorkloadReviewTable';
import { workloadDashboard } from '@/app/lib/dataLab/service';
import { getCurrentUser } from '@/app/lib/session';

export default async function WorkloadPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const dashboard = await workloadDashboard();
  return <div className="space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">管理员</p><h1 className="mt-1 text-2xl font-semibold">有效标注统计</h1><p className="mt-1 text-sm text-gray-500">按提交记录逐条审核，只统计审核通过的有效条数。</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border bg-white p-4"><div className="text-xs text-gray-500">待审核</div><div className="mt-1 text-2xl font-semibold tabular-nums">{dashboard.totals.pending}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs text-gray-500">审核通过</div><div className="mt-1 text-2xl font-semibold text-emerald-700 tabular-nums">{dashboard.totals.approved}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs text-gray-500">退回修改</div><div className="mt-1 text-2xl font-semibold text-blue-700 tabular-nums">{dashboard.totals.returned}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs text-gray-500">无效</div><div className="mt-1 text-2xl font-semibold text-red-700 tabular-nums">{dashboard.totals.invalid}</div></div></div><WorkloadReviewTable people={dashboard.people} items={dashboard.items} /></div>;
}
