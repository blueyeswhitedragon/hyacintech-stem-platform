import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { db } from '@/app/lib/db';
import { getTeacherClasses } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import PublishAssignmentForm from '@/app/components/PublishAssignmentForm';

export default async function TeacherAssignmentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
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
      dueDate: true,
      class: { select: { name: true } },
      _count: { select: { studentAssignments: true } },
    },
  });

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/teacher/dashboard" className="text-blue-600 hover:underline text-sm">
              ← 工作台
            </Link>
            <h1 className="text-xl font-bold text-blue-600">作业管理</h1>
          </div>
          <AuthNav />
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3">发布新作业</h2>
          <PublishAssignmentForm classes={classes.map((c) => ({ id: c.id, name: c.name }))} />
        </div>

        <section>
          <h2 className="font-medium mb-3">已发布作业</h2>
          {assignments.length === 0 ? (
            <p className="text-gray-500">还没有发布过作业。</p>
          ) : (
            <div className="space-y-3">
              {assignments.map((a) => (
                <div key={a.id} className="bg-white border rounded-lg p-4">
                  <div className="font-medium text-gray-900">{a.title}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    班级：{a.class.name}
                    {a.topicDirection && <> · 方向：{a.topicDirection}</>}
                    {a.dueDate && <> · 截止：{new Date(a.dueDate).toLocaleDateString('zh-CN')}</>}
                  </div>
                  <div className="text-sm text-gray-400 mt-1">{a._count.studentAssignments} 名学生已开始</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
