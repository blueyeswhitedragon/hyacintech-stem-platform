'use client';

import { useState, type ReactNode } from 'react';

export default function TopicLibraryTabs({ sourcePool, topicCards }: { sourcePool: ReactNode; topicCards: ReactNode }) {
  const [tab, setTab] = useState<'sources' | 'cards'>('sources');
  return <div className="space-y-4">
    <div className="inline-grid grid-cols-2 border border-hairline bg-canvas p-1" role="tablist" aria-label="话题库视图">
      <button type="button" role="tab" aria-selected={tab === 'sources'} onClick={() => setTab('sources')} className={`min-w-28 px-4 py-2 text-sm ${tab === 'sources' ? 'bg-ink text-on-dark' : 'text-body hover:bg-surface-soft'}`}>素材池</button>
      <button type="button" role="tab" aria-selected={tab === 'cards'} onClick={() => setTab('cards')} className={`min-w-28 px-4 py-2 text-sm ${tab === 'cards' ? 'bg-ink text-on-dark' : 'text-body hover:bg-surface-soft'}`}>话题卡</button>
    </div>
    <div role="tabpanel">{tab === 'sources' ? sourcePool : topicCards}</div>
  </div>;
}
