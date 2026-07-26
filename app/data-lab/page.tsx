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
import IterationTimeline from '@/app/components/dataLab/IterationTimeline';
import { listIterations } from '@/app/lib/dataLab/iterationTimeline';
import {
  dataLabModelIterationOverview,
  ensureDataLabRuntimeRegistry,
} from '@/app/lib/dataLab/runtimeRegistry';

type PipelineStatus = 'not_started' | 'in_progress' | 'waiting' | 'blocked' | 'complete';

const statusMeta: Record<PipelineStatus, { label: string; className: string; dot: string }> = {
  not_started: { label: '未开始', className: 'border-hairline bg-canvas', dot: 'bg-hairline' },
  in_progress: { label: '进行中', className: 'border-coral/40 bg-surface-soft', dot: 'bg-coral' },
  waiting: { label: '等待他人', className: 'border-warning/50 bg-surface-soft', dot: 'bg-warning' },
  blocked: { label: '门禁阻断', className: 'border-error/50 bg-surface-soft', dot: 'bg-error' },
  complete: { label: '已完成', className: 'border-success/40 bg-canvas', dot: 'bg-success' },
};

export default async function DataLabPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  if (user.role !== 'admin') {
    const pending = await tutorPersonalQueueCount(user);
    const annotator = user.role === 'annotator';
    const href = annotator ? '/data-lab/first-review' : '/data-lab/final-confirmation';
    return <div className="mx-auto max-w-4xl space-y-5">
      <div><h1 className="display-lg">{annotator ? '我的初审待办' : '我的定稿待办'}</h1><p className="mt-2 text-sm leading-6 text-muted">{annotator ? '比较两个候选并形成一份可供正式审核的导师草稿。' : '独立核对学生案例和导师回复，完成正式质量门。'}</p></div>
      <section className="border border-hairline bg-canvas px-6 py-8">
        <div className="grid gap-6 md:grid-cols-[180px_1fr]"><div><div className="text-5xl font-medium tabular-nums text-ink">{pending}</div><div className="mt-2 text-sm text-muted">当前可领取任务</div></div><div><h2 className="display-sm">{annotator ? '初审职责' : '定稿职责'}</h2><ol className="mt-4 grid gap-3 text-sm sm:grid-cols-3">{(annotator ? ['领取并理解学生案例', '比较候选、编辑导师草稿', '写明依据并提交定稿'] : ['领取并核对完整上下文', '处理自动信号并独立判断', '定稿或按问题类型退回']).map((step, index) => <li key={step} className="border-l-2 border-coral pl-3 text-body"><span className="caption-upper block">步骤 {index + 1}</span><span className="mt-1 block leading-6">{step}</span></li>)}</ol><Link href={href} className="mt-6 inline-block rounded-md bg-coral px-5 py-2.5 text-sm font-medium text-on-primary transition-colors hover:bg-coral-active">{pending ? '开始领取' : '查看工作台'}</Link></div></div>
      </section>
      {pending === 0 && <p className="border border-warning/50 bg-surface-soft p-4 text-sm leading-6 text-body">当前队列为空。可能是上游案例尚未生成、前一审尚未提交，或现有任务正被其他人处理；稍后刷新即可。</p>}
    </div>;
  }

  await ensureDataLabRuntimeRegistry(user);
  const [stats, smoke, calibration, trial, releases, trainingRuns, evaluations, models, deployments, modelIteration, iterations] = await Promise.all([
    tutorWorkflowCounts(), smokeQualityReport(), calibrationQualityReport(), trialQualityReport(),
    listReleases(), listTrainingRuns(), listEvaluations(), listModelVersions(), listModelDeployments(),
    dataLabModelIterationOverview(), listIterations(),
  ]);
  const frozenReleases = releases.filter((release) => release.status === 'FROZEN');
  const passingEvaluations = evaluations.filter((evaluation) => evaluation.gateResult === 'PASS');
  const eligibleModels = models.filter((model) => ['ELIGIBLE', 'DEPLOYED'].includes(model.status));
  const activeDeployment = deployments.find((deployment) => deployment.status === 'ACTIVE');
  const reviewPending = stats.editPending + stats.confirmPending + stats.caseQualityPending;

  let gateNotice: { text: string; href: string; action: string } | null = null;
  if (trial.pass && trial.signedOff) gateNotice = { text: '36 条试验及人工复盘已通过，可以创建 180 条正式训练集。', href: '/data-lab/case-generation', action: '创建正式集' };
  else if (trial.pass) gateNotice = { text: '36 条试验自动门禁已通过，等待团队完成人工复盘签署。', href: '/data-lab/case-generation', action: '完成签署' };
  else if (calibration.pass && !trial.runId) gateNotice = { text: '12 条校准已通过，可以创建 36 条试验批次。', href: '/data-lab/case-generation', action: '创建试验批次' };
  else if (smoke.pass && !calibration.runId) gateNotice = { text: '6 条冒烟验证已通过，可以创建 12 条校准批次。', href: '/data-lab/case-generation', action: '创建校准批次' };

  // 生产流水线只描述「数据怎么攒出来」，模型侧交给上方迭代时间轴，避免两处重复讲同一条链路。
  const pipeline: Array<{ label: string; status: PipelineStatus; next: string; href: string }> = [
    {
      label: '话题库', href: '/data-lab/topic-cards',
      status: stats.approvedTopics > 0 ? 'complete' : stats.topicDrafts > 0 ? 'in_progress' : 'not_started',
      next: stats.topicDrafts > 0 ? `审核 ${stats.topicDrafts} 张草稿` : stats.approvedTopics > 0 ? `已有 ${stats.approvedTopics} 张可用话题卡` : '导入素材或生成第一张话题卡',
    },
    {
      label: '线上回流', href: '/data-lab/candidates',
      status: stats.productionCandidatesPending > 0 ? 'waiting' : 'not_started',
      next: stats.productionCandidatesPending > 0 ? `审核 ${stats.productionCandidatesPending} 条脱敏快照` : '等待教师提名已授权会话',
    },
    {
      label: '案例批次', href: '/data-lab/case-generation',
      status: trial.pass && trial.signedOff ? 'complete' : (trial.runId && !trial.pass) || (calibration.runId && !calibration.pass) || (smoke.runId && !smoke.pass) ? 'blocked' : stats.casesReady > 0 || Boolean(smoke.runId) ? 'in_progress' : 'not_started',
      next: trial.pass && trial.signedOff ? '正式集已解锁' : stats.casesReady ? `为 ${stats.casesReady} 条案例生成双候选` : '按冒烟、校准、试验逐级扩产',
    },
    {
      label: '初审', href: '/data-lab/first-review',
      status: stats.editPending > 0 ? 'waiting' : stats.finalized > 0 || stats.confirmPending > 0 ? 'complete' : 'not_started',
      next: stats.editPending ? `等待初审 ${stats.editPending} 条` : '暂无待初审任务',
    },
    {
      label: '定稿', href: stats.caseQualityPending ? '/data-lab/case-quality' : '/data-lab/final-confirmation',
      status: stats.confirmPending > 0 || stats.caseQualityPending > 0 ? 'waiting' : stats.finalized > 0 ? 'complete' : 'not_started',
      next: stats.confirmPending ? `等待定稿 ${stats.confirmPending} 条` : stats.caseQualityPending ? `处理退回案例 ${stats.caseQualityPending} 条` : stats.finalized ? `已定稿 ${stats.finalized} 条` : '等待初审提交',
    },
    {
      label: '数据版本', href: '/data-lab/releases',
      status: frozenReleases.length > 0 ? 'complete' : stats.finalized > 0 ? 'in_progress' : 'not_started',
      next: frozenReleases.length ? `已有 ${frozenReleases.length} 个冻结版本可交付` : stats.finalized ? '选择合格数据并冻结版本' : '等待导师回合定稿',
    },
  ];

  return <div className="space-y-12">
    <div>
      <h1 className="display-lg">流水线概览</h1>
      <p className="mt-2.5 max-w-3xl text-[15px] leading-7 text-muted">
        上半部分是模型迭代主干：每一次迭代从一个冻结数据版本出发，走到灰度上线。
        下半部分是为下一次迭代积累数据的生产流水线。训练与评测在外部算力平台执行，此处只做交付与结果登记。
      </p>
    </div>

    {gateNotice && <div className="flex flex-wrap items-center justify-between gap-3 border border-success/50 bg-surface-soft px-4 py-3.5 text-sm leading-6 text-body"><span><b className="font-medium text-ink">下一层已解锁：</b>{gateNotice.text}</span><Link href={gateNotice.href} className="rounded-md bg-coral px-3.5 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-coral-active">{gateNotice.action}</Link></div>}

    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-b-hairline border-hairline pb-3">
        <div>
          <h2 className="display-md">模型迭代</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted">数据 → 训练 → 打包 → 评测 → 部署，按数据版本追溯血缘。</p>
        </div>
        <span className="text-sm text-muted">当前生产：<Link href="/data-lab/evaluations" className="font-lineage text-ink underline decoration-hairline underline-offset-4 transition-colors hover:decoration-coral">{modelIteration.activeDeployment?.runtimeBundle ? `${modelIteration.activeDeployment.runtimeBundle.name} v${modelIteration.activeDeployment.runtimeBundle.version}` : modelIteration.activeDeployment?.modelVersion.tag ?? '尚未部署'}</Link></span>
      </div>
      <IterationTimeline iterations={iterations} />
    </section>

    <section>
      <div className="mb-5 border-b border-b-hairline border-hairline pb-3">
        <h2 className="display-md">数据生产</h2>
        <p className="mt-1.5 text-sm leading-6 text-muted">为下一次迭代积累已定稿数据。案例可来自人工策划的话题卡，也可来自学生授权后的线上真实会话。</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">{pipeline.map((stage, index) => { const meta = statusMeta[stage.status]; return <Link key={stage.label} href={stage.href} className={`min-h-32 border p-4 transition-colors hover:border-coral ${meta.className}`}><div className="flex items-center justify-between gap-2"><span className="text-xs tabular-nums text-muted-soft">{index + 1}/6</span><span className="flex items-center gap-1.5 text-xs text-muted"><span className={`size-1.5 rounded-full ${meta.dot}`} />{meta.label}</span></div><h3 className="mt-3.5 text-[15px] font-medium text-ink">{stage.label}</h3><p className="mt-1.5 text-xs leading-5 text-muted">{stage.next}</p></Link>; })}</div>
      <p className="mt-3 text-sm text-muted">{reviewPending > 0 ? <>共 <span className="tabular-nums text-ink">{reviewPending}</span> 条待人工处理 · </> : null}已定稿 <span className="tabular-nums text-ink">{stats.finalized}</span> 条可进入数据版本</p>
    </section>

    <section>
      <div className="mb-5 border-b border-b-hairline border-hairline pb-3">
        <h2 className="display-md">运行时资产</h2>
        <p className="mt-1.5 text-sm leading-6 text-muted">服务连接、Prompt 策略与运行组合各自独立管理，不把 Base URL、权重和 Prompt 混成一个「模型版本」。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/data-lab/ai-services" className={`border p-4 transition-colors hover:border-coral ${modelIteration.serviceErrors ? 'border-error/50 bg-surface-soft' : 'border-hairline bg-canvas'}`}><div className="text-2xl font-medium tabular-nums text-ink">{modelIteration.serviceAvailable}</div><div className="mt-1 text-sm text-muted">可用 AI 服务</div>{modelIteration.serviceErrors > 0 && <p className="mt-1.5 text-xs text-error">{modelIteration.serviceErrors} 个连接异常</p>}</Link>
        <Link href="/data-lab/prompt-policies" className="border border-hairline bg-canvas p-4 transition-colors hover:border-coral"><div className="font-lineage text-lg text-ink">{modelIteration.prompt ?? '未设置'}</div><div className="mt-1 text-sm text-muted">当前数据生产 Prompt</div></Link>
        <Link href="/data-lab/models" className="border border-hairline bg-canvas p-4 transition-colors hover:border-coral"><div className="text-2xl font-medium tabular-nums text-ink">{modelIteration.pendingTrainingOutputs}</div><div className="mt-1 text-sm text-muted">待登记训练产物</div></Link>
        <Link href="/data-lab/runtime-bundles" className="border border-hairline bg-canvas p-4 transition-colors hover:border-coral"><div className="text-2xl font-medium tabular-nums text-ink">{modelIteration.pendingCompatibility}</div><div className="mt-1 text-sm text-muted">待完成兼容性评测</div></Link>
      </div>
      <p className="mt-3 text-sm text-muted">
        <span className="tabular-nums text-ink">{trainingRuns.length}</span> 个训练任务 ·
        {' '}<span className="tabular-nums text-ink">{passingEvaluations.length}</span> 次评测通过 ·
        {' '}<span className="tabular-nums text-ink">{eligibleModels.length}</span> 个模型具备部署资格
        {activeDeployment ? <> · 当前灰度 <span className="tabular-nums text-ink">{activeDeployment.rolloutPercent}%</span></> : null}
      </p>
    </section>

    <BackupControls />
  </div>;
}
