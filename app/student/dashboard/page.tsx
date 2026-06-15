import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { getStudentClasses } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import JoinClassForm from '@/app/components/JoinClassForm';

export default async function StudentDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (user.role !== 'student') redirect('/');

  const memberships = await getStudentClasses(user.id);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold text-blue-600">学生主页</h1>
          <AuthNav />
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-gray-600">欢迎，{user.displayName}</p>
          <Link href="/student/assignments" className="text-blue-600 hover:underline text-sm">
            查看我的作业 →
          </Link>
        </div>

        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3">加入新班级</h2>
          <JoinClassForm />
        </div>

        <section>
          <h2 className="font-medium mb-3">我加入的班级</h2>
          {memberships.length === 0 ? (
            <p className="text-gray-500">还没有加入任何班级。向老师索取邀请码后在上方加入。</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {memberships.map((m) => (
                <div key={m.class.id} className="bg-white border rounded-lg p-5">
                  <div className="font-medium text-gray-900">{m.class.name}</div>
                  <div className="text-sm text-gray-500 mt-2">教师：{m.class.teacher.displayName}</div>
                  <div className="text-sm text-gray-400 mt-1">{m.class._count.assignments} 个作业</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
