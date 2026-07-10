import { redirect } from 'next/navigation';
import Link from 'next/link';
import AuthNav from '@/app/components/AuthNav';
import { getCurrentUser } from '@/app/lib/session';
import { canUseDataLab } from '@/app/lib/dataLab/service';

const links = [
  ['/data-lab', '概览'],
  ['/data-lab/batches', '数据批次'],
  ['/data-lab/campaigns', '标注活动'],
  ['/data-lab/annotate', '我的标注'],
  ['/data-lab/review', '复审仲裁'],
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
          <nav className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
            {links.map(([href, label]) => {
              if (href === '/data-lab/users' && user.role !== 'admin') return null;
              if (['/data-lab/batches', '/data-lab/campaigns', '/data-lab/releases', '/data-lab/training-runs', '/data-lab/evaluations'].includes(href) && user.role !== 'admin') return null;
              if (href === '/data-lab/review' && user.role === 'annotator') return null;
              return <Link key={href} href={href} className="rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-950">{label}</Link>;
            })}
          </nav>
        </aside>
        <section className="min-w-0 p-4 lg:p-6">{children}</section>
      </div>
    </main>
  );
}
