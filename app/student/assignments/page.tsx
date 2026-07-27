import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionState } from '@/app/lib/session';
import { loginRedirectPath } from '@/app/lib/roles';
import { getStudentAssignments } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import StartAssignmentButton from '@/app/components/StartAssignmentButton';
import { styleSelectionLabel } from '@/app/lib/stylePolicy';
import Card from '@/app/components/ui/Card';
import Badge, { type BadgeTone } from '@/app/components/ui/Badge';
import EmptyState from '@/app/components/ui/EmptyState';

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '进行中',
  PENDING_STAGE2: '待审核(方案)',
  PENDING_STAGE5: '待审核(报告)',
  COMPLETED: '已完成',
};

// 状态色只表达"需不需要我做事"：待审核是等别人，用中性；进行中才是待办。
const STATUS_TONE: Record<string, BadgeTone> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'coral',
  PENDING_STAGE2: 'info',
  PENDING_STAGE5: 'info',
  COMPLETED: 'success',
};

export default async function StudentAssignmentsPage() {
  const sessionState = await getSessionState();
  if (!sessionState.user) redirect(loginRedirectPath(sessionState.reason));
  const user = sessionState.user;
  if (user.role !== 'student') redirect('/');

  const assignments = await getStudentAssignments(user.id);

  return (
    <main className="density-roomy min-h-screen bg-canvas">
      <header className="border-b border-hairline bg-canvas px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/student/dashboard" className="text-sm text-muted transition-colors duration-[120ms] hover:text-coral">
              ← 主页
            </Link>
            <h1 className="display-sm">我的作业</h1>
          </div>
          <AuthNav />
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        {assignments.length === 0 ? (
          <EmptyState
            art="box"
            title="还没有作业"
            description="老师发布作业后会出现在这里。如果还没加入班级，先回主页用邀请码加入。"
          />
        ) : (
          assignments.map((a) => (
            <Card key={a.assignmentId} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium text-ink">{a.title}</div>
                <div className="mt-1 text-sm text-muted">
                  班级：{a.className}
                  {a.topicDirection && <> · 方向：{a.topicDirection}</>}
                  <> · 导师风格：{styleSelectionLabel(a.assistantStyleFamily)}</>
                  {a.dueDate && <> · 截止：{new Date(a.dueDate).toLocaleDateString('zh-CN')}</>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{STATUS_LABEL[a.status] ?? a.status}</Badge>
                  {a.currentStage > 0 && (
                    <span className="text-xs text-muted-soft">阶段 {a.currentStage}/6</span>
                  )}
                </div>
              </div>
              <StartAssignmentButton
                assignmentId={a.assignmentId}
                started={a.status !== 'NOT_STARTED'}
                completed={a.status === 'COMPLETED'}
              />
            </Card>
          ))
        )}
      </div>
    </main>
  );
}
