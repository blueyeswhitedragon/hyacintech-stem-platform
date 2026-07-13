import { redirect } from 'next/navigation';
import ModelVersionForm from '@/app/components/dataLab/ModelVersionForm';
import { listTrainingRuns } from '@/app/lib/dataLab/service';
import {
  listModelDeployments,
  listModelVersions,
  modelTraceCoverageSummary,
} from '@/app/lib/modelRegistry';
import { getCurrentUser } from '@/app/lib/session';
import DeploymentControls from '@/app/components/dataLab/DeploymentControls';

export default async function ModelsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');

  const [models, deployments, coverage, trainingRuns] = await Promise.all([
    listModelVersions(),
    listModelDeployments(),
    modelTraceCoverageSummary(),
    listTrainingRuns(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">模型与生成血缘</h1>
        <p className="mt-1 text-sm text-gray-500">
          稳定登记模型身份、父子关系和正式会话生成轨迹；此处不保存 API Key。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border bg-white p-4">
          <div className="text-2xl font-semibold">{coverage.traces}</div>
          <div className="text-sm text-gray-500">不可变生成轨迹</div>
        </div>
        <div className="border bg-white p-4">
          <div className="text-2xl font-semibold">{coverage.complete}</div>
          <div className="text-sm text-gray-500">完整追踪会话</div>
        </div>
        <div className="border bg-white p-4">
          <div className="text-2xl font-semibold">{coverage.legacy}</div>
          <div className="text-sm text-gray-500">历史不可验证会话</div>
        </div>
      </div>

      <ModelVersionForm
        parents={models.map((model) => ({ id: model.id, label: model.tag }))}
        trainingRuns={trainingRuns.map((run) => ({ id: run.id, label: run.name }))}
      />

      <DeploymentControls
        models={models.map((model) => ({ id: model.id, tag: model.tag, status: model.status }))}
        active={deployments.find((deployment) => deployment.status === 'ACTIVE') ?? null}
      />

      <section>
        <h2 className="mb-3 font-semibold">模型注册表</h2>
        <div className="overflow-x-auto border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="p-3">标签</th>
                <th className="p-3">服务商 / 模型</th>
                <th className="p-3">父模型</th>
                <th className="p-3">训练登记</th>
                <th className="p-3">状态</th>
                <th className="p-3">轨迹</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{model.tag}</td>
                  <td className="p-3">{model.provider} / {model.externalModelId}</td>
                  <td className="p-3">{model.parent?.tag ?? '外部基线'}</td>
                  <td className="p-3">{model.trainingRun?.name ?? '-'}</td>
                  <td className="p-3">{model.status}</td>
                  <td className="p-3">{model._count.generationTraces}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">部署与回滚记录</h2>
        <div className="space-y-2">
          {deployments.map((deployment) => (
            <div key={deployment.id} className="border bg-white p-4 text-sm">
              <span className="font-medium">{deployment.modelVersion.tag}</span>
              {' · '}{deployment.environment} · {deployment.rolloutPercent}% · {deployment.status}
            </div>
          ))}
          {deployments.length === 0 && (
            <p className="text-sm text-gray-500">服务下次启动时将登记当前运行模型基线。</p>
          )}
        </div>
      </section>
    </div>
  );
}
