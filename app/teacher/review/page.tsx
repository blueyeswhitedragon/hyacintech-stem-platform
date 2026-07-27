import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSessionState } from '@/app/lib/session';
import { loginRedirectPath } from '@/app/lib/roles';
import { getPendingReviews, getOptionalStage3Reviews, getStuckStudents } from '@/app/lib/queries';
import AuthNav from '@/app/components/AuthNav';
import Badge, { type BadgeTone } from '@/app/components/ui/Badge';
import EmptyState from '@/app/components/ui/EmptyState';
import PageHeader from '@/app/components/ui/PageHeader';
import Pager from '@/app/components/ui/Pager';
import { SectionHeader } from '@/app/components/ui/Card';

/**
 * 两个列表（必审 / 可选过目）原本是同一段 markup 复制两遍，
 * 只有徽章文案与提名计数的来源不同。
 */
function ReviewRow({
  href, studentName, username, context, note, badge, badgeTone,
}: {
  href: string; studentName: string; username: string;
  context: string; note?: ReactNode; badge: string; badgeTone: BadgeTone;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-hairline bg-canvas [padding:var(--pad-card)] transition-colors duration-[120ms] hover:bg-surface-soft"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium text-ink">
            {studentName}
            <span className="ml-1 font-normal text-muted-soft">@{username}</span>
          </div>
          <div className="mt-1 text-sm text-muted">{context}</div>
          {note && <div className="mt-1 text-xs text-muted-soft">{note}</div>}
        </div>
        <Badge tone={badgeTone}>{badge}</Badge>
      </div>
    </Link>
  );
}

export default async function TeacherReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; s3?: string; st?: string }>;
}) {
  const sessionState = await getSessionState();
  if (!sessionState.user) redirect(loginRedirectPath(sessionState.reason));
  const user = sessionState.user;
  if (user.role !== 'teacher') redirect('/');

  // 三个列表各有自己的页码参数，翻其中一个不影响另外两个。
  const { p, s3, st } = await searchParams;
  const [pending, stage3, stuck] = await Promise.all([
    getPendingReviews(user.id, { page: Number(p) }),
    getOptionalStage3Reviews(user.id, { page: Number(s3) }),
    getStuckStudents(user.id, { page: Number(st) }),
  ]);
  const items = pending.items;
  const stage3Items = stage3.items;

  return (
    <main className="density-roomy min-h-screen bg-canvas">
      <PageHeader title="待审核" backHref="/teacher/dashboard" backLabel="工作台" actions={<AuthNav />} />

      <div className="mx-auto max-w-5xl space-y-10 p-4 md:p-6">
        <section>
          <SectionHeader title="待审核（必审）" description="学生已提交方案或报告，在你给出结论前他们无法继续。" />
          {items.length === 0 ? (
            <EmptyState art="doc" title="没有待审的提交" description="学生提交方案或报告后会出现在这里。" />
          ) : (
            <>
              <div className="space-y-3">
                {items.map((it) => (
                  <ReviewRow
                    key={it.id}
                    href={`/teacher/review/${it.id}`}
                    studentName={it.student.displayName}
                    username={it.student.username}
                    context={`${it.assignment.class.name} · ${it.assignment.title}`}
                    note={
                      it.assignment.dataContributionMode === 'CONSENT_REQUIRED' ? (
                        <>
                          本作业可提名回合：
                          {it.dataConsentStatus === 'GRANTED' && it.conversation?.traceCoverage === 'COMPLETE'
                            ? it.conversation.generationTraces.length
                            : 0}
                          {it.dataConsentStatus !== 'GRANTED'
                            ? '（学生尚未授权）'
                            : it.conversation?.traceCoverage !== 'COMPLETE'
                              ? '（历史轨迹不完整）'
                              : ''}
                        </>
                      ) : undefined
                    }
                    badge={it.status === 'PENDING_STAGE2' ? '待审：方案' : '待审：报告'}
                    badgeTone="coral"
                  />
                ))}
              </div>
              <Pager
                page={pending.page}
                pageCount={pending.pageCount}
                total={pending.total}
                param="p"
                baseQuery={{ s3, st }}
                pathname="/teacher/review"
                unit="份待审"
              />
            </>
          )}
        </section>

        <section>
          <SectionHeader
            title="数据表待过目"
            description="可选，不阻塞学生。学生在第 3 阶段继续采集数据，你可以随时进去看一眼。"
          />
          {stage3Items.length === 0 ? (
            <EmptyState art="chart" title="暂无可过目的数据表" description="学生进入「过程执行」并录入数据后会出现在这里。" />
          ) : (
            <>
              <div className="space-y-3">
                {stage3Items.map((it) => (
                  <ReviewRow
                    key={it.id}
                    href={`/teacher/review/${it.id}`}
                    studentName={it.student.displayName}
                    username={it.student.username}
                    context={`${it.assignment.class.name} · ${it.assignment.title}`}
                    note={
                      it.assignment.dataContributionMode === 'CONSENT_REQUIRED'
                        ? `本作业可提名回合：${it.eligibleTraceCount}`
                        : undefined
                    }
                    badge={`数据表 · 第 ${it.currentStage} 阶段`}
                    badgeTone="neutral"
                  />
                ))}
              </div>
              <Pager
                page={stage3.page}
                pageCount={stage3.pageCount}
                total={stage3.total}
                param="s3"
                baseQuery={{ p, st }}
                pathname="/teacher/review"
                unit="份数据表"
              />
            </>
          )}
        </section>

        <section>
          <SectionHeader
            title="可能卡住的学生"
            description="当前阶段已对话至少 8 轮但仍未推进。进入详情可查看状态；第 2、3、5 阶段可留痕放行。"
          />
          {stuck.items.length === 0 ? (
            <EmptyState art="doc" title="暂无可能卡住的学生" description="达到识别阈值后会出现在这里。" />
          ) : (
            <>
              <div className="space-y-3">
                {stuck.items.map((it) => (
                  <ReviewRow
                    key={it.id}
                    href={`/teacher/review/${it.id}`}
                    studentName={it.student.displayName}
                    username={it.student.username}
                    context={`${it.assignment.class.name} · ${it.assignment.title}`}
                    note={`已对话 ${it.roundCount} 轮 · ${it.reason}`}
                    badge={`第 ${it.currentStage} 阶段`}
                    badgeTone="warning"
                  />
                ))}
              </div>
              <Pager
                page={stuck.page}
                pageCount={stuck.pageCount}
                total={stuck.total}
                param="st"
                baseQuery={{ p, s3 }}
                pathname="/teacher/review"
                unit="名学生"
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
