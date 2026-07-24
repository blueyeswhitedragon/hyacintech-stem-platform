import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { getReviewItem } from '@/app/lib/queries';
import { parseStageData } from '@/app/lib/conversation';
import AuthNav from '@/app/components/AuthNav';
import ReviewActionForm from '@/app/components/ReviewActionForm';
import CandidateNominationPanel from '@/app/components/CandidateNominationPanel';
import { limitationsDiscussion } from '@/app/lib/reportFields';

export default async function TeacherReviewDetailPage(ctx: PageProps<'/teacher/review/[id]'>) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login');
  if (user.role !== 'teacher') redirect('/');

  const { id } = await ctx.params;
  const item = await getReviewItem(id);
  if (!item) notFound();
  if (item.assignment.class.teacherId !== user.id) redirect('/teacher/review');

  const stageData = parseStageData(item.conversation?.stageData ?? '{}');
  // 审核阶段：PENDING_STAGE2→2、PENDING_STAGE5→5，否则按当前阶段视为第三阶段非阻塞过目
  const reviewStage: 2 | 3 | 5 =
    item.status === 'PENDING_STAGE2' ? 2 : item.status === 'PENDING_STAGE5' ? 5 : 3;
  const riskCols = new Set(
    (stageData.stage2?.aiRiskAnnotations ?? []).map((r) => r.columnKey).filter(Boolean)
  );
  const stage3Cols = stageData.stage2?.schema?.columns ?? [];
  const stage3Rows = stageData.stage3?.rows ?? [];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b p-4">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/teacher/review" className="text-blue-600 hover:underline text-sm">← 待审核</Link>
            <h1 className="text-xl font-bold text-blue-600">审核详情</h1>
          </div>
          <AuthNav />
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-5">
        <div className="text-sm text-gray-500">
          {item.student.displayName} @{item.student.username} · {item.assignment.class.name} · {item.assignment.title}
        </div>

        {reviewStage === 2 && stageData.stage1?.snapshot && (
          <section className="bg-white border-2 border-green-300 rounded-lg overflow-hidden">
            <div className="bg-green-500 text-white px-4 py-2 text-sm font-medium">
              📋 探究问题确认书（选题定向阶段成果）
            </div>
            <div className="p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {stageData.stage1.snapshot}
            </div>
            <div className="px-4 pb-3 text-xs text-gray-500">变量、水平、测量方式与控制条件均在本页的方案设计成果中审核。</div>
          </section>
        )}

        {reviewStage === 2 && stageData.stage2 && (
          <section className="bg-white border rounded-lg p-4">
            <h2 className="font-medium mb-3">实验方案 · 数据表结构</h2>
            {stageData.stage2.experimentPlan && (() => {
              const plan = stageData.stage2.experimentPlan;
              return (
                <div className="mb-4 grid gap-2 rounded border bg-gray-50 p-3 text-sm md:grid-cols-2">
                  <div><span className="font-medium">自变量：</span>{plan.independentVariable.name}（{plan.independentVariable.levels.join('、')}）</div>
                  <div><span className="font-medium">因变量：</span>{plan.dependentVariable.name}；{plan.dependentVariable.measurement}</div>
                  <div><span className="font-medium">控制变量：</span>{plan.controlledVariables.join('、') || '—'}</div>
                  <div><span className="font-medium">材料：</span>{plan.materials.join('、') || '—'}</div>
                  <div className="md:col-span-2"><span className="font-medium">步骤：</span>{plan.procedure.join('；') || '—'}</div>
                  <div className="md:col-span-2"><span className="font-medium">安全：</span>{plan.safetyNotes.join('；') || '无特殊风险'}</div>
                </div>
              );
            })()}
            <table className="w-full text-sm border mb-3">
              <thead className="bg-gray-50 text-gray-600">
                <tr><th className="p-2 border text-left">键</th><th className="p-2 border text-left">列名</th><th className="p-2 border text-left">类型</th><th className="p-2 border text-left">必填</th></tr>
              </thead>
              <tbody>
                {stageData.stage2.schema.columns.map((c) => {
                  const risky = riskCols.has(c.key);
                  return (
                    <tr key={c.key} className={risky ? 'bg-red-50' : ''}>
                      <td className={`p-2 border ${risky ? 'text-red-700 font-medium' : ''}`}>{c.key}</td>
                      <td className="p-2 border">{c.title}</td>
                      <td className="p-2 border">{c.type}</td>
                      <td className="p-2 border">{c.required ? '是' : '否'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {stageData.stage2.aiRiskAnnotations && stageData.stage2.aiRiskAnnotations.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm">
                <div className="font-medium text-red-700 mb-1">⚠️ AI 预审风险标注</div>
                {stageData.stage2.aiRiskAnnotations.map((r, i) => (
                  <div key={i} className="text-red-700">
                    · {r.columnKey ? `[${r.columnKey}] ` : ''}{r.description}（{r.severity}）
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {reviewStage === 3 && (
          <section className="bg-white border rounded-lg p-4">
            <h2 className="font-medium mb-3">过程执行 · 数据表（第 {item.currentStage} 阶段，可选审核）</h2>
            {stage3Cols.length === 0 ? (
              <p className="text-sm text-gray-500">该学生尚未生成数据表结构。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="p-2 border text-center w-10">#</th>
                      {stage3Cols.map((c) => (
                        <th key={c.key} className="p-2 border text-left whitespace-nowrap">{c.title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stage3Rows.length === 0 ? (
                      <tr><td className="p-2 border text-gray-400" colSpan={stage3Cols.length + 1}>（学生尚未录入数据）</td></tr>
                    ) : (
                      stage3Rows.map((row, i) => (
                        <tr key={i}>
                          <td className="p-2 border text-center text-gray-400">{i + 1}</td>
                          {stage3Cols.map((c) => (
                            <td key={c.key} className="p-2 border text-gray-800">{String(row[c.key] ?? '—')}</td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {reviewStage === 5 && stageData.stage5 && (
          <section className="bg-white border rounded-lg p-4 space-y-3">
            <h2 className="font-medium">实验报告</h2>
            {([
              ['purpose', '研究目的'], ['hypothesis', '假设'], ['materials', '材料'],
              ['procedure', '步骤'], ['dataSummary', '数据概述'], ['analysis', '数据分析'],
              ['conclusion', '结论'], ['reflection', '局限与讨论'],
            ] as const).map(([k, label]) => (
              <div key={k}>
                <div className="text-sm font-medium text-gray-600">{label}</div>
                <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded p-2">
                  {(k === 'reflection'
                    ? limitationsDiscussion(stageData.stage5!.sections)
                    : stageData.stage5!.sections[k]) || <span className="text-gray-400">（空）</span>}
                </div>
              </div>
            ))}

            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-700">原始实验数据</h3>
              {stage3Cols.length > 0 && stage3Rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border text-sm">
                    <thead className="bg-gray-50"><tr><th className="border p-2">#</th>{stage3Cols.map((column) => <th key={column.key} className="border p-2 text-left">{column.title}</th>)}</tr></thead>
                    <tbody>{stage3Rows.map((row, rowIndex) => (
                      <tr key={rowIndex}><td className="border p-2 text-center">{rowIndex + 1}</td>{stage3Cols.map((column) => <td key={column.key} className="border p-2">{String(row[column.key] ?? '—')}</td>)}</tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-gray-400">（无实验数据）</p>}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-700">已接受的数据分析证据</h3>
              {(stageData.stage4?.evidenceRounds ?? []).length > 0 ? (
                <div className="space-y-2">{stageData.stage4!.evidenceRounds!.map((round, index) => (
                  <div key={round.roundFingerprint ?? index} className="rounded border bg-gray-50 p-2 text-sm">
                    <div className="font-medium">第 {index + 1} 轮：{round.observation}</div>
                    <div className="mt-1 text-gray-600">{round.citations.join('；')}</div>
                  </div>
                ))}</div>
              ) : <p className="text-sm text-gray-400">（无已接受证据）</p>}
            </div>

            {(stageData.stage5.uploadedDocUrl || stageData.stage5.uploadedText) && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-gray-700">学生上传的 Word 报告</h3>
                {stageData.stage5.uploadedDocUrl && <a href={stageData.stage5.uploadedDocUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline">下载原文件</a>}
                {stageData.stage5.uploadedText && <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded border border-amber-200 bg-amber-50 p-2 text-sm">{stageData.stage5.uploadedText}</div>}
              </div>
            )}

            {stageData.stage5.aiReferenceScore && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                <div className="font-medium text-blue-800 mb-1">
                  AI 参考评分：{stageData.stage5.aiReferenceScore.overall} / 10
                </div>
                <div className="text-gray-700">
                  完整 {stageData.stage5.aiReferenceScore.dimensions.completeness} · 逻辑 {stageData.stage5.aiReferenceScore.dimensions.logic} · 数据 {stageData.stage5.aiReferenceScore.dimensions.dataUsage} · 创新 {stageData.stage5.aiReferenceScore.dimensions.innovation} · 表达 {stageData.stage5.aiReferenceScore.dimensions.expression}
                </div>
                {stageData.stage5.aiReferenceScore.highlights.length > 0 && (
                  <div className="mt-1 text-gray-700">亮点：{stageData.stage5.aiReferenceScore.highlights.join('；')}</div>
                )}
                {stageData.stage5.aiReferenceScore.suggestions.length > 0 && (
                  <div className="mt-1 text-gray-700">
                    建议：
                    {stageData.stage5.aiReferenceScore.suggestions.map((s, i) => (
                      <div key={i}>· [{s.targetSection}] {s.text}</div>
                    ))}
                  </div>
                )}
                <div className="mt-1 text-gray-500">安全合规：{stageData.stage5.aiReferenceScore.safetyCompliance ? '是' : '否'}</div>
              </div>
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
              };
            })}
          />
        )}

        <ReviewActionForm studentAssignmentId={item.id} stage={reviewStage} />
      </div>
    </main>
  );
}
