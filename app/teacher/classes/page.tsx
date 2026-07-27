import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionState } from '@/app/lib/session';
import { loginRedirectPath } from '@/app/lib/roles';
import { getTeacherClasses } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import CreateClassForm from '@/app/components/CreateClassForm';
import Card, { SectionHeader } from '@/app/components/ui/Card';
import EmptyState from '@/app/components/ui/EmptyState';
import PageHeader from '@/app/components/ui/PageHeader';

export default async function TeacherClassesPage() {
  const sessionState = await getSessionState();
  if (!sessionState.user) redirect(loginRedirectPath(sessionState.reason));
  const user = sessionState.user;
  if (user.role !== 'teacher') redirect('/');

  const classes = await getTeacherClasses(user.id);

  return (
    <main className="density-roomy min-h-screen bg-canvas">
      <PageHeader title="我的班级" backHref="/teacher/dashboard" backLabel="工作台" actions={<AuthNav />} />

      <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
        <Card tone="soft">
          <h2 className="display-sm mb-4">创建新班级</h2>
          <CreateClassForm />
        </Card>

        <section>
          <SectionHeader title="班级列表" />
          {classes.length === 0 ? (
            <EmptyState
              art="box"
              title="还没有班级"
              description="先在上方创建一个班级，系统会生成邀请码；把邀请码发给学生，他们就能加入。"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {classes.map((c) => (
                <Link
                  key={c.id}
                  href={`/teacher/classes/${c.id}`}
                  className="block rounded-lg border border-hairline bg-canvas [padding:var(--pad-card)] transition-colors duration-[120ms] hover:bg-surface-soft"
                >
                  <div className="font-medium text-ink">{c.name}</div>
                  <div className="mt-2 text-sm text-muted">
                    邀请码 <span className="font-lineage tracking-[0.2em] text-ink">{c.inviteCode}</span>
                  </div>
                  <div className="mt-1 text-sm text-muted-soft">
                    {c._count.members} 名学生 · {c._count.assignments} 个作业
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
