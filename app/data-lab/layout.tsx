import { redirect } from 'next/navigation';
import Link from 'next/link';
import AuthNav from '@/app/components/AuthNav';
import { getCurrentUser } from '@/app/lib/session';
import { canUseDataLab } from '@/app/lib/dataLab/service';

const primaryAdminLinks = [
  ['/data-lab', '概览'],
  ['/data-lab/campaigns', '任务分配'],
  ['/data-lab/workload', '有效标注统计'],
  ['/data-lab/review', '数据仲裁'],
] as const;

const advancedAdminLinks = [
  ['/data-lab/batches', '数据批次'],
  ['/data-lab/releases', '数据版本'],
  ['/data-lab/training-runs', '训练登记'],
  ['/data-lab/evaluations', '双盲评测'],
  ['/data-lab/users', '后台账号'],
] as const;

export default async function DataLabLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (!canUseDataLab(user.role)) redirect('/');
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-4 py-3 lg:px-6">
          <div className="min-w-0">
            <Link href="/data-lab" className="text-lg font-semibold text-gray-950">Hyacintech Data Lab</Link>
            <p className="text-xs text-gray-500">STEM 教学模型数据闭环</p>
          </div>
          <AuthNav />
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-r bg-white px-3 py-5 lg:min-h-[calc(100vh-65px)]">
          {user.role === 'admin' ? <nav className="space-y-3"><div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">{primaryAdminLinks.map(([href, label]) => <Link key={href} href={href} className="rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-950">{label}</Link>)}</div><details className="rounded-lg border bg-gray-50 p-2"><summary className="cursor-pointer px-2 py-1 text-xs font-medium text-gray-600">高级管理</summary><div className="mt-1 grid gap-1">{advancedAdminLinks.map(([href, label]) => <Link key={href} href={href} className="rounded px-3 py-2 text-sm text-gray-700 hover:bg-white hover:text-gray-950">{label}</Link>)}</div></details></nav> : <nav className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1"><Link href="/data-lab" className="rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">概览</Link>{user.role === 'annotator' && <Link href="/data-lab/annotate" className="rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">我的标注</Link>}{user.role === 'reviewer' && <Link href="/data-lab/review" className="rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">数据仲裁</Link>}</nav>}
        </aside>
        <section className="min-w-0 p-4 lg:p-6">{children}</section>
      </div>
    </main>
  );
}
