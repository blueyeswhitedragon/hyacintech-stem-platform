import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import { getReviewItem } from '@/app/lib/queries';
import { parseStageData } from '@/app/lib/conversation';
import AuthNav from '@/app/components/AuthNav';
import ReviewActionForm from '@/app/components/ReviewActionForm';

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
            {stageData.stage1.variables && (
              <div className="px-4 pb-3 text-sm text-gray-600">
                自变量：{stageData.stage1.variables.independent || '—'}
                {stageData.stage1.variables.dependent ? ` · 因变量：${stageData.stage1.variables.dependent}` : ''}
                {stageData.stage1.variables.controlled?.length
                  ? ` · 控制变量：${stageData.stage1.variables.controlled.join('、')}`
                  : ''}
              </div>
            )}
          </section>
        )}

        {reviewStage === 2 && stageData.stage2 && (
          <section className="bg-white border rounded-lg p-4">
            <h2 className="font-medium mb-3">实验方案 · 数据表结构</h2>
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
              ['conclusion', '结论'], ['reflection', '反思'],
            ] as const).map(([k, label]) => (
              <div key={k}>
                <div className="text-sm font-medium text-gray-600">{label}</div>
                <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded p-2">
                  {stageData.stage5!.sections[k] || <span className="text-gray-400">（空）</span>}
                </div>
              </div>
            ))}

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

        <ReviewActionForm studentAssignmentId={item.id} stage={reviewStage} />
      </div>
    </main>
  );
}
