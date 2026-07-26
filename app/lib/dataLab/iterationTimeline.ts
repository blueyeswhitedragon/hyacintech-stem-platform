import 'server-only';
import { db } from '@/app/lib/db';

/**
 * 「一次迭代」= 一个冻结数据版本向前走完的五个节点：
 *   数据(Release) → 训练(TrainingRun) → 打包(RuntimeBundle) → 评测(EvaluationRun) → 部署(Deployment)
 *
 * 这些记录本来分散在五个页面，只能靠人工对版本号拼血缘。此处沿关系链正向组装，
 * 让概览页一屏说清「这次迭代走到哪、下一步该点哪」。
 *
 * 例外：线上跑着的基线模型往往不来自任何数据版本（供应商模型或 model:bootstrap 登记），
 * 沿 Release 正向走永远碰不到它。因此额外补一条以模型为锚的基线条目，
 * 否则「还没冻结第一个版本」的新服务器上时间轴会是空的，而线上其实已有模型在服务。
 */

export type NodeState = 'done' | 'active' | 'blocked' | 'pending' | 'skipped';

export interface TimelineNode {
  key: 'data' | 'training' | 'bundle' | 'evaluation' | 'deployment';
  label: string;
  state: NodeState;
  /** 版本号 / tag，用衬线体渲染 */
  lineage: string | null;
  detail: string;
  href: string;
  action: string | null;
}

export interface IterationSummary {
  id: string;
  kind: 'release' | 'baseline';
  title: string;
  /** 锚点标识：数据版本号，或基线模型 tag */
  anchor: string;
  nodes: TimelineNode[];
  /** 整条链上第一个未完成节点，用于「下一步」提示 */
  nextStep: { label: string; detail: string; href: string; action: string } | null;
}

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

const BUNDLE_READY = ['AVAILABLE', 'DEPLOYED'];

function nextStepOf(nodes: TimelineNode[]) {
  const pending = nodes.find((node) => node.state !== 'done' && node.state !== 'skipped' && node.action);
  return pending ? { label: pending.label, detail: pending.detail, href: pending.href, action: pending.action! } : null;
}

export async function listIterations(limit = 4): Promise<IterationSummary[]> {
  const [releases, deployments] = await Promise.all([
    db.datasetRelease.findMany({
      where: { status: 'FROZEN' },
      orderBy: { frozenAt: 'desc' },
      take: limit,
      include: {
        _count: { select: { items: true } },
        trainingRuns: {
          orderBy: { createdAt: 'desc' },
          include: {
            outputModelVersion: { select: { id: true, tag: true, status: true } },
            promptPolicyVersion: { select: { version: true } },
          },
        },
      },
    }),
    db.modelDeployment.findMany({
      orderBy: { createdAt: 'desc' },
      include: { modelVersion: { select: { id: true, tag: true, trainingRunId: true } } },
    }),
  ]);

  // 收集这批迭代产出的模型，连同线上基线模型，一次性取回下游组合/评测，避免逐条 N+1。
  const releaseModelIds = releases.flatMap((release) =>
    release.trainingRuns.map((run) => run.outputModelVersion?.id).filter((id): id is string => Boolean(id)),
  );
  const baselineDeployment = deployments.find(
    (deployment) => deployment.status === 'ACTIVE' && !deployment.modelVersion.trainingRunId,
  );
  const baselineModel = baselineDeployment && !releaseModelIds.includes(baselineDeployment.modelVersion.id)
    ? baselineDeployment.modelVersion
    : null;

  const modelIds = [...new Set([...releaseModelIds, ...(baselineModel ? [baselineModel.id] : [])])];
  const [bundles, evaluations] = modelIds.length
    ? await Promise.all([
        db.runtimeBundle.findMany({
          where: { modelVersionId: { in: modelIds } },
          orderBy: { createdAt: 'desc' },
          include: { promptPolicyVersion: { select: { version: true } }, endpoint: { select: { displayName: true } } },
        }),
        db.evaluationRun.findMany({
          where: { OR: [{ modelBVersionId: { in: modelIds } }, { modelAVersionId: { in: modelIds } }] },
          orderBy: { createdAt: 'desc' },
        }),
      ])
    : [[], []];

  const iterations: IterationSummary[] = releases.map((release, position) => {
    const runs = release.trainingRuns;
    const succeeded = runs.find((run) => run.status === 'SUCCEEDED');
    const model = succeeded?.outputModelVersion ?? runs.find((run) => run.outputModelVersion)?.outputModelVersion ?? null;
    const bundle = model ? bundles.find((item) => item.modelVersionId === model.id) ?? null : null;
    const evaluation = model
      ? evaluations.find((item) => item.modelBVersionId === model.id || item.modelAVersionId === model.id) ?? null
      : null;
    const deployment = model ? deployments.find((item) => item.modelVersionId === model.id) ?? null : null;

    const activeRun = runs.find((run) => ['SUBMITTED', 'RUNNING'].includes(run.status));
    const failedRun = runs.find((run) => run.status === 'FAILED');
    const gate = evaluation?.gateResult ?? null;
    const failures = evaluation ? parseJson<{ failures?: string[] }>(evaluation.gateReportJson, {}).failures ?? [] : [];
    const rollout = deployment?.rolloutPercent ?? null;
    const bundleReady = bundle ? BUNDLE_READY.includes(bundle.status) : false;

    const nodes: TimelineNode[] = [
      {
        key: 'data', label: '数据', state: 'done', lineage: release.version,
        detail: `已冻结 ${release._count.items} 条，可下载交付`,
        href: '/data-lab/releases', action: null,
      },
      {
        key: 'training', label: '训练',
        state: succeeded ? 'done' : failedRun && !activeRun ? 'blocked' : activeRun ? 'active' : 'pending',
        lineage: succeeded?.name ?? activeRun?.name ?? failedRun?.name ?? null,
        detail: succeeded
          ? model ? `已登记产物 ${model.tag}` : '训练成功，待登记输出模型'
          : activeRun ? '外部算力平台运行中，完成后回填状态'
          : failedRun ? '训练失败，需排查后重新登记任务'
          : '下载交付后登记外部训练任务',
        href: '/data-lab/models',
        action: succeeded && !model ? '登记训练输出' : succeeded ? null : activeRun ? '回填训练状态' : '登记训练任务',
      },
      {
        key: 'bundle', label: '打包',
        state: bundle ? (bundleReady ? 'done' : 'active') : 'pending',
        lineage: bundle ? `${bundle.name} v${bundle.version}` : null,
        detail: bundle
          ? `${bundle.promptPolicyVersion.version} · ${bundle.endpoint.displayName}${bundleReady ? '' : '（待完成兼容性评测）'}`
          : model ? '把模型、Prompt 策略和 Endpoint 组成可部署运行组合' : '等待训练产物登记',
        href: '/data-lab/runtime-bundles',
        action: bundle ? (bundleReady ? null : '完成兼容性评测') : model ? '创建运行组合' : null,
      },
      {
        key: 'evaluation', label: '评测',
        state: gate === 'PASS' ? 'done' : gate === 'FAIL' ? 'blocked' : evaluation ? 'active' : 'pending',
        lineage: evaluation?.name ?? null,
        detail: gate === 'PASS' ? '六阶段门禁通过，可开始灰度'
          : gate === 'FAIL' ? `门禁未通过：${failures.length} 项待修复`
          : gate === 'INSUFFICIENT' ? '评测产物不完整，需重新导出 verdict'
          : evaluation ? '等待导入 A/B 评测产物'
          : bundle ? '创建 A/B 评测并导入六阶段产物' : '等待运行组合就绪',
        href: '/data-lab/evaluations',
        action: gate === 'PASS' ? null : evaluation ? '查看门禁结论' : bundle ? '创建 A/B 评测' : null,
      },
      {
        key: 'deployment', label: '部署',
        state: deployment?.status === 'ACTIVE' && rollout === 100 ? 'done'
          : deployment?.status === 'ACTIVE' ? 'active'
          : deployment?.status === 'ROLLED_BACK' ? 'blocked' : 'pending',
        lineage: deployment ? `${rollout}%` : null,
        detail: deployment?.status === 'ACTIVE' && rollout === 100 ? '已全量上线'
          : deployment?.status === 'ACTIVE' ? `灰度 ${rollout}% 观察中，达标后可推进`
          : deployment?.status === 'ROLLED_BACK' ? '已回滚，会话已重新钉回基线'
          : gate === 'PASS' ? '从 10% 开始灰度' : '等待评测门禁通过',
        href: '/data-lab/evaluations',
        action: deployment?.status === 'ACTIVE' && rollout !== 100 ? '推进灰度' : gate === 'PASS' && !deployment ? '开始灰度' : null,
      },
    ];

    return {
      id: release.id,
      kind: 'release' as const,
      title: `迭代 ${releases.length - position}`,
      anchor: release.version,
      nodes,
      nextStep: nextStepOf(nodes),
    };
  });

  if (baselineModel && baselineDeployment) {
    const bundle = bundles.find((item) => item.modelVersionId === baselineModel.id) ?? null;
    const evaluation = evaluations.find(
      (item) => item.modelBVersionId === baselineModel.id || item.modelAVersionId === baselineModel.id,
    ) ?? null;
    const bundleReady = bundle ? BUNDLE_READY.includes(bundle.status) : false;
    const rollout = baselineDeployment.rolloutPercent;

    // 基线没有数据/训练来源，这两个节点标 skipped 而非 pending——
    // 它不是「还没做」，而是这条线上本来就不存在的环节。
    const nodes: TimelineNode[] = [
      {
        key: 'data', label: '数据', state: 'skipped', lineage: null,
        detail: '不来自 Data Lab 数据版本', href: '/data-lab/releases', action: null,
      },
      {
        key: 'training', label: '训练', state: 'skipped', lineage: null,
        detail: '外部既有模型，无本地训练任务', href: '/data-lab/models', action: null,
      },
      {
        key: 'bundle', label: '打包',
        state: bundle ? (bundleReady ? 'done' : 'active') : 'pending',
        lineage: bundle ? `${bundle.name} v${bundle.version}` : null,
        detail: bundle
          ? `${bundle.promptPolicyVersion.version} · ${bundle.endpoint.displayName}${bundleReady ? '' : '（待完成兼容性评测）'}`
          : '尚未组成运行组合，当前直接按环境变量调用',
        href: '/data-lab/runtime-bundles',
        action: bundle ? (bundleReady ? null : '完成兼容性评测') : '创建运行组合',
      },
      {
        key: 'evaluation', label: '评测',
        state: evaluation?.gateResult === 'PASS' ? 'done' : evaluation ? 'active' : 'pending',
        lineage: evaluation?.name ?? null,
        detail: evaluation?.gateResult === 'PASS' ? '六阶段门禁通过'
          : evaluation ? '等待导入 A/B 评测产物'
          : '作为后续候选的对照基线',
        href: '/data-lab/evaluations',
        action: evaluation && evaluation.gateResult !== 'PASS' ? '查看门禁结论' : null,
      },
      {
        key: 'deployment', label: '部署',
        state: rollout === 100 ? 'done' : 'active',
        lineage: `${rollout}%`,
        detail: rollout === 100 ? '当前全量服务学生端' : `灰度 ${rollout}% 服务中`,
        href: '/data-lab/evaluations', action: null,
      },
    ];

    iterations.push({
      id: baselineDeployment.id,
      kind: 'baseline',
      title: '线上基线',
      anchor: baselineModel.tag,
      nodes,
      nextStep: nextStepOf(nodes),
    });
  }

  return iterations;
}
