import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getSessionState } from '@/app/lib/session';
import { loginRedirectPath } from '@/app/lib/roles';
import { ensureStudentConversation } from '@/app/lib/conversation';
import { db } from '@/app/lib/db';
import AuthNav from '@/app/components/AuthNav';
import ConversationWorkspace from '@/app/components/ConversationWorkspace';
import DataConsentCard from '@/app/components/DataConsentCard';
import { advanceHint } from '@/app/lib/advanceHint';
import { deterministicSafetyQuiz } from '@/app/lib/serverTutorState';

export default async function StudentConversationPage(
  ctx: PageProps<'/student/assignments/[id]'>
) {
  const sessionState = await getSessionState();
  if (!sessionState.user) redirect(loginRedirectPath(sessionState.reason));
  const user = sessionState.user;
  if (user.role !== 'student') redirect('/');

  const { id: assignmentId } = await ctx.params;

  const result = await ensureStudentConversation(assignmentId, user.id);
  if (!result.ok) {
    if (result.error === 'not_found') notFound();
    redirect('/student/assignments');
  }

  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      title: true,
      dueDate: true,
      dataContributionMode: true,
      studentAssignments: {
        where: { studentId: user.id },
        select: { id: true, dataConsentStatus: true },
        take: 1,
      },
    },
  });
  const fallbackSafetyQuiz = result.currentStage === 3 && !result.safetyQuizCompleted
    ? result.stageData.stage3?.safetyQuiz ?? deterministicSafetyQuiz(result.stageData)
    : null;

  return (
    <main className="density-roomy flex min-h-screen flex-col bg-canvas">
      <header className="flex-shrink-0 border-b border-hairline bg-canvas px-4 py-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/student/assignments" className="shrink-0 text-sm text-muted transition-colors duration-[120ms] hover:text-coral">
              ← 我的作业
            </Link>
            <h1 className="display-sm min-w-0 truncate">{assignment?.title ?? '科学探究'}</h1>
          </div>
          <div className="self-end sm:self-auto">
            <AuthNav />
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto p-4 min-h-0">
        {assignment?.dataContributionMode === 'CONSENT_REQUIRED' && assignment.studentAssignments[0] && (
          <DataConsentCard
            studentAssignmentId={assignment.studentAssignments[0].id}
            initialStatus={assignment.studentAssignments[0].dataConsentStatus}
          />
        )}
        <div className="h-[calc(100vh-8rem)]">
          <ConversationWorkspace
            conversationId={result.conversationId}
            initialMessages={result.messages}
            initialStage={result.currentStage}
            initialStageData={result.stageData}
            initialStatus={result.status}
            initialSafetyQuizCompleted={result.safetyQuizCompleted}
            initialAdvanceHint={advanceHint({
              currentStage: result.currentStage,
              stageData: result.stageData,
              safetyQuizCompleted: result.safetyQuizCompleted,
            })}
            initialSafetyQuiz={fallbackSafetyQuiz
              ? { question: fallbackSafetyQuiz.question, options: fallbackSafetyQuiz.options }
              : null}
            initialDueDate={assignment?.dueDate?.toISOString() ?? null}
          />
        </div>
      </div>
    </main>
  );
}
