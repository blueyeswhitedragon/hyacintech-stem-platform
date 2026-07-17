import Link from 'next/link';
import { redirect } from 'next/navigation';
import CampaignLifecycleActions from '@/app/components/dataLab/CampaignLifecycleActions';
import ExpiredTaskManager from '@/app/components/dataLab/ExpiredTaskManager';
import { listCampaignProgress, listExpiredAnnotationTasks } from '@/app/lib/dataLab/service';
import { getCurrentUser } from '@/app/lib/session';

const statusLabels: Record<string, string> = {
  DRAFT: '待启动',
  ACTIVE: '进行中',
  COMPLETED: '已完成',
  PAUSED: '已暂停',
  ARCHIVED: '已归档',
};

type CampaignProgress = Awaited<ReturnType<typeof listCampaignProgress>>[number];

function CampaignCard({ campaign }: { campaign: CampaignProgress }) {
  const progress = campaign.taskCount > 0 ? Math.round((campaign.approvedTaskCount / campaign.taskCount) * 100) : 0;
  const isArchived = campaign.status === 'ARCHIVED';
  return <article className={`rounded-xl border p-4 shadow-sm ${isArchived ? 'bg-gray-50' : 'bg-white'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{campaign.name}</h3><span className={`rounded-full px-2 py-1 text-xs ${campaign.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : isArchived ? 'bg-slate-200 text-slate-700' : 'bg-gray-100 text-gray-600'}`}>{statusLabels[campaign.status] ?? campaign.status}</span></div>
        <p className="mt-1 text-xs text-gray-500">{campaign.participantCount > 0 ? `${campaign.participantCount} 名当前参与者` : campaign.status === 'ARCHIVED' ? '参与者分配已停用' : '旧活动：所有标注员可领取'} · 创建者 {campaign.createdBy.displayName}</p>
        {campaign.completedAt && <p className="mt-1 text-xs text-gray-400">结束于 {new Date(campaign.completedAt).toLocaleString('zh-CN')}</p>}
      </div>
      <CampaignLifecycleActions campaign={campaign} />
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <div><div className="text-xs text-gray-500">有效任务</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.approvedTaskCount} / {campaign.taskCount}</div></div>
      <div><div className="text-xs text-gray-500">已提交任务</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.submittedTaskCount} / {campaign.taskCount}</div></div>
      <div><div className="text-xs text-gray-500">完成样本</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.completedSampleCount} / {campaign.sampleCount}</div></div>
      <div><div className="text-xs text-gray-500">待工作量审核</div><div className="mt-1 text-lg font-semibold text-amber-700 tabular-nums">{campaign.pendingWorkReviewCount}</div></div>
      <div><div className="text-xs text-gray-500">待仲裁 / 已仲裁</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.pendingReviewCount} / {campaign.decidedReviewCount}</div></div>
      <div><div className="text-xs text-gray-500">未完成 / 已取消</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.unfinishedTaskCount} / {campaign.cancelledTaskCount}</div></div>
    </div>
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} /></div>
    <div className="mt-2 text-right text-xs text-gray-500">有效工作量完成 {progress}%</div>
  </article>;
}

export default async function CampaignsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const [campaigns, expiredTasks] = await Promise.all([
    listCampaignProgress(),
    listExpiredAnnotationTasks(),
  ]);
  const currentCampaigns = campaigns.filter((campaign) => campaign.status !== 'ARCHIVED');
  const archivedCampaigns = campaigns.filter((campaign) => campaign.status === 'ARCHIVED');

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">历史数据，只读</p><h1 className="mt-1 text-2xl font-semibold">旧标注活动</h1><p className="mt-1 text-sm text-gray-500">不再创建或启动五风格标注活动；现有记录可归档，空草稿可删除，过期任务仍可释放。</p></div><Link href="/data-lab/workload" className="rounded-lg border bg-white px-4 py-2 text-sm text-blue-700 hover:bg-blue-50">查看有效标注统计</Link></div>

    <section className="space-y-3">
      <div><h2 className="font-semibold">当前活动</h2><p className="mt-1 text-xs text-gray-500">任务条数按每位参与者的一次独立标注计算；双标样本会产生两条任务。不再使用的活动请结束并归档，不要删除历史提交。</p></div>
      {currentCampaigns.length === 0 ? <div className="rounded-xl border bg-white p-6 text-center text-sm text-gray-500">当前没有待启动或进行中的活动。</div> : currentCampaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />)}
    </section>

    {archivedCampaigns.length > 0 && <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">历史归档活动（{archivedCampaigns.length}）</summary><p className="mt-2 text-xs text-gray-500">归档活动不再分发任务，但已提交内容、审核、仲裁、有效工作量和发布版本继续保留。</p><div className="mt-4 space-y-3">{archivedCampaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />)}</div></details>}
    <ExpiredTaskManager tasks={expiredTasks} />
  </div>;
}
