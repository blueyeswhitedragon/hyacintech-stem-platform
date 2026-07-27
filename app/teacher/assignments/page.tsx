import { redirect } from 'next/navigation';
import { getSessionState } from '@/app/lib/session';
import { loginRedirectPath } from '@/app/lib/roles';
import { db } from '@/app/lib/db';
import { getTeacherClasses } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import PublishAssignmentForm from '@/app/components/PublishAssignmentForm';
import DataContributionToggle from '@/app/components/DataContributionToggle';
import { styleSelectionLabel } from '@/app/lib/stylePolicy';
import Badge from '@/app/components/ui/Badge';
import Card, { SectionHeader } from '@/app/components/ui/Card';
import EmptyState from '@/app/components/ui/EmptyState';
import PageHeader from '@/app/components/ui/PageHeader';

export default async function TeacherAssignmentsPage() {
  const sessionState = await getSessionState();
  if (!sessionState.user) redirect(loginRedirectPath(sessionState.reason));
  const user = sessionState.user;
  if (user.role !== 'teacher') redirect('/');

  const classes = await getTeacherClasses(user.id);
  const classIds = classes.map((c) => c.id);

  const assignments = await db.assignment.findMany({
    where: { classId: { in: classIds } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      topicDirection: true,
      assistantStyleFamily: true,
      dataContributionMode: true,
      dueDate: true,
      class: { select: { name: true } },
      _count: { select: { studentAssignments: true } },
    },
  });

  return (
    <main className="density-roomy min-h-screen bg-canvas">
      <PageHeader title="作业管理" backHref="/teacher/dashboard" backLabel="工作台" actions={<AuthNav />} />

      <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
        <Card tone="soft">
          <h2 className="display-sm mb-4">发布新作业</h2>
          <PublishAssignmentForm classes={classes.map((c) => ({ id: c.id, name: c.name }))} />
        </Card>

        <section>
          <SectionHeader title="已发布作业" />
          {assignments.length === 0 ? (
            <EmptyState
              art="doc"
              title="还没有发布过作业"
              description={
                classes.length === 0
                  ? '先去「管理班级」创建一个班级，才能给它布置作业。'
                  : '用上方的表单选班级、写标题，就能布置第一份探究任务。'
              }
            />
          ) : (
            <div className="space-y-3">
              {assignments.map((a) => (
                <Card key={a.id}>
                  <div className="font-medium text-ink">{a.title}</div>
                  <div className="mt-1 text-sm text-muted">
                    班级：{a.class.name}
                    {a.topicDirection && <> · 方向：{a.topicDirection}</>}
                    <> · 导师风格：{styleSelectionLabel(a.assistantStyleFamily)}</>
                    {a.dueDate && <> · 截止：{new Date(a.dueDate).toLocaleDateString('zh-CN')}</>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* 数据回流开着才值得标注——关闭是默认态，不需要占一个徽章。 */}
                    {a.dataContributionMode === 'CONSENT_REQUIRED' ? (
                      <Badge tone="info">数据回流：学生自愿授权</Badge>
                    ) : (
                      <span className="text-sm text-muted-soft">数据回流：关闭</span>
                    )}
                    <DataContributionToggle
                      assignmentId={a.id}
                      enabled={a.dataContributionMode === 'CONSENT_REQUIRED'}
                    />
                    <span className="text-sm text-muted-soft">· {a._count.studentAssignments} 名学生已开始</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
