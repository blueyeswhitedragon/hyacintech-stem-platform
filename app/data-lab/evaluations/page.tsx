import { redirect } from 'next/navigation';
import EvaluationImportForm from '@/app/components/dataLab/EvaluationImportForm';
import DeploymentControls from '@/app/components/dataLab/DeploymentControls';
import { ensureDataLabRuntimeRegistry, listRuntimeRolesAndBundles } from '@/app/lib/dataLab/runtimeRegistry';
import { listEvaluations } from '@/app/lib/dataLab/service';
import { listModelDeployments } from '@/app/lib/modelRegistry';
import { getCurrentUser } from '@/app/lib/session';
import { DATA_LAB_STATUS_LABELS, EVALUATION_SCOPE_LABELS, gateFailureCategory, gateFailureLabel } from '@/app/lib/dataLab/labels';

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export default async function EvaluationsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  await ensureDataLabRuntimeRegistry(user);
  const [{ bundles }, evaluations, deployments] = await Promise.all([
    listRuntimeRolesAndBundles(),
    listEvaluations(),
    listModelDeployments(),
  ]);
  const options = bundles.filter((bundle) => ['AVAILABLE', 'DEPLOYED'].includes(bundle.status)).map((bundle) => ({
    id: bundle.id,
    label: `${bundle.name} v${bundle.version} · ${bundle.modelVersion.tag} · ${bundle.promptPolicyVersion.version}`,
    status: bundle.status,
    modelTag: bundle.modelVersion.tag,
    modelVersionId: bundle.modelVersionId,
    promptVersion: bundle.promptPolicyVersion.version,
    promptPolicyVersionId: bundle.promptPolicyVersionId,
    endpointName: bundle.endpoint.displayName,
    endpointId: bundle.endpointId,
  }));
  const active = deployments.find((deployment) => deployment.status === 'ACTIVE') ?? null;
  const planned = evaluations.filter((run) => run.status === 'PLANNED' && run.runtimeBundleAId && run.runtimeBundleBId).map((run) => ({
    id: run.id,
    name: run.name,
    runtimeBundleAId: run.runtimeBundleAId!,
    runtimeBundleBId: run.runtimeBundleBId!,
    modelATag: run.modelATag,
    modelBTag: run.modelBTag,
  }));

  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">评测与部署</h1><p className="mt-1 text-sm text-muted">这里比较完整运行组合，而不再只比较裸模型。先完成六阶段离线评测，再按 10% → 30% → 100% 灰度；旧会话始终保持原组合。</p></header>
    <div className="grid gap-2 text-sm sm:grid-cols-4"><div className="border-b-2 border-ink pb-2"><b>1. 选择差异</b><p className="mt-1 text-xs text-muted">模型、Prompt 或 Endpoint</p></div><div className="border-b-2 border-ink pb-2"><b>2. 导入证据</b><p className="mt-1 text-xs text-muted">六阶段对话记录与裁决结果</p></div><div className="border-b-2 border-ink pb-2"><b>3. 计算资格</b><p className="mt-1 text-xs text-muted">训练、兼容性与评测门禁</p></div><div className="border-b-2 border-ink pb-2"><b>4. 灰度与回滚</b><p className="mt-1 text-xs text-muted">只影响新会话路由</p></div></div>
    {options.length < 2 && <div className="border border-warning/40 bg-warning/8 p-4 text-sm text-body-strong"><b>暂不能创建 A/B 评测：</b>至少需要两个“可用/已部署”的运行组合。请在“运行组合”完成实际调用与兼容性评测，并将两个组合标记为可用。</div>}
    <EvaluationImportForm bundles={options} planned={planned} />

    <section className="space-y-3"><h2 className="font-semibold">评测记录（{evaluations.length}）</h2>{evaluations.map((run) => <article key={run.id} className="border border-hairline bg-canvas p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{run.name}</h3><p className="mt-1 text-xs text-muted">{run.modelATag} → {run.modelBTag} · {EVALUATION_SCOPE_LABELS[run.scope] ?? '范围待确认'} · {run._count.artifacts} 个证据文件</p></div><span className={`px-2 py-1 text-xs ${run.gateResult === 'PASS' ? 'bg-success/10 text-body-strong' : run.gateResult === 'FAIL' ? 'bg-error/10 text-body-strong' : 'bg-surface-card'}`}>{run.status === 'PLANNED' ? '等待导入评测产物' : DATA_LAB_STATUS_LABELS[run.gateResult] ?? run.gateResult}</span></div>
      {run.runtimeBundleA && run.runtimeBundleB && <div className="mt-3 grid gap-2 text-xs md:grid-cols-2"><div className="border border-hairline bg-surface-soft p-3"><b>基线 A</b><p className="mt-1">{run.runtimeBundleA.modelVersion.tag} · {run.runtimeBundleA.promptPolicyVersion.version} · {run.runtimeBundleA.endpoint.displayName}</p></div><div className="border border-hairline bg-surface-soft p-3"><b>候选 B</b><p className="mt-1">{run.runtimeBundleB.modelVersion.tag} · {run.runtimeBundleB.promptPolicyVersion.version} · {run.runtimeBundleB.endpoint.displayName}</p></div></div>}
      {(() => {
        const summary = parseJson<{ artifactValidation?: { diagnostics?: Array<{ message?: string; remediation?: string }> } }>(run.summaryJson, {});
        const report = parseJson<{ failures?: string[] }>(run.gateReportJson, {});
        const diagnostics = summary.artifactValidation?.diagnostics ?? [];
        const failures = report.failures ?? [];
        return <>{diagnostics.length > 0 && <div className="mt-3 border border-warning/40 bg-warning/8 p-3 text-xs text-body-strong"><b>评测产物不完整</b><ul className="mt-2 list-disc space-y-1 pl-5">{diagnostics.map((item, index) => <li key={index}>{item.message ?? '产物字段不完整'}{item.remediation ? ` ${item.remediation}` : ''}</li>)}</ul></div>}{run.gateResult !== 'NOT_EVALUATED' && <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">查看部署门禁结论</summary>{failures.length ? <div className="mt-2 grid gap-3 md:grid-cols-2"><div className="border border-warning/40 bg-warning/8 p-3"><b>产物不完整</b><ul className="mt-2 list-disc space-y-1 pl-5">{failures.filter((failure) => gateFailureCategory(failure) === 'PRODUCT_INCOMPLETE').map((failure) => <li key={failure}>{gateFailureLabel(failure)}</li>)}</ul></div><div className="border border-error/40 bg-error/8 p-3"><b>质量未达标</b><ul className="mt-2 list-disc space-y-1 pl-5">{failures.filter((failure) => gateFailureCategory(failure) === 'QUALITY').map((failure) => <li key={failure}>{gateFailureLabel(failure)}</li>)}</ul></div></div> : <p className="mt-2 text-[#2f7a43]">部署门禁已通过。</p>}</details>}</>;
      })()}
    </article>)}{evaluations.length === 0 && <p className="border border-hairline bg-canvas p-4 text-sm text-muted">还没有评测记录。</p>}</section>

    <DeploymentControls deploymentEnabled={process.env.ENABLE_MODEL_DEPLOYMENT !== 'false'} key={active ? `${active.id}:${active.observationJson}` : 'no-active-deployment'} bundles={options} active={active ? {
      id: active.id,
      runtimeBundleId: active.runtimeBundleId,
      modelVersionId: active.modelVersionId,
      rolloutPercent: active.rolloutPercent,
      previousRuntimeBundleId: active.previousRuntimeBundleId,
      previousModelVersionId: active.previousModelVersionId,
      observationJson: active.observationJson,
      startedAt: active.startedAt?.toISOString() ?? active.createdAt.toISOString(),
    } : null} />
  </div>;
}
