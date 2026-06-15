import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { getClassDetail } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '进行中',
  PENDING_STAGE2: '待审核(方案)',
  PENDING_STAGE5: '待审核(报告)',
  COMPLETED: '已完成',
};

export default async function TeacherClassDetailPage(
  ctx: PageProps<'/teacher/classes/[id]'>
) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (user.role !== 'teacher') redirect('/');

  const { id } = await ctx.params;
  const klass = await getClassDetail(id);
  if (!klass) notFound();
  if (klass.teacherId !== user.id) redirect('/teacher/classes');

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/teacher/classes" className="text-blue-600 hover:underline text-sm">
              ← 班级列表
            </Link>
            <h1 className="text-xl font-bold text-blue-600">{klass.name}</h1>
          </div>
          <AuthNav />
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div className="text-sm text-gray-500">
          邀请码 <span className="font-mono font-semibold tracking-widest text-blue-600">{klass.inviteCode}</span>
          {' · '}
          {klass.members.length} 名学生 · {klass.assignments.length} 个作业
        </div>

        <section>
          <h2 className="font-medium mb-3">学生进度</h2>
          {klass.members.length === 0 ? (
            <p className="text-gray-500">还没有学生加入。把邀请码发给学生即可加入。</p>
          ) : (
            <div className="overflow-x-auto bg-white border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left p-3">学生</th>
                    {klass.assignments.map((a) => (
                      <th key={a.id} className="text-left p-3 whitespace-nowrap">{a.title}</th>
                    ))}
                    {klass.assignments.length === 0 && <th className="text-left p-3">（暂无作业）</th>}
                  </tr>
                </thead>
                <tbody>
                  {klass.members.map((m) => (
                    <tr key={m.student.id} className="border-t">
                      <td className="p-3 font-medium text-gray-900 whitespace-nowrap">
                        {m.student.displayName}
                        <span className="text-gray-400 ml-1">@{m.student.username}</span>
                      </td>
                      {klass.assignments.map((a) => {
                        const sa = a.studentAssignments.find((s) => s.studentId === m.student.id);
                        const status = sa?.status ?? 'NOT_STARTED';
                        return (
                          <td key={a.id} className="p-3 whitespace-nowrap">
                            <span className="text-gray-700">{STATUS_LABEL[status] ?? status}</span>
                            {sa && sa.currentStage > 0 && (
                              <span className="text-gray-400 ml-1">· 阶段{sa.currentStage}</span>
                            )}
                          </td>
                        );
                      })}
                      {klass.assignments.length === 0 && <td className="p-3 text-gray-400">—</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
