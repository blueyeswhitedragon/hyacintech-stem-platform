import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { getTeacherStats } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';

export default async function TeacherDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (user.role !== 'teacher') redirect('/');

  const stats = await getTeacherStats(user.id);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold text-blue-600">教师工作台</h1>
          <AuthNav />
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <p className="text-gray-600">欢迎，{user.displayName}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="班级数" value={stats.classCount} />
          <StatCard label="学生数" value={stats.studentCount} />
          <StatCard label="作业数" value={stats.assignmentCount} />
          <StatCard label="待审核" value={stats.pendingCount} highlight={stats.pendingCount > 0} />
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href="/teacher/classes" className="bg-white border rounded-lg px-4 py-3 hover:shadow-sm">
            🏫 管理班级
          </Link>
          <Link href="/teacher/assignments" className="bg-white border rounded-lg px-4 py-3 hover:shadow-sm">
            📚 发布作业
          </Link>
          <Link href="/teacher/review" className="bg-white border rounded-lg px-4 py-3 hover:shadow-sm">
            📝 待审核{stats.pendingCount > 0 ? `（${stats.pendingCount}）` : ''}
          </Link>
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="bg-white border rounded-lg p-5">
      <div className={`text-3xl font-bold ${highlight ? 'text-amber-600' : 'text-blue-600'}`}>{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  );
}
