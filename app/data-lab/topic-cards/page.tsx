import { redirect } from 'next/navigation';
import TopicCardManager from '@/app/components/dataLab/TopicCardManager';
import TopicLibraryTabs from '@/app/components/dataLab/TopicLibraryTabs';
import TopicSourcePool from '@/app/components/dataLab/TopicSourcePool';
import { listTopicCards } from '@/app/lib/dataLab/bootstrap/service';
import { listTopicSources } from '@/app/lib/dataLab/bootstrap/topicSources';
import { getCurrentUser } from '@/app/lib/session';

export default async function TopicCardsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const [cards, sources] = await Promise.all([listTopicCards(), listTopicSources()]);
  const defaultModels = {
    A: { provider: process.env.DATA_LAB_MODEL_A_PROVIDER ?? process.env.LLM_PROVIDER ?? '', model: process.env.DATA_LAB_MODEL_A ?? process.env.LLM_MODEL ?? '' },
    B: { provider: process.env.DATA_LAB_MODEL_B_PROVIDER ?? '', model: process.env.DATA_LAB_MODEL_B ?? '' },
  };
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">话题库</h1><p className="mt-1 text-sm text-muted">先在素材池核对授权、摘要与课程项目，再编译为话题卡；话题卡审核通过后才能进入案例批次。</p></div><TopicLibraryTabs sourcePool={<TopicSourcePool sources={sources} defaultModels={defaultModels} />} topicCards={<TopicCardManager cards={cards} />} /></div>;
}
