import { redirect } from 'next/navigation';
import Link from 'next/link';
import ModelVersionForm from '@/app/components/dataLab/ModelVersionForm';
import TrainingRunForm from '@/app/components/dataLab/TrainingRunForm';
import EvaluationImportForm from '@/app/components/dataLab/EvaluationImportForm';
import DeploymentControls from '@/app/components/dataLab/DeploymentControls';
import { listEvaluations, listReleases, listTrainingRuns } from '@/app/lib/dataLab/service';
import { listModelDeployments, listModelVersions, modelTraceCoverageSummary } from '@/app/lib/modelRegistry';
import { getCurrentUser } from '@/app/lib/session';
import { DATA_LAB_STATUS_LABELS, EVALUATION_SCOPE_LABELS } from '@/app/lib/dataLab/labels';
import { parseJson } from '@/app/lib/dataLab/validation';

export default async function ModelsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');

  const [models, deployments, coverage, trainingRuns, releases, evaluations] = await Promise.all([
    listModelVersions(), listModelDeployments(), modelTraceCoverageSummary(), listTrainingRuns(), listReleases(), listEvaluations(),
  ]);
  const active = deployments.find((deployment) => deployment.status === 'ACTIVE') ?? null;
  const currentModel = active ? models.find((model) => model.id === active.modelVersionId) : null;
  const passedEvaluation = evaluations.find((evaluation) => evaluation.gateResult === 'PASS');

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">模型档案</h1><p className="mt-1 text-sm text-gray-500">这里是外部训练结果的登记簿：记录数据来源、训练任务、评测结果和灰度部署，不保存算力平台密钥。</p></div>

    {currentModel ? <section className="border border-green-300 bg-green-50 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-green-800">当前生产模型</p><h2 className="mt-1 text-xl font-semibold">{currentModel.tag}</h2><p className="mt-1 text-sm text-green-900">{currentModel.provider} / {currentModel.externalModelId}</p></div><div className="text-right"><div className="text-2xl font-semibold tabular-nums">{active?.rolloutPercent}%</div><div className="text-xs text-green-800">当前流量比例</div>{active?.startedAt && <div className="mt-1 text-xs text-green-700">开始于 {new Date(active.startedAt).toLocaleString('zh-CN')}</div>}</div></div></section> : <section className="border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">尚未登记当前生产模型。服务启动完成模型基线登记后，这里会显示生产版本。</section>}

    {passedEvaluation && <div className="flex flex-wrap items-center justify-between gap-3 border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><span><b>评测门禁已通过：</b>{passedEvaluation.modelBTag} 已具备进入部署流程的离线资格。</span><a href="#deployment" className="bg-blue-800 px-3 py-2 text-white">前往部署登记</a></div>}

    <section className="grid gap-3 sm:grid-cols-3"><div className="border bg-white p-4"><div className="text-2xl font-semibold">{coverage.traces}</div><div className="text-sm text-gray-500">不可变生成轨迹</div></div><div className="border bg-white p-4"><div className="text-2xl font-semibold">{coverage.complete}</div><div className="text-sm text-gray-500">完整追踪会话</div></div><div className="border bg-white p-4"><div className="text-2xl font-semibold">{coverage.legacy}</div><div className="text-sm text-gray-500">历史不可验证会话</div></div></section>

    <section id="training" className="scroll-mt-20 border-y bg-white py-5"><div><h2 className="font-semibold">外部结果回填</h2><p className="mt-1 text-xs text-gray-500">按实际顺序登记：训练任务 → 输出模型 → 评测产物。学校算力接入后可沿用同一结构自动写入。</p></div><div className="mt-4 space-y-3">
      <details className="border p-4"><summary className="cursor-pointer font-medium">1. 登记外部训练任务</summary><p className="mt-2 text-xs text-gray-500">下载数据交给算力平台后，填写平台任务编号、父模型和当前状态。</p><div className="mt-3"><TrainingRunForm releases={releases.filter((release) => release.status === 'FROZEN').map((release) => ({ id: release.id, version: release.version }))} models={models.map((model) => ({ id: model.id, tag: model.tag }))} /></div></details>
      <details className="border p-4"><summary className="cursor-pointer font-medium">2. 登记输出模型版本</summary><p className="mt-2 text-xs text-gray-500">外部训练完成后，把稳定模型标签与上一步训练登记关联起来。</p><div className="mt-3"><ModelVersionForm parents={models.map((model) => ({ id: model.id, label: model.tag }))} trainingRuns={trainingRuns.map((run) => ({ id: run.id, label: run.name }))} /></div></details>
      <details id="evaluation" className="scroll-mt-20 border p-4"><summary className="cursor-pointer font-medium">3. 导入评测结果</summary><p className="mt-2 text-xs leading-5 text-gray-500">一次选择两个模型对话记录和一个裁决文件。每个文件需含结构版本；对话记录需含模型标签、评测范围和场景编号，裁决文件需含 A/B 标签与阶段汇总。</p><div className="mt-3 flex flex-wrap gap-3 text-xs"><Link href="/examples/data-lab/baseline-transcript.example.json" className="text-blue-700 underline">下载基线对话示例</Link><Link href="/examples/data-lab/candidate-transcript.example.json" className="text-blue-700 underline">下载候选对话示例</Link><Link href="/examples/data-lab/verdict.example.json" className="text-blue-700 underline">下载裁决示例</Link></div><div className="mt-3"><EvaluationImportForm /></div></details>
    </div></section>

    <section><div className="mb-3"><h2 className="font-semibold">模型版本时间线</h2><p className="mt-1 text-xs text-gray-500">每条记录从冻结数据追溯到外部训练、评测和部署。</p></div><div className="space-y-4">{models.map((model) => {
      const modelEvaluations = evaluations.filter((evaluation) => evaluation.modelBVersionId === model.id);
      const modelDeployments = deployments.filter((deployment) => deployment.modelVersionId === model.id);
      const latestDeployment = modelDeployments[0];
      return <article key={model.id} className="border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{model.tag}</h3><p className="mt-1 text-xs text-gray-500">{model.provider} / {model.externalModelId} · 父模型 {model.parent?.tag ?? '外部基线'}</p></div><span className="bg-gray-100 px-2 py-1 text-xs">{DATA_LAB_STATUS_LABELS[model.status] ?? '状态待确认'}</span></div><div className="mt-5 space-y-5 border-l-2 border-gray-200 pl-5">
        <div className="relative"><span className="absolute -left-[25px] top-1 size-2 rounded-full bg-gray-700" /><h4 className="text-sm font-medium">数据来源</h4><p className="mt-1 text-xs text-gray-500">{model.trainingRun?.release.version ? `冻结版本 ${model.trainingRun.release.version}` : '外部基线或尚未关联冻结数据'}</p></div>
        <div className="relative"><span className={`absolute -left-[25px] top-1 size-2 rounded-full ${model.trainingRun ? 'bg-green-600' : 'bg-gray-300'}`} /><h4 className="text-sm font-medium">训练登记</h4>{model.trainingRun ? <p className="mt-1 text-xs text-gray-500">{model.trainingRun.name} · {DATA_LAB_STATUS_LABELS[model.trainingRun.status] ?? '状态待确认'}{model.trainingRun.externalTaskId ? ` · 外部任务 ${model.trainingRun.externalTaskId}` : ''}</p> : <p className="mt-1 text-xs text-gray-500">尚未关联外部训练任务</p>}</div>
        <div className="relative"><span className={`absolute -left-[25px] top-1 size-2 rounded-full ${modelEvaluations.some((evaluation) => evaluation.gateResult === 'PASS') ? 'bg-green-600' : modelEvaluations.length ? 'bg-red-600' : 'bg-gray-300'}`} /><h4 className="text-sm font-medium">评测回填</h4>{modelEvaluations.length ? <div className="mt-2 space-y-2">{modelEvaluations.map((evaluation) => { const summary = parseJson<{ artifactValidation?: { complete?: boolean; invalidArtifacts?: number; scenarioIdsComplete?: boolean; modelIdentitiesVerified?: boolean; scenarioCount?: number }; criticalErrors?: number }>(evaluation.summaryJson, {}); const artifact = summary.artifactValidation; return <div key={evaluation.id} className="bg-gray-50 p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><b>{evaluation.name}</b><span className={evaluation.gateResult === 'PASS' ? 'text-green-700' : 'text-red-700'}>{evaluation.gateResult === 'PASS' ? '门禁通过' : evaluation.gateResult === 'FAIL' ? '门禁未通过' : '等待门禁计算'}</span></div><p className="mt-1 text-gray-500">{EVALUATION_SCOPE_LABELS[evaluation.scope] ?? '评测范围待确认'} · {evaluation._count.artifacts} 个文件 · {artifact?.scenarioCount ?? 0} 个可核验场景</p><p className="mt-1 text-gray-500">文件完整：{artifact?.complete ? '是' : '否'} · 场景编号完整：{artifact?.scenarioIdsComplete ? '是' : '否'} · 模型身份已核验：{artifact?.modelIdentitiesVerified ? '是' : '否'} · 严重错误 {summary.criticalErrors ?? 0}</p></div>; })}</div> : <p className="mt-1 text-xs text-gray-500">尚未导入评测产物</p>}</div>
        <div className="relative"><span className={`absolute -left-[25px] top-1 size-2 rounded-full ${latestDeployment ? 'bg-green-600' : 'bg-gray-300'}`} /><h4 className="text-sm font-medium">部署状态</h4><div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">{[10, 30, 100].map((percent) => <div key={percent} className={`border p-2 ${latestDeployment && latestDeployment.rolloutPercent >= percent ? 'border-green-300 bg-green-50 text-green-800' : 'text-gray-400'}`}>{percent}%</div>)}</div>{latestDeployment ? <p className="mt-2 text-xs text-gray-500">{DATA_LAB_STATUS_LABELS[latestDeployment.status] ?? '状态待确认'} · 最近比例 {latestDeployment.rolloutPercent}%{latestDeployment.startedAt ? ` · ${new Date(latestDeployment.startedAt).toLocaleString('zh-CN')}` : ''}</p> : <p className="mt-2 text-xs text-gray-500">评测通过后可从 10% 开始灰度。</p>}</div>
      </div><p className="mt-4 text-right text-xs text-gray-400">已记录 {model._count.generationTraces} 条正式生成轨迹</p></article>;
    })}{models.length === 0 && <p className="border bg-white p-6 text-sm text-gray-500">还没有模型版本。先登记外部训练结果或等待运行时基线自动登记。</p>}</div></section>

    <section id="deployment" className="scroll-mt-20"><DeploymentControls models={models.map((model) => ({ id: model.id, tag: model.tag, status: model.status }))} active={active} /></section>
  </div>;
}
