import { redirect } from 'next/navigation';
import Link from 'next/link';
import AuthNav from '@/app/components/AuthNav';
import DataLabNav, { type NavigationGroupData } from '@/app/components/dataLab/DataLabNav';
import { getCurrentUser } from '@/app/lib/session';
import { canUseDataLab } from '@/app/lib/dataLab/service';
import { tutorPersonalQueueCount, tutorWorkflowCounts } from '@/app/lib/dataLab/bootstrap/service';

export default async function DataLabLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (!canUseDataLab(user.role)) redirect('/');

  const workflow = user.role === 'admin' ? await tutorWorkflowCounts() : null;
  const personalQueue = user.role === 'admin' ? 0 : await tutorPersonalQueueCount(user);
  const adminGroups: NavigationGroupData[] = workflow ? [
    { label: '指挥台', items: [{ href: '/data-lab', label: '流水线概览' }] },
    { label: '数据生产', items: [
      { href: '/data-lab/topic-cards', label: '话题库', count: workflow.topicDrafts },
      { href: '/data-lab/candidates', label: '线上候选审核', count: workflow.productionCandidatesPending },
      { href: '/data-lab/case-generation', label: '案例批次', count: workflow.casesReady },
      { href: '/data-lab/first-review', label: '初审工作台', count: workflow.editPending },
      { href: '/data-lab/final-confirmation', label: '定稿工作台', count: workflow.confirmPending },
      { href: '/data-lab/case-quality', label: '案例退回处理', count: workflow.caseQualityPending },
    ] },
    { label: '数据交付', items: [{ href: '/data-lab/releases', label: '数据版本' }] },
    { label: '模型迭代', items: [
      { href: '/data-lab/ai-services', label: 'AI 服务' },
      { href: '/data-lab/prompt-policies', label: 'Prompt 策略' },
      { href: '/data-lab/models', label: '模型与训练' },
      { href: '/data-lab/runtime-bundles', label: '运行组合' },
      { href: '/data-lab/evaluations', label: '评测与部署' },
    ] },
    { label: '后台', items: [
      { href: '/data-lab/setup', label: '环境检查' },
      { href: '/data-lab/traces', label: '生成追踪' },
      { href: '/data-lab/users', label: '后台账号' },
      { href: '/data-lab/history', label: '历史数据' },
    ] },
  ] : [];

  const personalGroups: NavigationGroupData[] = [
    { label: '我的工作', items: [
      { href: '/data-lab', label: '待办概览', count: personalQueue },
      ...(user.role === 'annotator' ? [{ href: '/data-lab/first-review', label: '初审工作台', count: personalQueue }] : []),
      ...(user.role === 'reviewer' ? [{ href: '/data-lab/final-confirmation', label: '定稿工作台', count: personalQueue }] : []),
    ] },
  ];

  const navigationGroups = user.role === 'admin' ? adminGroups : personalGroups;

  // 侧栏用 surface-soft、正文区用 canvas：同属奶油色系但有一档明度差，
  // 不引入第四种表面色也能让导航从内容里分离出来。
  // density-compact：Data Lab 的使用者整天在比对版本号、状态和计数，
  // 信息密度优先于呼吸感——与学生端的 density-roomy 共用同一套颜色与圆角令牌。
  return <main className="density-compact min-h-screen bg-canvas text-body">
    <header className="border-b border-b-hairline border-hairline bg-canvas"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 lg:px-6"><div className="min-w-0"><Link href="/data-lab" className="display-sm">Hyacintech <span className="font-lineage">Data Lab</span></Link><p className="mt-0.5 text-[13px] text-muted">教学数据生产、交付与模型迭代登记</p></div><AuthNav /></div></header>
    <details className="border-b border-b-hairline border-hairline bg-surface-soft px-4 py-2 lg:hidden">
      <summary className="cursor-pointer py-1 text-sm font-medium text-ink">Data Lab 导航</summary>
      <nav className="pb-3 pt-1"><DataLabNav groups={navigationGroups} /></nav>
    </details>
    <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="hidden border-r border-r-hairline border-hairline bg-surface-soft px-3 pb-6 pt-1 lg:block lg:min-h-[calc(100vh-69px)]"><nav className="sticky top-4 space-y-0.5"><DataLabNav groups={navigationGroups} /></nav></aside>
      <section className="min-w-0 p-5 lg:p-8">{children}</section>
    </div>
  </main>;
}
