import { redirect } from 'next/navigation';
import TopicCardManager from '@/app/components/dataLab/TopicCardManager';
import { listTopicCards } from '@/app/lib/dataLab/bootstrap/service';
import { getCurrentUser } from '@/app/lib/session';

export default async function TopicCardsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const cards = await listTopicCards();
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">话题库</h1><p className="mt-1 text-sm text-gray-500">创建话题卡 → 审核情境与研究路线 → 批准后进入案例批次。推荐用一键生成，也可以批量导入标题或手工建卡。</p></div><TopicCardManager cards={cards} /></div>;
}
