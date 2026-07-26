import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/app/lib/session';
import { getReviewItem } from '@/app/lib/queries';
import { parseStageData } from '@/app/lib/conversation';
import AuthNav from '@/app/components/AuthNav';
import ReviewActionForm from '@/app/components/ReviewActionForm';
import CandidateNominationPanel from '@/app/components/CandidateNominationPanel';
import ReadonlyDataTable from '@/app/components/ReadonlyDataTable';
import { limitationsDiscussion } from '@/app/lib/reportFields';
import Badge from '@/app/components/ui/Badge';
import Callout from '@/app/components/ui/Callout';
import Card from '@/app/components/ui/Card';
import PageHeader from '@/app/components/ui/PageHeader';
import Table, { TBody, TD, TH, THead, TR } from '@/app/components/ui/Table';
import { releasedTraceBlockReason } from '@/app/lib/releasePolicy';

export default async function TeacherReviewDetailPage(ctx: PageProps<'/teacher/review/[id]'>) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (user.role !== 'teacher') redirect('/');

  const { id } = await ctx.params;
  const item = await getReviewItem(id);
  if (!item) notFound();
  if (item.assignment.class.teacherId !== user.id) redirect('/teacher/review');

  const stageData = parseStageData(item.conversation?.stageData ?? '{}');
  // 待审按状态定位；卡住列表进入详情时按学生当前阶段提供留痕放行。
  const reviewStage: 2 | 3 | 4 | 5 | null =
    item.status === 'PENDING_STAGE2'
      ? 2
      : item.status === 'PENDING_STAGE5'
        ? 5
        : item.currentStage === 2 || item.currentStage === 5
          ? item.currentStage
          : item.currentStage === 3 || item.currentStage === 4
            ? item.currentStage
            : null;
  const riskCols = new Set(
    (stageData.stage2?.aiRiskAnnotations ?? []).map((r) => r.columnKey).filter(Boolean)
  );
  const stage3Cols = stageData.stage2?.schema?.columns ?? [];
  const stage3Rows = stageData.stage3?.rows ?? [];

  return (
    <main className="density-roomy min-h-screen bg-canvas">
      <PageHeader
        title="审核详情"
        backHref="/teacher/review"
        backLabel="待审核"
        actions={<AuthNav />}
        maxWidth="max-w-4xl"
      />

      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        <div className="text-sm text-muted">
          {item.student.displayName} @{item.student.username} · {item.assignment.class.name} · {item.assignment.title}
        </div>

        {reviewStage === 2 && stageData.stage1?.snapshot && (
          <Card tone="soft" className="border-success/35 bg-success/8">
            <div className="caption-upper mb-2">探究问题确认书（选题定向阶段成果）</div>
            <div className="whitespace-pre-wrap leading-[1.7] text-body">{stageData.stage1.snapshot}</div>
            <div className="mt-3 text-xs text-muted">变量、水平、测量方式与控制条件均在本页的方案设计成果中审核。</div>
          </Card>
        )}

        {reviewStage === 2 && stageData.stage2 && (
          <section>
            <h2 className="display-sm mb-3">实验方案 · 数据表结构</h2>
            {stageData.stage2.experimentPlan && (() => {
              const plan = stageData.stage2.experimentPlan;
              return (
                <Card tone="soft" className="mb-4 grid gap-2 text-sm md:grid-cols-2">
                  <div><span className="font-medium text-body-strong">自变量：</span>{plan.independentVariable.name}（{plan.independentVariable.levels.join('、')}）</div>
                  <div><span className="font-medium text-body-strong">因变量：</span>{plan.dependentVariable.name}；{plan.dependentVariable.measurement}</div>
                  <div><span className="font-medium text-body-strong">控制变量：</span>{plan.controlledVariables.join('、') || '—'}</div>
                  <div><span className="font-medium text-body-strong">材料：</span>{plan.materials.join('、') || '—'}</div>
                  <div className="md:col-span-2"><span className="font-medium text-body-strong">步骤：</span>{plan.procedure.join('；') || '—'}</div>
                  <div className="md:col-span-2"><span className="font-medium text-body-strong">安全：</span>{plan.safetyNotes.join('；') || '无特殊风险'}</div>
                </Card>
              );
            })()}
            <div className="density-compact mb-3">
              <Table>
                <THead>
                  <TR><TH>键</TH><TH>列名</TH><TH>类型</TH><TH>必填</TH></TR>
                </THead>
                <TBody>
                  {stageData.stage2.schema.columns.map((c) => {
                    const risky = riskCols.has(c.key);
                    return (
                      /* 被 AI 标注为风险的列整行浅红，老师扫一眼就知道该重点看哪几列。 */
                      <TR key={c.key} className={risky ? 'bg-error/8' : ''}>
                        <TD className={`font-mono text-xs ${risky ? 'font-medium text-error' : 'text-body'}`}>{c.key}</TD>
                        <TD>{c.title}</TD>
                        <TD className="text-muted">{c.type}</TD>
                        <TD>{c.required ? '是' : '否'}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
            {stageData.stage2.aiRiskAnnotations && stageData.stage2.aiRiskAnnotations.length > 0 && (
              <Callout tone="error" title="AI 预审风险标注">
                <ul className="list-disc space-y-0.5 pl-4">
                  {stageData.stage2.aiRiskAnnotations.map((r, i) => (
                    <li key={i}>
                      {r.columnKey ? `[${r.columnKey}] ` : ''}{r.description}（{r.severity}）
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
          </section>
        )}

        {(reviewStage === 3 || reviewStage === 4) && (
          <section>
            <h2 className="display-sm mb-1.5">过程执行 · 数据表</h2>
            <p className="mb-3 text-sm text-muted">
              {reviewStage === 3
                ? `第 ${item.currentStage} 阶段，可选审核 —— 你看不看都不影响学生继续采集数据。`
                : '第 4 阶段，只读显示学生已录入的数据；本阶段没有常规审核。'}
            </p>
            {stage3Cols.length === 0 ? (
              <p className="text-sm text-muted">该学生尚未生成数据表结构。</p>
            ) : stage3Rows.length === 0 ? (
              <p className="text-sm text-muted">该学生已确定表结构，但还没有录入任何数据。</p>
            ) : (
              <ReadonlyDataTable columns={stage3Cols} rows={stage3Rows} />
            )}
          </section>
        )}

        {reviewStage === 5 && stageData.stage5 && (
          <section className="space-y-4">
            <h2 className="display-sm">实验报告</h2>
            {([
              ['purpose', '研究目的'], ['hypothesis', '假设'], ['materials', '材料'],
              ['procedure', '步骤'], ['dataSummary', '数据概述'], ['analysis', '数据分析'],
              ['conclusion', '结论'], ['reflection', '局限与讨论'],
            ] as const).map(([k, label]) => (
              <div key={k}>
                {/* 结论与局限是学生自己写的，用珊瑚标题与平台预填区分——评分主要看这两节。 */}
                <div className={`caption-upper mb-1.5 ${k === 'conclusion' || k === 'reflection' ? 'text-coral' : ''}`}>
                  {label}
                </div>
                <div className="whitespace-pre-wrap rounded-md border border-hairline bg-surface-soft p-3 text-sm leading-6 text-body">
                  {(k === 'reflection'
                    ? limitationsDiscussion(stageData.stage5!.sections)
                    : stageData.stage5!.sections[k]) || <span className="text-muted-soft">（空）</span>}
                </div>
              </div>
            ))}

            <div>
              <div className="caption-upper mb-1.5">原始实验数据</div>
              {stage3Cols.length > 0 && stage3Rows.length > 0 ? (
                <ReadonlyDataTable columns={stage3Cols} rows={stage3Rows} />
              ) : (
                <p className="text-sm text-muted-soft">（无实验数据）</p>
              )}
            </div>

            <div>
              <div className="caption-upper mb-1.5">已接受的数据分析证据</div>
              {(stageData.stage4?.evidenceRounds ?? []).length > 0 ? (
                <div className="space-y-2">
                  {stageData.stage4!.evidenceRounds!.map((round, index) => (
                    <div key={round.roundFingerprint ?? index} className="rounded-md border border-hairline bg-surface-soft p-3 text-sm">
                      <div className="font-medium text-body-strong">第 {index + 1} 轮：{round.observation}</div>
                      <div className="mt-1 leading-6 text-muted">{round.citations.join('；')}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-soft">（无已接受证据）</p>
              )}
            </div>

            {(stageData.stage5.uploadedDocUrl || stageData.stage5.uploadedText) && (
              <div>
                <div className="caption-upper mb-1.5">学生上传的 Word 报告（附件）</div>
                {/* 上传件只是附件：评分依据是上面的平台字段，这里刻意不给它主体卡片的份量。 */}
                {stageData.stage5.uploadedDocUrl && (
                  <a
                    href={stageData.stage5.uploadedDocUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-coral transition-colors duration-[120ms] hover:text-coral-active"
                  >
                    下载原文件
                  </a>
                )}
                {stageData.stage5.uploadedText && (
                  <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-hairline bg-surface-card p-3 text-sm leading-6 text-body">
                    {stageData.stage5.uploadedText}
                  </div>
                )}
              </div>
            )}

            {stageData.stage5.aiReferenceScore && (
              <Card tone="soft" className="text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="caption-upper">AI 参考评分</span>
                  <span className="font-lineage text-lg text-ink">{stageData.stage5.aiReferenceScore.overall} / 10</span>
                </div>
                <div className="mt-2 leading-6 text-body">
                  完整 {stageData.stage5.aiReferenceScore.dimensions.completeness} · 逻辑 {stageData.stage5.aiReferenceScore.dimensions.logic} · 数据 {stageData.stage5.aiReferenceScore.dimensions.dataUsage} · 创新 {stageData.stage5.aiReferenceScore.dimensions.innovation} · 表达 {stageData.stage5.aiReferenceScore.dimensions.expression}
                </div>
                {stageData.stage5.aiReferenceScore.highlights.length > 0 && (
                  <div className="mt-1 leading-6 text-body">亮点：{stageData.stage5.aiReferenceScore.highlights.join('；')}</div>
                )}
                {stageData.stage5.aiReferenceScore.suggestions.length > 0 && (
                  <div className="mt-1 leading-6 text-body">
                    建议：
                    {stageData.stage5.aiReferenceScore.suggestions.map((s, i) => (
                      <div key={i}>· [{s.targetSection}] {s.text}</div>
                    ))}
                  </div>
                )}
                <div className="mt-2">
                  <Badge tone={stageData.stage5.aiReferenceScore.safetyCompliance ? 'success' : 'error'}>
                    安全合规：{stageData.stage5.aiReferenceScore.safetyCompliance ? '是' : '否'}
                  </Badge>
                </div>
              </Card>
            )}
          </section>
        )}

        {item.assignment.dataContributionMode === 'CONSENT_REQUIRED' && (
          <CandidateNominationPanel
            studentAssignmentId={item.id}
            consentStatus={item.dataConsentStatus}
            traces={(item.conversation?.generationTraces ?? []).map((trace) => {
              let dialogue = '（结构化回复）';
              try {
                const parsed = JSON.parse(trace.responseJson) as { dialogue?: string };
                dialogue = parsed.dialogue ?? dialogue;
              } catch {}
              return {
                assistantMessageId: trace.assistantMessageId,
                stage: trace.stage,
                dialogue,
                candidateStatus: trace.productionCandidate?.status ?? null,
                  nominationBlockedReason: releasedTraceBlockReason(stageData, trace.stage)
                    ?? (item.conversation?.traceCoverage !== 'COMPLETE'
                      ? '这条对话产生于系统升级前，轨迹覆盖不完整，不可提名。'
                      : !trace.trainingSystemPromptSnapshot.trim()
                        ? '学生在这条对话之后才授权，此回合未保存完整训练上下文，不可提名。'
                        : null),
              };
            })}
          />
        )}

        {reviewStage ? (
          <ReviewActionForm
            studentAssignmentId={item.id}
            stage={reviewStage}
            currentStage={item.currentStage}
            status={item.status}
          />
        ) : (
          <Callout tone="info">该阶段没有教师放行操作；学生端会按服务器就绪状态显示推进入口。</Callout>
        )}
      </div>
    </main>
  );
}
