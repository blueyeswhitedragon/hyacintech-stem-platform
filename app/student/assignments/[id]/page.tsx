import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { ensureStudentConversation } from '@/app/lib/conversation';
import { db } from '@/app/lib/db';
import AuthNav from '@/app/components/AuthNav';
import ConversationWorkspace from '@/app/components/ConversationWorkspace';

export default async function StudentConversationPage(
  ctx: PageProps<'/student/assignments/[id]'>
) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (user.role !== 'student') redirect('/');

  const { id: assignmentId } = await ctx.params;

  const result = await ensureStudentConversation(assignmentId, user.id);
  if (!result.ok) {
    if (result.error === 'not_found') notFound();
    redirect('/student/assignments');
  }

  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: { title: true },
  });

  return (
    <main className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b p-4 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/student/assignments" className="text-blue-600 hover:underline text-sm">
              ← 我的作业
            </Link>
            <h1 className="text-lg font-bold text-blue-600">{assignment?.title ?? '科学探究'}</h1>
          </div>
          <AuthNav />
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto p-4 min-h-0">
        <div className="h-[calc(100vh-8rem)]">
          <ConversationWorkspace
            conversationId={result.conversationId}
            initialMessages={result.messages}
            initialStage={result.currentStage}
            initialStageData={result.stageData}
            initialStatus={result.status}
          />
        </div>
      </div>
    </main>
  );
}
