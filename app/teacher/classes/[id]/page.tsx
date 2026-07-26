import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/app/lib/session';
import { getClassDetail } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import Badge, { type BadgeTone } from '@/app/components/ui/Badge';
import EmptyState from '@/app/components/ui/EmptyState';
import PageHeader from '@/app/components/ui/PageHeader';
import Table, { TBody, TD, TH, THead, TR } from '@/app/components/ui/Table';

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '进行中',
  PENDING_STAGE2: '待审核(方案)',
  PENDING_STAGE5: '待审核(报告)',
  COMPLETED: '已完成',
};

// 与学生端同一套语义：珊瑚=待老师处理，绿=已完成，中性=学生在做或还没开始。
// 注意这里和学生端的 tone 不同——"待审核"对学生是「在等别人」，对老师就是待办。
const STATUS_TONE: Record<string, BadgeTone> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'neutral',
  PENDING_STAGE2: 'coral',
  PENDING_STAGE5: 'coral',
  COMPLETED: 'success',
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
    <main className="density-roomy min-h-screen bg-canvas">
      <PageHeader title={klass.name} backHref="/teacher/classes" backLabel="班级列表" actions={<AuthNav />} />

      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div className="text-sm text-muted">
          邀请码 <span className="font-lineage tracking-[0.2em] text-ink">{klass.inviteCode}</span>
          {' · '}
          {klass.members.length} 名学生 · {klass.assignments.length} 个作业
        </div>

        <section>
          <h2 className="display-sm mb-3">学生进度</h2>
          {klass.members.length === 0 ? (
            <EmptyState
              art="search"
              title="还没有学生加入"
              description={`把邀请码 ${klass.inviteCode} 发给学生，他们在「加入新班级」里填入就会出现在这张进度表里。`}
            />
          ) : (
            /* 进度表是横向比对多个作业的密集网格，用紧凑密度，一屏能多看几行学生。 */
            <div className="density-compact">
              <Table>
                <THead>
                  <TR>
                    <TH>学生</TH>
                    {klass.assignments.map((a) => (
                      <TH key={a.id}>{a.title}</TH>
                    ))}
                    {klass.assignments.length === 0 && <TH>（暂无作业）</TH>}
                  </TR>
                </THead>
                <TBody>
                  {klass.members.map((m) => (
                    <TR key={m.student.id}>
                      <TD className="whitespace-nowrap font-medium text-ink">
                        {m.student.displayName}
                        <span className="ml-1 font-normal text-muted-soft">@{m.student.username}</span>
                      </TD>
                      {klass.assignments.map((a) => {
                        const sa = a.studentAssignments.find((s) => s.studentId === m.student.id);
                        const status = sa?.status ?? 'NOT_STARTED';
                        return (
                          <TD key={a.id} className="whitespace-nowrap">
                            <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</Badge>
                            {sa && sa.currentStage > 0 && (
                              <span className="ml-1.5 text-xs tabular-nums text-muted-soft">阶段 {sa.currentStage}</span>
                            )}
                          </TD>
                        );
                      })}
                      {klass.assignments.length === 0 && <TD className="text-muted-soft">—</TD>}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
