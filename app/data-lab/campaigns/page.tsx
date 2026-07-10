import CampaignManager from '@/app/components/dataLab/CampaignManager';
import StartCampaignButton from '@/app/components/dataLab/StartCampaignButton';
import { listBatches, listCampaigns } from '@/app/lib/dataLab/service';

export default async function CampaignsPage() {
  const [batches, campaigns] = await Promise.all([listBatches(), listCampaigns()]);
  return <div className="space-y-6"><div><h1 className="text-2xl font-semibold">标注活动</h1><p className="mt-1 text-sm text-gray-500">管理员配置样本范围、多人协议和风格配额，启动后由系统队列分配。</p></div><CampaignManager batches={batches.map((batch) => ({ id: batch.id, name: batch.name }))} />
    <div className="overflow-x-auto border bg-white"><table className="w-full text-left text-sm"><thead className="border-b bg-gray-50"><tr><th className="p-3">活动</th><th className="p-3">状态</th><th className="p-3">任务</th><th className="p-3">仲裁</th><th className="p-3">创建者</th><th className="p-3"></th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id} className="border-b last:border-0"><td className="p-3 font-medium">{campaign.name}</td><td className="p-3">{campaign.status}</td><td className="p-3 tabular-nums">{campaign._count.tasks}</td><td className="p-3 tabular-nums">{campaign._count.reviewCases}</td><td className="p-3">{campaign.createdBy.displayName}</td><td className="p-3">{campaign.status === 'DRAFT' && <StartCampaignButton id={campaign.id} />}</td></tr>)}</tbody></table></div>
  </div>;
}
