import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { getPendingReviews, getOptionalStage3Reviews } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';

export default async function TeacherReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (user.role !== 'teacher') redirect('/');

  const [items, stage3Items] = await Promise.all([
    getPendingReviews(user.id),
    getOptionalStage3Reviews(user.id),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/teacher/dashboard" className="text-blue-600 hover:underline text-sm">← 工作台</Link>
            <h1 className="text-xl font-bold text-blue-600">待审核</h1>
          </div>
          <AuthNav />
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-8">
        <section>
          <h2 className="text-sm font-medium text-gray-700 mb-2">待审核（必审）</h2>
          {items.length === 0 ? (
            <p className="text-gray-500">暂无待审核的提交。</p>
          ) : (
            <div className="space-y-3">
              {items.map((it) => (
                <Link
                  key={it.id}
                  href={`/teacher/review/${it.id}`}
                  className="block bg-white border rounded-lg p-4 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-gray-900">
                        {it.student.displayName}
                        <span className="text-gray-400 ml-1">@{it.student.username}</span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {it.assignment.class.name} · {it.assignment.title}
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded text-sm bg-amber-100 text-amber-700">
                      {it.status === 'PENDING_STAGE2' ? '待审：方案' : '待审：报告'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium text-gray-700 mb-2">数据表待过目（可选，不阻塞学生）</h2>
          {stage3Items.length === 0 ? (
            <p className="text-gray-500 text-sm">暂无可过目的数据表。</p>
          ) : (
            <div className="space-y-3">
              {stage3Items.map((it) => (
                <Link
                  key={it.id}
                  href={`/teacher/review/${it.id}`}
                  className="block bg-white border rounded-lg p-4 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-gray-900">
                        {it.student.displayName}
                        <span className="text-gray-400 ml-1">@{it.student.username}</span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {it.assignment.class.name} · {it.assignment.title}
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded text-sm bg-blue-50 text-blue-600">
                      数据表 · 第{it.currentStage}阶段
                    </span>
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
