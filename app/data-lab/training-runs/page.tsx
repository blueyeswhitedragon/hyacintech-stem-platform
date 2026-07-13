import TrainingRunForm from '@/app/components/dataLab/TrainingRunForm';
import { listReleases, listTrainingRuns } from '@/app/lib/dataLab/service';
import { listModelVersions } from '@/app/lib/modelRegistry';
import { parseJson } from '@/app/lib/dataLab/validation';

export default async function TrainingRunsPage() {
  const [releases, runs, models] = await Promise.all([listReleases(), listTrainingRuns(), listModelVersions()]);
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">外部训练任务</h1><p className="mt-1 text-sm text-gray-500">登记前重新检查冻结版本、授权状态、人工纠正和父模型血缘；本系统不保存训练平台密钥。</p></div>
    <TrainingRunForm releases={releases.filter((release) => release.status === 'FROZEN').map((release) => ({ id: release.id, version: release.version }))} models={models.map((model) => ({ id: model.id, tag: model.tag }))} />
    <div className="overflow-x-auto border bg-white"><table className="w-full text-left text-sm"><thead className="border-b bg-gray-50"><tr><th className="p-3">任务</th><th className="p-3">数据版本</th><th className="p-3">父模型</th><th className="p-3">资格</th><th className="p-3">状态</th><th className="p-3">模型标签</th></tr></thead><tbody>{runs.map((run) => { const report = parseJson<{sftAllowed?:number;blocked?:number}>(run.eligibilityReportJson, {}); return <tr key={run.id} className="border-b last:border-0"><td className="p-3 font-medium">{run.name}</td><td className="p-3">{run.release.version}</td><td className="p-3">{run.parentModelVersion?.tag ?? '-'}</td><td className="p-3">SFT {report.sftAllowed ?? '-'} / 阻断 {report.blocked ?? '-'}</td><td className="p-3">{run.status}</td><td className="p-3">{run.modelTag || '-'}</td></tr>; })}</tbody></table></div>
  </div>;
}
