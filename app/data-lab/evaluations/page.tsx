import EvaluationImportForm from '@/app/components/dataLab/EvaluationImportForm';
import { aggregateEvaluationsByStyle } from '@/app/lib/dataLab/evaluation';
import { listEvaluations } from '@/app/lib/dataLab/service';
import { parseJson } from '@/app/lib/dataLab/validation';
import {
  STYLE_FAMILIES,
  STYLE_LABELS,
  isStyleFamily,
} from '@/app/lib/stylePolicy';

export default async function EvaluationsPage() {
  const runs = await listEvaluations();
  const byStyle = aggregateEvaluationsByStyle(runs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">双盲评测</h1>
        <p className="mt-1 text-sm text-gray-500">
          CLI 采集时指定目标风格；这里登记 transcript/verdict，并按相同风格规范分别汇总，避免总体平均掩盖单一风格退化。
        </p>
      </div>

      <EvaluationImportForm />

      {Object.keys(byStyle).length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">分风格累计结果</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {STYLE_FAMILIES.map((family) => {
              const item = byStyle[family];
              if (!item) return null;

              return (
                <article key={family} className="rounded-xl border bg-white p-4">
                  <div className="text-sm font-medium">{STYLE_LABELS[family]}</div>
                  <div className="mt-1 text-xs text-gray-500">{item.runs} 次评测</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <span>A胜 {item.A ?? 0}</span>
                    <span>B胜 {item.B ?? 0}</span>
                    <span>平局 {item.tie ?? 0}</span>
                    <span>不一致 {item.inconsistent ?? 0}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="space-y-3">
        {runs.map((run) => {
          const summary = parseJson<{
            scenario?: Record<string, number>;
            dimensions?: Record<string, unknown>;
          }>(run.summaryJson, {});

          return (
            <div key={run.id} className="border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{run.name}</h2>
                    <span className={`rounded-full px-2 py-1 text-xs ${run.gateResult === 'PASS' ? 'bg-green-100 text-green-700' : run.gateResult === 'FAIL' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      门禁：{run.gateResult}
                    </span>
                    {isStyleFamily(run.styleFamily) && (
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">
                        {STYLE_LABELS[run.styleFamily]} · {run.stylePolicyVersion}
                      </span>
                    )}
                    {!run.styleFamily && (
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                        旧评测：未记录风格
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    {run.modelATag} vs {run.modelBTag} · {run.scope} ·{' '}
                    {run._count.artifacts} 个产物
                  </p>
                </div>
                <span className="text-xs text-gray-500">
                  导入者 {run.createdBy.displayName}
                </span>
              </div>
              {summary.scenario && (
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <span>A胜 {summary.scenario.A ?? 0}</span>
                  <span>B胜 {summary.scenario.B ?? 0}</span>
                  <span>平局 {summary.scenario.tie ?? 0}</span>
                  <span>不一致 {summary.scenario.inconsistent ?? 0}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
