import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { getStudentClasses } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import JoinClassForm from '@/app/components/JoinClassForm';
import Card, { SectionHeader } from '@/app/components/ui/Card';
import EmptyState from '@/app/components/ui/EmptyState';

export default async function StudentDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (user.role !== 'student') redirect('/');

  const memberships = await getStudentClasses(user.id);

  return (
    <main className="density-roomy min-h-screen bg-canvas">
      <header className="border-b border-hairline bg-canvas px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <h1 className="display-sm">学生主页</h1>
          <AuthNav />
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted">欢迎，{user.displayName}</p>
          <Link href="/student/assignments" className="text-sm text-coral transition-colors duration-[120ms] hover:text-coral-active">
            查看我的作业 →
          </Link>
        </div>

        <Card tone="soft">
          <h2 className="display-sm mb-4">加入新班级</h2>
          <JoinClassForm />
        </Card>

        <section>
          <SectionHeader title="我加入的班级" />
          {memberships.length === 0 ? (
            <EmptyState
              art="search"
              title="还没有加入任何班级"
              description="班级由老师创建。向老师索取邀请码后，在上方「加入新班级」里填入即可。"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {memberships.map((m) => (
                <Card key={m.class.id}>
                  <div className="font-medium text-ink">{m.class.name}</div>
                  <div className="mt-2 text-sm text-muted">教师：{m.class.teacher.displayName}</div>
                  <div className="mt-1 text-sm text-muted-soft">{m.class._count.assignments} 个作业</div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
