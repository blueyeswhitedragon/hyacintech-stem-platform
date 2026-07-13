import Link from 'next/link';
import CampaignManager from '@/app/components/dataLab/CampaignManager';
import ExpiredTaskManager from '@/app/components/dataLab/ExpiredTaskManager';
import StartCampaignButton from '@/app/components/dataLab/StartCampaignButton';
import { listAssignableAnnotators, listBatches, listCampaignProgress, listExpiredAnnotationTasks } from '@/app/lib/dataLab/service';

const statusLabels: Record<string, string> = { DRAFT: '待启动', ACTIVE: '进行中', COMPLETED: '已完成', PAUSED: '已暂停' };

export default async function CampaignsPage() {
  const [batches, annotators, campaigns, expiredTasks] = await Promise.all([
    listBatches(),
    listAssignableAnnotators(),
    listCampaignProgress(),
    listExpiredAnnotationTasks(),
  ]);
  return <div className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">管理员</p><h1 className="mt-1 text-2xl font-semibold">标注任务分配</h1><p className="mt-1 text-sm text-gray-500">选择数据、人员和审核强度，系统自动按队列分发。</p></div><Link href="/data-lab/workload" className="rounded-lg border bg-white px-4 py-2 text-sm text-blue-700 hover:bg-blue-50">查看有效标注统计</Link></div><CampaignManager batches={batches.map((batch) => ({ id: batch.id, name: batch.name }))} annotators={annotators} />
    <section className="space-y-3"><div><h2 className="font-semibold">活动进度</h2><p className="mt-1 text-xs text-gray-500">任务条数按每位参与者的一次独立标注计算；双标样本会产生两条任务。</p></div>{campaigns.map((campaign) => {
      const progress = campaign.taskCount > 0 ? Math.round((campaign.approvedTaskCount / campaign.taskCount) * 100) : 0;
      return <article key={campaign.id} className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{campaign.name}</h3><span className={`rounded-full px-2 py-1 text-xs ${campaign.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{statusLabels[campaign.status] ?? campaign.status}</span></div><p className="mt-1 text-xs text-gray-500">{campaign.participantCount > 0 ? `${campaign.participantCount} 名参与者` : '旧活动：所有标注员可领取'} · 创建者 {campaign.createdBy.displayName}</p></div>{campaign.status === 'DRAFT' && <StartCampaignButton id={campaign.id} />}</div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><div><div className="text-xs text-gray-500">有效任务</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.approvedTaskCount} / {campaign.taskCount}</div></div><div><div className="text-xs text-gray-500">已提交任务</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.submittedTaskCount} / {campaign.taskCount}</div></div><div><div className="text-xs text-gray-500">完成样本</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.completedSampleCount} / {campaign.sampleCount}</div></div><div><div className="text-xs text-gray-500">待工作量审核</div><div className="mt-1 text-lg font-semibold text-amber-700 tabular-nums">{campaign.pendingWorkReviewCount}</div></div><div><div className="text-xs text-gray-500">待仲裁 / 已仲裁</div><div className="mt-1 text-lg font-semibold tabular-nums">{campaign.pendingReviewCount} / {campaign.decidedReviewCount}</div></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} /></div><div className="mt-2 text-right text-xs text-gray-500">有效工作量完成 {progress}%</div></article>;
    })}</section>
    <ExpiredTaskManager tasks={expiredTasks} />
  </div>;
}
