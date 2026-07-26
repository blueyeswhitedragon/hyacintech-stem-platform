import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listCampaignProgress } from '@/app/lib/dataLab/service';
import { getCurrentUser } from '@/app/lib/session';
import { buttonClass } from '@/app/components/ui/Button';

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
  return <article className={`rounded-lg border border-hairline p-4 shadow-sm ${isArchived ? 'bg-surface-soft' : 'bg-canvas'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{campaign.name}</h3><span className={`rounded-full px-2 py-1 text-xs ${campaign.status === 'ACTIVE' ? 'bg-success/8 text-body-strong' : isArchived ? 'bg-surface-card text-body' : 'bg-surface-card text-muted'}`}>{statusLabels[campaign.status] ?? campaign.status}</span></div>
        <p className="mt-1 text-xs text-muted">{campaign.participantCount > 0 ? `${campaign.participantCount} 名当前参与者` : campaign.status === 'ARCHIVED' ? '参与者分配已停用' : '旧活动：所有标注员可领取'} · 创建者 {campaign.createdBy.displayName}</p>
        {campaign.completedAt && <p className="mt-1 text-xs text-muted-soft">结束于 {new Date(campaign.completedAt).toLocaleString('zh-CN')}</p>}
      </div>
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <div><div className="text-xs text-muted">有效任务</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.approvedTaskCount} / {campaign.taskCount}</div></div>
      <div><div className="text-xs text-muted">已提交任务</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.submittedTaskCount} / {campaign.taskCount}</div></div>
      <div><div className="text-xs text-muted">完成样本</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.completedSampleCount} / {campaign.sampleCount}</div></div>
      <div><div className="text-xs text-muted">待工作量审核</div><div className="mt-1 text-lg font-semibold text-[#8a6a0f] tabular-nums">{campaign.pendingWorkReviewCount}</div></div>
      <div><div className="text-xs text-muted">待仲裁 / 已仲裁</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.pendingReviewCount} / {campaign.decidedReviewCount}</div></div>
      <div><div className="text-xs text-muted">未完成 / 已取消</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.unfinishedTaskCount} / {campaign.cancelledTaskCount}</div></div>
    </div>
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-card"><div className="h-full rounded-full bg-success" style={{ width: `${progress}%` }} /></div>
    <div className="mt-2 text-right text-xs text-muted">有效工作量完成 {progress}%</div>
  </article>;
}

export default async function CampaignsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const campaigns = await listCampaignProgress();
  const currentCampaigns = campaigns.filter((campaign) => campaign.status !== 'ARCHIVED');
  const archivedCampaigns = campaigns.filter((campaign) => campaign.status === 'ARCHIVED');

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2f7f70]">历史数据，只读</p><h1 className="mt-1 text-2xl font-semibold">旧标注活动</h1><p className="mt-1 text-sm text-muted">五风格标注流程已经冻结；现有提交、审核和审计血缘只读保留。</p></div><Link href="/data-lab/workload" className={buttonClass('secondary', 'md')}>查看有效标注统计</Link></div>

    <section className="space-y-3">
      <div><h2 className="font-semibold">当前活动</h2><p className="mt-1 text-xs text-muted">任务条数按每位参与者的一次独立标注计算；双标样本会产生两条任务。不再使用的活动请结束并归档，不要删除历史提交。</p></div>
      {currentCampaigns.length === 0 ? <div className="rounded-lg border border-hairline bg-canvas p-6 text-center text-sm text-muted">当前没有待启动或进行中的活动。</div> : currentCampaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />)}
    </section>

    {archivedCampaigns.length > 0 && <details className="rounded-lg border border-hairline bg-canvas p-4"><summary className="cursor-pointer font-semibold">历史归档活动（{archivedCampaigns.length}）</summary><p className="mt-2 text-xs text-muted">归档活动不再分发任务，但已提交内容、审核、仲裁、有效工作量和发布版本继续保留。</p><div className="mt-4 space-y-3">{archivedCampaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />)}</div></details>}
  </div>;
}
