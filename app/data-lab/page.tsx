import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/session';
import {
  calibrationQualityReport,
  smokeQualityReport,
  trialQualityReport,
  tutorPersonalQueueCount,
  tutorWorkflowCounts,
} from '@/app/lib/dataLab/bootstrap/service';
import { listEvaluations, listReleases, listTrainingRuns } from '@/app/lib/dataLab/service';
import { listModelDeployments, listModelVersions } from '@/app/lib/modelRegistry';
import BackupControls from '@/app/components/dataLab/BackupControls';

type PipelineStatus = 'not_started' | 'in_progress' | 'waiting' | 'blocked' | 'complete';

const statusMeta: Record<PipelineStatus, { label: string; className: string; dot: string }> = {
  not_started: { label: '未开始', className: 'border-gray-200 bg-white', dot: 'bg-gray-300' },
  in_progress: { label: '进行中', className: 'border-blue-200 bg-blue-50', dot: 'bg-blue-600' },
  waiting: { label: '等待他人', className: 'border-amber-200 bg-amber-50', dot: 'bg-amber-500' },
  blocked: { label: '门禁阻断', className: 'border-red-200 bg-red-50', dot: 'bg-red-600' },
  complete: { label: '已完成', className: 'border-green-200 bg-green-50', dot: 'bg-green-600' },
};

export default async function DataLabPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  if (user.role !== 'admin') {
    const pending = await tutorPersonalQueueCount(user);
    const annotator = user.role === 'annotator';
    const href = annotator ? '/data-lab/first-review' : '/data-lab/final-confirmation';
    return <div className="mx-auto max-w-4xl space-y-4">
      <div><h1 className="text-2xl font-semibold">{annotator ? '我的初审待办' : '我的定稿待办'}</h1><p className="mt-1 text-sm text-gray-500">{annotator ? '比较两个候选并形成一份可供正式审核的导师草稿。' : '独立核对学生案例和导师回复，完成正式质量门。'}</p></div>
      <section className="border-y bg-white px-5 py-8">
        <div className="grid gap-6 md:grid-cols-[180px_1fr]"><div><div className="text-5xl font-semibold tabular-nums">{pending}</div><div className="mt-2 text-sm text-gray-500">当前可领取任务</div></div><div><h2 className="font-semibold">{annotator ? '初审职责' : '定稿职责'}</h2><ol className="mt-3 grid gap-2 text-sm sm:grid-cols-3">{(annotator ? ['领取并理解学生案例', '比较候选、编辑导师草稿', '写明依据并提交定稿'] : ['领取并核对完整上下文', '处理自动信号并独立判断', '定稿或按问题类型退回']).map((step, index) => <li key={step} className="border-l-2 border-gray-900 pl-3"><span className="block text-xs text-gray-400">步骤 {index + 1}</span>{step}</li>)}</ol><Link href={href} className="mt-5 inline-block bg-gray-950 px-5 py-2.5 text-sm text-white">{pending ? '开始领取' : '查看工作台'}</Link></div></div>
      </section>
      {pending === 0 && <p className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">当前队列为空。可能是上游案例尚未生成、前一审尚未提交，或现有任务正被其他人处理；稍后刷新即可。</p>}
    </div>;
  }

  const [stats, smoke, calibration, trial, releases, trainingRuns, evaluations, models, deployments] = await Promise.all([
    tutorWorkflowCounts(), smokeQualityReport(), calibrationQualityReport(), trialQualityReport(),
    listReleases(), listTrainingRuns(), listEvaluations(), listModelVersions(), listModelDeployments(),
  ]);
  const frozenReleases = releases.filter((release) => release.status === 'FROZEN');
  const passingEvaluations = evaluations.filter((evaluation) => evaluation.gateResult === 'PASS');
  const activeDeployment = deployments.find((deployment) => deployment.status === 'ACTIVE');
  const eligibleModels = models.filter((model) => ['ELIGIBLE', 'DEPLOYED'].includes(model.status));
  const reviewPending = stats.editPending + stats.confirmPending + stats.caseQualityPending;

  let gateNotice: { text: string; href: string; action: string } | null = null;
  if (trial.pass && trial.signedOff) gateNotice = { text: '36 条试验及人工复盘已通过，可以创建 180 条正式训练集。', href: '/data-lab/case-generation', action: '创建正式集' };
  else if (trial.pass) gateNotice = { text: '36 条试验自动门禁已通过，等待团队完成人工复盘签署。', href: '/data-lab/case-generation', action: '完成签署' };
  else if (calibration.pass && !trial.runId) gateNotice = { text: '12 条校准已通过，可以创建 36 条试验批次。', href: '/data-lab/case-generation', action: '创建试验批次' };
  else if (smoke.pass && !calibration.runId) gateNotice = { text: '6 条冒烟验证已通过，可以创建 12 条校准批次。', href: '/data-lab/case-generation', action: '创建校准批次' };

  const pipeline: Array<{ label: string; status: PipelineStatus; next: string; href: string }> = [
    {
      label: '话题库', href: '/data-lab/topic-cards',
      status: stats.approvedTopics > 0 ? 'complete' : stats.topicDrafts > 0 ? 'in_progress' : 'not_started',
      next: stats.topicDrafts > 0 ? `审核 ${stats.topicDrafts} 张草稿` : stats.approvedTopics > 0 ? `已有 ${stats.approvedTopics} 张可用话题卡` : '导入素材或生成第一张话题卡',
    },
    {
      label: '案例批次', href: '/data-lab/case-generation',
      status: trial.pass && trial.signedOff ? 'complete' : (trial.runId && !trial.pass) || (calibration.runId && !calibration.pass) || (smoke.runId && !smoke.pass) ? 'blocked' : stats.casesReady > 0 || Boolean(smoke.runId) ? 'in_progress' : 'not_started',
      next: trial.pass && trial.signedOff ? '正式集已解锁' : stats.casesReady ? `为 ${stats.casesReady} 条案例生成双候选` : '按冒烟、校准、试验逐级扩产',
    },
    {
      label: '双审', href: stats.editPending ? '/data-lab/first-review' : '/data-lab/final-confirmation',
      status: reviewPending > 0 ? 'waiting' : stats.finalized > 0 ? 'complete' : 'not_started',
      next: stats.editPending ? `等待初审 ${stats.editPending} 条` : stats.confirmPending ? `等待定稿 ${stats.confirmPending} 条` : stats.caseQualityPending ? `处理退回案例 ${stats.caseQualityPending} 条` : stats.finalized ? `已定稿 ${stats.finalized} 条` : '等待案例进入审核队列',
    },
    {
      label: '数据版本', href: '/data-lab/releases',
      status: frozenReleases.length > 0 ? 'complete' : stats.finalized > 0 ? 'in_progress' : 'not_started',
      next: frozenReleases.length ? `已有 ${frozenReleases.length} 个冻结版本可交付` : stats.finalized ? '选择合格数据并冻结版本' : '等待导师回合定稿',
    },
    {
      label: '训练与评测', href: '/data-lab/models',
      status: passingEvaluations.length > 0 || eligibleModels.length > 0 ? 'complete' : trainingRuns.length > 0 ? 'waiting' : frozenReleases.length > 0 ? 'in_progress' : 'not_started',
      next: passingEvaluations.length ? '评测已通过，登记部署' : trainingRuns.length ? '等待外部训练并回填评测' : frozenReleases.length ? '下载交付并登记外部训练' : '等待冻结数据版本',
    },
    {
      label: '部署', href: '/data-lab/models',
      status: activeDeployment?.rolloutPercent === 100 ? 'complete' : activeDeployment ? 'in_progress' : eligibleModels.length ? 'in_progress' : 'not_started',
      next: activeDeployment ? `当前灰度 ${activeDeployment.rolloutPercent}%` : eligibleModels.length ? '从 10% 开始灰度部署' : '等待模型通过评测门禁',
    },
  ];

  const cards = [
    ['待审核话题卡', stats.topicDrafts, '/data-lab/topic-cards'],
    ['已批准话题卡', stats.approvedTopics, '/data-lab/topic-cards'],
    ['待生成案例', stats.casesReady, '/data-lab/case-generation'],
    ['待初审', stats.editPending, '/data-lab/first-review'],
    ['待定稿', stats.confirmPending, '/data-lab/final-confirmation'],
    ['待处理退回案例', stats.caseQualityPending, '/data-lab/case-quality'],
    ['已定稿导师回合', stats.finalized, '/data-lab/releases'],
  ] as const;

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">数据流水线指挥台</h1><p className="mt-1 text-sm text-gray-500">查看当前批次卡在哪里，处理门禁阻断，并从下一动作直达对应工作页。</p></div>
    {gateNotice && <div className="flex flex-wrap items-center justify-between gap-3 border border-green-300 bg-green-50 p-4 text-sm text-green-950"><span><b>下一层已解锁：</b>{gateNotice.text}</span><Link href={gateNotice.href} className="bg-green-800 px-3 py-2 text-white">{gateNotice.action}</Link></div>}

    <section aria-label="六阶段数据流水线">
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">{pipeline.map((stage, index) => { const meta = statusMeta[stage.status]; return <Link key={stage.label} href={stage.href} className={`relative min-h-36 border p-4 ${meta.className} hover:border-gray-500`}><div className="flex items-center justify-between gap-2"><span className="text-xs text-gray-500">{index + 1}/6</span><span className="flex items-center gap-1 text-xs"><span className={`size-2 rounded-full ${meta.dot}`} />{meta.label}</span></div><h2 className="mt-4 font-semibold">{stage.label}</h2><p className="mt-2 text-xs leading-5 text-gray-600">{stage.next}</p><span className="absolute bottom-3 right-3 text-sm" aria-hidden="true">→</span></Link>; })}</div>
    </section>

    <section><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="font-semibold">当前工作量</h2><p className="mt-1 text-xs text-gray-500">点击数字直达对应处理页。</p></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, href]) => <Link key={label} href={href} className="border bg-white p-4 hover:border-gray-500"><div className="text-2xl font-semibold tabular-nums">{value}</div><div className="mt-1 text-sm text-gray-500">{label}</div></Link>)}</div></section>

    <section className="border-y bg-white py-5"><h2 className="font-semibold">完整交接路径</h2><div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">{[
      ['/data-lab/topic-cards', '1. 话题审核', '情境真实、路线可测、边界安全'],
      ['/data-lab/case-generation', '2. 四级扩产', '冒烟 6 → 校准 12 → 试验 36 → 正式 180'],
      ['/data-lab/first-review', '3. 初审', '形成一份可定稿的导师草稿'],
      ['/data-lab/final-confirmation', '4. 定稿', '正式人工质量门'],
      ['/data-lab/releases', '5. 数据交付', '冻结并下载给外部算力平台'],
      ['/data-lab/models', '6. 训练登记', '外部训练完成后回填模型'],
      ['/data-lab/models', '7. 评测回填', '导入产物并检查部署资格'],
      ['/data-lab/models', '8. 灰度部署', '10% → 30% → 100%'],
    ].map(([href, label, text]) => <Link key={label} href={href} className="border-l-2 border-gray-300 pl-3 hover:border-gray-900"><h3 className="text-sm font-medium">{label}</h3><p className="mt-1 text-xs leading-5 text-gray-500">{text}</p></Link>)}</div></section>

    <BackupControls />
  </div>;
}
