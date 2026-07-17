import { redirect } from 'next/navigation';
import Link from 'next/link';
import ReleaseManager, { FreezeReleaseButton } from '@/app/components/dataLab/ReleaseManager';
import { listReleases } from '@/app/lib/dataLab/service';
import { listFinalizedTutorTurns } from '@/app/lib/dataLab/bootstrap/service';
import { getCurrentUser } from '@/app/lib/session';
import { DATA_LAB_STATUS_LABELS, EXPORT_KIND_META } from '@/app/lib/dataLab/labels';

export default async function ReleasesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const [releases, turns] = await Promise.all([listReleases(), listFinalizedTutorTurns()]);
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">数据版本交付台</h1><p className="mt-1 text-sm text-gray-500">选择具备训练资格的已定稿数据，冻结为不可修改版本，再下载交给外部算力平台。</p></div>
    <div className="grid gap-2 text-sm sm:grid-cols-3"><div className="border-b-2 border-gray-900 pb-2"><b>1. 选择数据</b><p className="mt-1 text-xs text-gray-500">不合格条目会说明阻断原因</p></div><div className="border-b-2 border-gray-900 pb-2"><b>2. 创建并冻结</b><p className="mt-1 text-xs text-gray-500">冻结后不可修改</p></div><div className="border-b-2 border-gray-900 pb-2"><b>3. 下载交付</b><p className="mt-1 text-xs text-gray-500">按用途交给算力平台或存档</p></div></div>
    <ReleaseManager turns={turns.map((turn) => ({ id: turn.id, label: turn.case.topicCard?.displayTitle ?? '生产会话回流', phase: turn.case.phase, eligible: turn.trainingEligibility === 'SFT_ALLOWED' && turn.case.split !== 'EVAL', provenance: turn.draftProvenance, reviewerEditType: (() => { try { return (JSON.parse(turn.reviewerEditMetricsJson) as { type?: string }).type ?? 'UNKNOWN'; } catch { return 'UNKNOWN'; } })() }))} />

    <section><div className="mb-3"><h2 className="font-semibold">可下载版本</h2><p className="mt-1 text-xs text-gray-500">交付前请同时下载校验清单，双方用文件校验值核对完整性。</p></div><div className="space-y-3">{releases.map((release) => {
      const kinds = [
        ...(release.trainingPath ? ['training'] : []),
        ...(release.preferencePath ? ['preference'] : []),
        ...(release.manifestPath ? ['manifest'] : []),
        ...(release.cleanPath ? ['clean'] : []),
        ...(release.goldPath ? ['gold'] : []),
        ...(release.silverPath ? ['silver'] : []),
      ];
      return <article key={release.id} className="border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{release.version}</h3><p className="mt-1 text-xs text-gray-500">{DATA_LAB_STATUS_LABELS[release.status] ?? '状态待确认'} · {release._count.items} 条数据 · 已登记 {release._count.trainingRuns} 次外部训练</p></div>{release.status === 'DRAFT' && <FreezeReleaseButton id={release.id} />}</div>{release.status === 'FROZEN' && <div className="mt-4 grid gap-2 md:grid-cols-2">{kinds.map((kind) => { const meta = EXPORT_KIND_META[kind] ?? { label: '其他导出', help: '用于兼容历史版本' }; return <a key={kind} href={`/api/data-lab/releases/${release.id}/export/${kind}`} className="border p-3 hover:border-blue-500"><b className="text-sm">{meta.label}</b><span className="ml-2 text-xs text-gray-400">{kind}.json</span><p className="mt-1 text-xs text-gray-500">{meta.help}</p></a>; })}</div>}</article>;
    })}{releases.length === 0 && <p className="border bg-white p-6 text-sm text-gray-500">还没有数据版本。先从上方选择具备训练资格的已定稿数据。</p>}</div></section>
    <div className="flex flex-wrap items-center justify-between gap-3 border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><span>外部训练完成后，在模型档案中登记训练任务和输出模型，再回填评测产物。</span><Link href="/data-lab/models#training" className="bg-blue-800 px-3 py-2 text-white">前往模型档案</Link></div>
  </div>;
}
