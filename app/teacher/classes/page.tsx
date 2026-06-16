import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { getTeacherClasses } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import CreateClassForm from '@/app/components/CreateClassForm';

export default async function TeacherClassesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (user.role !== 'teacher') redirect('/');

  const classes = await getTeacherClasses(user.id);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/teacher/dashboard" className="text-blue-600 hover:underline text-sm">
              ← 工作台
            </Link>
            <h1 className="text-xl font-bold text-blue-600">我的班级</h1>
          </div>
          <AuthNav />
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3">创建新班级</h2>
          <CreateClassForm />
        </div>

        {classes.length === 0 ? (
          <p className="text-gray-500">还没有班级，先创建一个吧。</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {classes.map((c) => (
              <Link
                key={c.id}
                href={`/teacher/classes/${c.id}`}
                className="bg-white border rounded-lg p-5 hover:shadow-sm block"
              >
                <div className="font-medium text-gray-900">{c.name}</div>
                <div className="text-sm text-gray-500 mt-2">
                  邀请码 <span className="font-mono font-semibold tracking-widest text-blue-600">{c.inviteCode}</span>
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  {c._count.members} 名学生 · {c._count.assignments} 个作业
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
