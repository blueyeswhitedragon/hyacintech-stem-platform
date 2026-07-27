import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionState } from '@/app/lib/session';
import { loginRedirectPath } from '@/app/lib/roles';
import { getTeacherStats } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import Card from '@/app/components/ui/Card';

export default async function TeacherDashboardPage() {
  const sessionState = await getSessionState();
  if (!sessionState.user) redirect(loginRedirectPath(sessionState.reason));
  const user = sessionState.user;
  if (user.role !== 'teacher') redirect('/');

  const stats = await getTeacherStats(user.id);

  return (
    <main className="density-roomy min-h-screen bg-canvas">
      <header className="border-b border-hairline bg-canvas p-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <h1 className="display-sm">教师工作台</h1>
          <AuthNav />
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <p className="text-muted">欢迎，{user.displayName}</p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="班级数" value={stats.classCount} />
          <StatCard label="学生数" value={stats.studentCount} />
          <StatCard label="作业数" value={stats.assignmentCount} />
          <StatCard label="待审核" value={stats.pendingCount} highlight={stats.pendingCount > 0} />
        </div>

        <nav className="flex flex-wrap gap-3">
          <NavCard href="/teacher/classes" label="管理班级" hint="创建班级、查看名单与邀请码" />
          <NavCard href="/teacher/assignments" label="发布作业" hint="布置探究任务并设置截止时间" />
          <NavCard
            href="/teacher/review"
            label={`待审核${stats.pendingCount > 0 ? `（${stats.pendingCount}）` : ''}`}
            hint="审阅学生的方案与报告"
            urgent={stats.pendingCount > 0}
          />
        </nav>
      </div>
    </main>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card tone="soft">
      {/* 只有「待审核 > 0」才是待办，用珊瑚；其余是中性统计数字，不该抢注意力。 */}
      <div className={`font-lineage text-3xl ${highlight ? 'text-coral' : 'text-ink'}`}>{value}</div>
      <div className="caption-upper mt-1.5">{label}</div>
    </Card>
  );
}

function NavCard({ href, label, hint, urgent }: { href: string; label: string; hint: string; urgent?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex-1 basis-56 rounded-lg border px-4 py-3 transition-colors duration-[120ms] ${
        urgent ? 'border-coral/45 bg-coral/8 hover:bg-coral/12' : 'border-hairline bg-canvas hover:bg-surface-soft'
      }`}
    >
      <div className="font-medium text-ink">{label}</div>
      <div className="mt-0.5 text-xs leading-5 text-muted">{hint}</div>
    </Link>
  );
}
