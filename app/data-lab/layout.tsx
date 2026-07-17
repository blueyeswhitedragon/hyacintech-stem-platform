import { redirect } from 'next/navigation';
import Link from 'next/link';
import AuthNav from '@/app/components/AuthNav';
import { getCurrentUser } from '@/app/lib/session';
import { canUseDataLab } from '@/app/lib/dataLab/service';
import { tutorPersonalQueueCount, tutorWorkflowCounts } from '@/app/lib/dataLab/bootstrap/service';

interface NavigationItem {
  href: string;
  label: string;
  count?: number;
}

function NavigationGroup({ label, items }: { label: string; items: NavigationItem[] }) {
  return <div>
    <div className="px-3 pb-1 pt-3 text-xs font-medium text-gray-400">{label}</div>
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">{items.map((item) => <Link key={item.href} href={item.href} className="flex min-h-10 items-center justify-between gap-2 rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-950"><span>{item.label}</span>{Boolean(item.count) && <span className="min-w-6 rounded-full bg-red-100 px-1.5 py-0.5 text-center text-xs font-medium text-red-700">{item.count}</span>}</Link>)}</div>
  </div>;
}

export default async function DataLabLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (!canUseDataLab(user.role)) redirect('/');

  const workflow = user.role === 'admin' ? await tutorWorkflowCounts() : null;
  const personalQueue = user.role === 'admin' ? 0 : await tutorPersonalQueueCount(user);
  const adminGroups: Array<{ label: string; items: NavigationItem[] }> = workflow ? [
    { label: '指挥台', items: [{ href: '/data-lab', label: '流水线概览' }] },
    { label: '数据生产', items: [
      { href: '/data-lab/topic-cards', label: '话题库', count: workflow.topicDrafts },
      { href: '/data-lab/case-generation', label: '案例批次', count: workflow.casesReady },
      { href: '/data-lab/first-review', label: '初审工作台', count: workflow.editPending },
      { href: '/data-lab/final-confirmation', label: '定稿工作台', count: workflow.confirmPending },
      { href: '/data-lab/case-quality', label: '案例退回处理', count: workflow.caseQualityPending },
    ] },
    { label: '数据交付', items: [{ href: '/data-lab/releases', label: '数据版本' }] },
    { label: '模型迭代', items: [{ href: '/data-lab/models', label: '模型档案' }] },
    { label: '后台', items: [
      { href: '/data-lab/users', label: '后台账号' },
      { href: '/data-lab/history', label: '历史数据' },
    ] },
  ] : [];

  const personalGroups: Array<{ label: string; items: NavigationItem[] }> = [
    { label: '我的工作', items: [
      { href: '/data-lab', label: '待办概览', count: personalQueue },
      ...(user.role === 'annotator' ? [{ href: '/data-lab/first-review', label: '初审工作台', count: personalQueue }] : []),
      ...(user.role === 'reviewer' ? [{ href: '/data-lab/final-confirmation', label: '定稿工作台', count: personalQueue }] : []),
    ] },
  ];

  return <main className="min-h-screen bg-gray-50 text-gray-900">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-4 py-3 lg:px-6"><div className="min-w-0"><Link href="/data-lab" className="text-lg font-semibold text-gray-950">Hyacintech Data Lab</Link><p className="text-xs text-gray-500">教学数据生产、交付与模型迭代登记</p></div><AuthNav /></div></header>
    <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="border-r bg-white px-3 py-3 lg:min-h-[calc(100vh-65px)]"><nav className="space-y-1">{(user.role === 'admin' ? adminGroups : personalGroups).map((group) => <NavigationGroup key={group.label} {...group} />)}</nav></aside>
      <section className="min-w-0 p-4 lg:p-6">{children}</section>
    </div>
  </main>;
}
