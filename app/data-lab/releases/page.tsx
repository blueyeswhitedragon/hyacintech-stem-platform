import ReleaseManager, {
  FreezeReleaseButton,
} from '@/app/components/dataLab/ReleaseManager';
import { listCampaigns, listReleases } from '@/app/lib/dataLab/service';

export default async function ReleasesPage() {
  const [campaigns, releases] = await Promise.all([
    listCampaigns(),
    listReleases(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">数据集版本</h1>
        <p className="mt-1 text-sm text-gray-500">
          冻结后不可修改；clean 保持人工审定记录，training 额外写入模型可见的
          system 风格指令；preference 保存人工 chosen 与模型 rejected，实际风格和训练资格记录在 manifest。
        </p>
      </div>

      <ReleaseManager
        campaigns={campaigns.map((item) => ({ id: item.id, name: item.name }))}
      />

      <div className="overflow-x-auto border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="p-3">版本</th>
              <th className="p-3">状态</th>
              <th className="p-3">样本</th>
              <th className="p-3">训练任务</th>
              <th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {releases.map((release) => {
              const exportKinds = [
                'clean',
                'gold',
                'silver',
                ...(release.trainingPath ? (['training'] as const) : []),
                ...(release.preferencePath ? (['preference'] as const) : []),
                'manifest',
              ] as const;

              return (
                <tr key={release.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{release.version}</td>
                  <td className="p-3">{release.status}</td>
                  <td className="p-3">{release._count.items}</td>
                  <td className="p-3">{release._count.trainingRuns}</td>
                  <td className="p-3">
                    {release.status === 'DRAFT' ? (
                      <FreezeReleaseButton id={release.id} />
                    ) : (
                      <div>
                        <div className="flex flex-wrap gap-2">
                          {exportKinds.map((kind) => (
                            <a
                              key={kind}
                              href={`/api/data-lab/releases/${release.id}/export/${kind}`}
                              className={`text-xs hover:underline ${
                                kind === 'training'
                                  ? 'font-medium text-emerald-700'
                                  : 'text-blue-700'
                              }`}
                            >
                              {kind}
                            </a>
                          ))}
                        </div>
                        {!release.trainingPath && (
                          <p className="mt-1 text-xs text-gray-400">
                            旧版本未生成风格训练导出
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
