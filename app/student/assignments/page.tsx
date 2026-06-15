import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { getStudentAssignments } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import StartAssignmentButton from '@/app/components/StartAssignmentButton';

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '进行中',
  PENDING_STAGE2: '待审核(方案)',
  PENDING_STAGE5: '待审核(报告)',
  COMPLETED: '已完成',
};

export default async function StudentAssignmentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (user.role !== 'student') redirect('/');

  const assignments = await getStudentAssignments(user.id);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/student/dashboard" className="text-blue-600 hover:underline text-sm">
              ← 主页
            </Link>
            <h1 className="text-xl font-bold text-blue-600">我的作业</h1>
          </div>
          <AuthNav />
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
        {assignments.length === 0 ? (
          <p className="text-gray-500">还没有作业。先在主页用邀请码加入班级。</p>
        ) : (
          assignments.map((a) => (
            <div key={a.assignmentId} className="bg-white border rounded-lg p-5 flex items-start justify-between gap-4">
              <div>
                <div className="font-medium text-gray-900">{a.title}</div>
                <div className="text-sm text-gray-500 mt-1">
                  班级：{a.className}
                  {a.topicDirection && <> · 方向：{a.topicDirection}</>}
                  {a.dueDate && <> · 截止：{new Date(a.dueDate).toLocaleDateString('zh-CN')}</>}
                </div>
                <div className="text-sm mt-2">
                  <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                  {a.currentStage > 0 && (
                    <span className="text-gray-400 ml-2">阶段 {a.currentStage}/6</span>
                  )}
                </div>
              </div>
              <StartAssignmentButton
                assignmentId={a.assignmentId}
                started={a.status !== 'NOT_STARTED'}
              />
            </div>
          ))
        )}
      </div>
    </main>
  );
}
