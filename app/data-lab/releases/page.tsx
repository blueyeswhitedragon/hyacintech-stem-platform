import { redirect } from 'next/navigation';
import Link from 'next/link';
import ReleaseManager, { ReleaseArtifactCard } from '@/app/components/dataLab/ReleaseManager';
import { listReleases } from '@/app/lib/dataLab/service';
import { listFinalizedTutorTurns } from '@/app/lib/dataLab/bootstrap/service';
import { getCurrentUser } from '@/app/lib/session';
import { caseStageContractVersion, tutorCohortReasons } from '@/app/lib/dataLab/trainingCohort';
import { buttonClass } from '@/app/components/ui/Button';

export default async function ReleasesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const [releases, turns] = await Promise.all([listReleases(), listFinalizedTutorTurns()]);
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">数据版本交付台</h1><p className="mt-1 text-sm text-muted">选择具备训练资格的已定稿数据，冻结为不可修改版本，再下载交给外部算力平台。</p></div>
    <div className="grid gap-2 text-sm sm:grid-cols-3"><div className="border-b-2 border-ink pb-2"><b>1. 选择数据</b><p className="mt-1 text-xs text-muted">不合格条目会说明阻断原因</p></div><div className="border-b-2 border-ink pb-2"><b>2. 创建并冻结</b><p className="mt-1 text-xs text-muted">冻结后不可修改</p></div><div className="border-b-2 border-ink pb-2"><b>3. 下载交付</b><p className="mt-1 text-xs text-muted">按用途交给算力平台或存档</p></div></div>
    <ReleaseManager turns={turns.map((turn) => {
      const cohort = {
        promptVersion: turn.case.promptVersion,
        tutorContractVersion: turn.case.contractVersion,
        stageContractVersion: caseStageContractVersion(turn.case.hardCheckJson) ?? '未知',
        extractorVersion: turn.case.extractorVersion,
      };
      const blockers = [
        ...(turn.trainingEligibility === 'SFT_ALLOWED' ? [] : ['训练资格未通过']),
        ...(turn.case.split === 'EVAL' ? ['评测集不能进入训练 Release'] : []),
        ...tutorCohortReasons({
          contractVersion: cohort.tutorContractVersion,
          stageContractVersion: cohort.stageContractVersion,
          extractorVersion: cohort.extractorVersion,
          promptVersion: cohort.promptVersion,
        }),
      ];
      return {
        id: turn.id,
        label: turn.case.topicCard?.displayTitle ?? '生产会话回流',
        phase: turn.case.phase,
        eligible: blockers.length === 0,
        provenance: turn.draftProvenance,
        reviewerEditType: (() => { try { return (JSON.parse(turn.reviewerEditMetricsJson) as { type?: string }).type ?? 'UNKNOWN'; } catch { return 'UNKNOWN'; } })(),
        cohort,
        preview: { system: turn.case.systemPrompt, human: turn.case.studentMessage, gpt: turn.finalOutputJson },
        blockers,
      };
    })} />

    <section><div className="mb-3"><h2 className="font-semibold">可下载版本</h2><p className="mt-1 text-xs text-muted">交付前请同时下载校验清单，双方用文件校验值核对完整性。</p></div><div className="space-y-3">{releases.map((release) => {
      const kinds = [
        ...(release.trainingPath ? ['training'] : []),
        ...(release.preferencePath ? ['preference'] : []),
        ...(release.manifestPath ? ['manifest'] : []),
        ...(release.cleanPath ? ['clean'] : []),
        ...(release.goldPath ? ['gold'] : []),
        ...(release.silverPath ? ['silver'] : []),
      ];
      const parseObject = (value: string) => { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } };
      return <ReleaseArtifactCard key={release.id} release={{
        id: release.id,
        version: release.version,
        status: release.status,
        itemCount: release._count.items,
        trainingRunCount: release._count.trainingRuns,
        kinds,
        cohort: parseObject(release.trainingCohortJson),
        summary: parseObject(release.summaryJson),
        checksums: {
          clean: release.cleanSha256,
          gold: release.goldSha256,
          silver: release.silverSha256,
          training: release.trainingSha256,
          preference: release.preferenceSha256,
          manifest: release.manifestSha256,
        },
      }} />;
    })}{releases.length === 0 && <p className="border border-hairline bg-canvas p-6 text-sm text-muted">还没有数据版本。先从上方选择具备训练资格的已定稿数据。</p>}</div></section>
    <div className="flex flex-wrap items-center justify-between gap-3 border border-info/40 bg-info/8 p-4 text-sm text-body-strong"><span>外部训练完成后，在“模型与训练”登记训练任务和输出模型，再回填评测产物。</span><Link href="/data-lab/models#training-create" className={buttonClass('secondary', 'sm')}>前往模型与训练</Link></div>
  </div>;
}
