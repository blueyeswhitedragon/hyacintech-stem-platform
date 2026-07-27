import { redirect } from 'next/navigation';
import Link from 'next/link';
import ModelVersionForm from '@/app/components/dataLab/ModelVersionForm';
import TrainingRunForm from '@/app/components/dataLab/TrainingRunForm';
import { listReleases, listTrainingRuns } from '@/app/lib/dataLab/service';
import { listModelVersions } from '@/app/lib/modelRegistry';
import { ensureDataLabRuntimeRegistry } from '@/app/lib/dataLab/runtimeRegistry';
import { getCurrentUser } from '@/app/lib/session';
import { DATA_LAB_STATUS_LABELS } from '@/app/lib/dataLab/labels';
import { DisableModelButton, TrainingRunStatusControl } from '@/app/components/dataLab/ModelGovernanceControls';
import { buttonClass } from '@/app/components/ui/Button';
import { identityBackedArtifact } from '@/app/lib/deployment';

const SECTIONS = [
  ['BASE', '基座与外部产物'],
  ['TRAINING', '外部训练任务'],
  ['FINE_TUNED', '训练产物'],
  ['LEGACY', '历史待核验模型'],
] as const;

export default async function ModelsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  await ensureDataLabRuntimeRegistry(user);
  const [models, trainingRuns, releases] = await Promise.all([
    listModelVersions(),
    listTrainingRuns(),
    listReleases(),
  ]);
  const grouped = {
    // EXTERNAL 与 BASE 同区：两者都不由本平台训练，部署时只核验权重身份。
    BASE: models.filter((model) => identityBackedArtifact(model.artifactKind) && model.verificationStatus !== 'LEGACY_UNVERIFIED'),
    TRAINING: trainingRuns,
    FINE_TUNED: models.filter((model) => model.artifactKind === 'FINE_TUNED'),
    LEGACY: models.filter((model) => model.artifactKind === 'LEGACY' || model.verificationStatus === 'LEGACY_UNVERIFIED'),
  };
  const pendingOutputs = trainingRuns.filter((run) => run.status === 'SUCCEEDED' && !models.some((model) => model.trainingRunId === run.id));

  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">模型与训练</h1><p className="mt-1 text-sm text-muted">这里登记不可变基座、外部训练任务和训练输出权重。Prompt 从冻结 Release 与 TrainingRun 自动继承，不由登记模型时手填；服务地址在“AI 服务”管理。</p></header>
    {pendingOutputs.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border border-info/40 bg-info/8 p-4 text-sm text-body-strong"><span><b>{pendingOutputs.length} 个训练任务已成功：</b>请登记输出模型，并填写 checkpoint ID 或权重哈希。</span><a href="#register-output" className={buttonClass('secondary', 'sm')}>登记训练输出</a></div>}

    <section className="grid gap-3 sm:grid-cols-4">{SECTIONS.map(([key, label]) => <div key={key} className="border border-hairline bg-canvas p-4"><div className="text-2xl font-semibold">{grouped[key].length}</div><div className="mt-1 text-sm text-muted">{label}</div></div>)}</section>

    <section className="border-y bg-canvas py-5"><h2 className="font-semibold">登记流程</h2><p className="mt-1 text-xs text-muted">常用操作直接展开；高级身份字段在模型表单中填写。成功训练的 Prompt 血缘会自动带入输出产物。</p><div className="mt-4 space-y-3">
      <details className="border border-hairline p-4"><summary className="cursor-pointer font-medium">登记基础模型</summary><p className="mt-2 text-xs text-muted">登记 Qwen3.5-35B-A3B 等不可变基座。无法提供 checkpoint 或权重哈希时会标记为外部别名待核验。</p><div className="mt-3"><ModelVersionForm parents={models.map((model) => ({ id: model.id, label: model.tag }))} trainingRuns={[]} /></div></details>
      <details id="training-create" className="scroll-mt-20 border border-hairline p-4"><summary className="cursor-pointer font-medium">登记外部训练任务</summary><p className="mt-2 text-xs text-muted">选择冻结 Release 和父模型。平台自动记录 training cohort 与 trained_with Prompt。</p><div className="mt-3"><TrainingRunForm releases={releases.filter((release) => release.status === 'FROZEN').map((release) => ({ id: release.id, version: release.version }))} models={models.map((model) => ({ id: model.id, tag: model.tag }))} /></div></details>
      <details id="register-output" className="scroll-mt-20 border border-hairline p-4" open={pendingOutputs.length > 0}><summary className="cursor-pointer font-medium">登记训练输出</summary><p className="mt-2 text-xs text-muted">只选择成功 TrainingRun。Prompt 血缘从该任务继承，不会改写为当前全局 Prompt。</p><div className="mt-3"><ModelVersionForm parents={models.map((model) => ({ id: model.id, label: model.tag }))} trainingRuns={pendingOutputs.map((run) => ({ id: run.id, label: `${run.name} · ${run.promptPolicyVersion?.version ?? 'Prompt 待核验'}` }))} /></div></details>
    </div></section>

    <section><div className="mb-3"><h2 className="font-semibold">外部训练任务（{trainingRuns.length}）</h2><p className="mt-1 text-xs text-muted">训练状态与外部任务 ID 可继续回填；数据版本和 Prompt 血缘不可覆盖。</p></div><div className="space-y-3">{trainingRuns.map((run) => <article key={run.id} className="border border-hairline bg-canvas p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{run.name}</h3><p className="mt-1 text-xs text-muted">Release {run.release.version} · 父模型 {run.parentModelVersion?.tag ?? '未登记'} · Prompt {run.promptPolicyVersion?.version ?? '历史待核验'}</p></div><span className="bg-surface-card px-2 py-1 text-xs">{DATA_LAB_STATUS_LABELS[run.status] ?? run.status}</span></div>{run.externalTaskId && <p className="mt-2 text-sm text-muted">外部任务：{run.externalTaskId}</p>}<div className="mt-3 flex flex-wrap gap-2"><TrainingRunStatusControl id={run.id} currentStatus={run.status} currentExternalTaskId={run.externalTaskId} />{run.status === 'SUCCEEDED' && <a href="#register-output" className={buttonClass('primary', 'sm')}>登记训练输出</a>}</div></article>)}{trainingRuns.length === 0 && <p className="border border-hairline bg-canvas p-4 text-sm text-muted">还没有训练任务。先冻结数据版本，再登记外部训练。</p>}</div></section>

    {(['BASE', 'FINE_TUNED', 'LEGACY'] as const).map((key) => <section key={key} className="space-y-3"><h2 className="font-semibold">{SECTIONS.find(([value]) => value === key)?.[1]}（{grouped[key].length}）</h2>{grouped[key].map((model) => <article key={model.id} className="border border-hairline bg-canvas p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs text-muted">{model.modelFamily || '家族待核验'} · {model.parameterScale || '规模未登记'} · {model.architecture || '架构未登记'}</div><h3 className="mt-1 font-semibold">{model.tag}</h3><p className="mt-1 text-sm text-muted">{model.checkpointId || model.externalModelId}</p></div><span className={`px-2 py-1 text-xs ${model.verificationStatus === 'VERIFIED_IDENTITY' ? 'bg-success/10 text-body-strong' : 'bg-warning/10 text-body-strong'}`}>{model.verificationStatus === 'VERIFIED_IDENTITY' ? '身份已核验' : '历史待核验'}</span></div>
        <div className="mt-4 grid gap-3 text-xs md:grid-cols-4"><div className="border border-hairline bg-surface-soft p-3"><b>父模型</b><p className="mt-1">{model.parent?.tag ?? '外部基座'}</p></div><div className="border border-hairline bg-surface-soft p-3"><b>来源 Release</b><p className="mt-1">{model.trainingRun?.release.version ?? '无'}</p></div><div className="border border-hairline bg-surface-soft p-3"><b>trained_with Prompt</b><p className="mt-1">{model.trainedPromptPolicy?.version ?? (identityBackedArtifact(model.artifactKind) ? '不适用' : '待核验')}</p></div><div className="border border-hairline bg-surface-soft p-3"><b>服务 Endpoint</b><p className="mt-1">{model.endpoints.length ? model.endpoints.map((endpoint) => endpoint.displayName).join('、') : '尚未关联'}</p></div></div>
        {model.weightsSha256 && <p className="mt-3 break-all font-mono text-xs text-muted">SHA-256 {model.weightsSha256}</p>}
        <details className="mt-4 rounded-md border border-hairline bg-surface-soft p-3 text-xs"><summary className="cursor-pointer font-medium">查看完整血缘</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify({ base: model.parent?.tag ?? null, release: model.trainingRun?.release.version ?? null, trainingRun: model.trainingRun?.name ?? null, trainedWithPrompt: model.trainedPromptPolicy?.version ?? null, artifact: model.tag, checkpointId: model.checkpointId || null, weightsSha256: model.weightsSha256 || null }, null, 2)}</pre></details>
        <div className="mt-4 flex flex-wrap gap-2"><Link href="/data-lab/ai-services" className={buttonClass('secondary', 'sm')}>关联服务端点</Link><Link href="/data-lab/runtime-bundles" className={buttonClass('primary', 'sm')}>创建运行组合</Link><a href="#training-create" className={buttonClass('secondary', 'sm')}>创建子训练任务</a>{model.status !== 'DEPLOYED' && model.status !== 'BLOCKED' && <DisableModelButton id={model.id} />}</div>
        <p className="mt-3 text-right text-xs text-muted-soft">{model._count.children} 个子模型 · {model._count.generationTraces} 条生成轨迹</p>
      </article>)}{grouped[key].length === 0 && <p className="border border-hairline bg-canvas p-4 text-sm text-muted">当前没有此类模型产物。</p>}</section>)}
  </div>;
}
