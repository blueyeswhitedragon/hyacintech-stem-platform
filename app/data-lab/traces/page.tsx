import { redirect } from 'next/navigation';
import Link from 'next/link';
import { dataLabStatusLabel, dataLabValueLabel, TRACE_COVERAGE_LABELS, TRIGGER_TYPE_LABELS } from '@/app/lib/dataLab/labels';
import { listGenerationTraceLineage } from '@/app/lib/modelRegistry';
import { getCurrentUser } from '@/app/lib/session';
import { buttonClass } from '@/app/components/ui/Button';
import { Input } from '@/app/components/ui/Field';

function shortHash(value: string) {
  return value ? `${value.slice(0, 16)}...` : '未记录';
}

export default async function GenerationTracesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const { q = '' } = await searchParams;
  const traces = await listGenerationTraceLineage({ query: q, take: 100 });

  return <div className="space-y-5">
    <header><h1 className="text-2xl font-semibold">生成追踪</h1><p className="mt-1 text-sm text-muted">按会话和消息追溯每条导师回复实际使用的模型、运行组合、Prompt、合同与内容哈希。页面不展示学生消息或完整 Prompt。</p></header>
    <form className="flex flex-wrap gap-2 border border-hairline bg-canvas p-4">
      <Input name="q" defaultValue={q} placeholder="搜索轨迹 ID、会话 ID、消息 ID、模型标签或 Prompt 版本" className="flex-1" />
      <button className={buttonClass('primary', 'md')}>查询</button>
      {q && <Link href="/data-lab/traces" className="border border-hairline px-4 py-2 text-sm">清除</Link>}
    </form>
    <p className="text-xs text-muted">显示最新 {traces.length} 条，最多 100 条。Release 只通过“模型训练来源”展示；GenerationTrace 本身没有 Release 外键。</p>

    <div className="space-y-3">{traces.map((trace) => {
      const assignment = trace.conversation.studentAssignment?.assignment;
      const trainedFrom = trace.modelVersion.trainingRun;
      return <article key={trace.id} className="border border-hairline bg-canvas p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs text-muted">{trace.createdAt.toLocaleString('zh-CN')} · P{trace.stage} · {TRIGGER_TYPE_LABELS[trace.triggerType] ?? dataLabValueLabel(trace.triggerType)}</div><h2 className="mt-1 font-mono text-sm">Trace {trace.id}</h2><p className="mt-1 text-xs text-muted">会话 {trace.conversationId} · 助手消息 {trace.assistantMessageId}</p></div><span className="bg-surface-card px-2 py-1 text-xs">{TRACE_COVERAGE_LABELS[trace.conversation.traceCoverage] ?? '轨迹状态待确认'}</span></div>
        <div className="mt-4 grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-4">
          <div className="border border-hairline bg-surface-soft p-3"><b>学生与任务</b><p className="mt-2 leading-5">{trace.conversation.user.displayName}（{trace.conversation.user.username}）<br />{assignment ? `${assignment.class.name} · ${assignment.title}` : '未关联作业'}</p></div>
          <div className="border border-hairline bg-surface-soft p-3"><b>实际生成身份</b><p className="mt-2 leading-5">{trace.modelTagSnapshot}<br />{trace.providerSnapshot} · {trace.externalModelSnapshot}<br />模型记录：{trace.modelVersion.tag}</p></div>
          <div className="border border-hairline bg-surface-soft p-3"><b>本次运行组合</b><p className="mt-2 leading-5">{trace.runtimeBundle ? `${trace.runtimeBundle.name} v${trace.runtimeBundle.version}` : '历史调用，无运行组合'}{trace.runtimeBundle && <><br />{trace.runtimeBundle.endpoint.displayName} · {trace.runtimeBundle.endpoint.remoteModelId}</>}</p></div>
          <div className="border border-hairline bg-surface-soft p-3"><b>会话固定路由</b><p className="mt-2 leading-5">{trace.conversation.deployedRuntimeBundle ? `${trace.conversation.deployedRuntimeBundle.name} v${trace.conversation.deployedRuntimeBundle.version}` : trace.conversation.deployedModelVersion?.tag ?? '无可核验的部署固定记录'}</p></div>
        </div>
        <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
          <div className="border border-hairline p-3"><b>Prompt 与合同</b><p className="mt-2 leading-5">{trace.promptVersion}<br />Prompt SHA-256：<code title={trace.promptSha256}>{shortHash(trace.promptSha256)}</code><br />{trace.contractVersion}</p></div>
          <div className="border border-hairline p-3"><b>请求与响应指纹</b><p className="mt-2 leading-5">请求：<code title={trace.requestMessageSha256}>{shortHash(trace.requestMessageSha256)}</code><br />响应：<code title={trace.responseSha256}>{shortHash(trace.responseSha256)}</code></p></div>
          <div className="border border-hairline p-3"><b>模型训练来源</b><p className="mt-2 leading-5">{trainedFrom ? `${trainedFrom.release.version} · ${trainedFrom.name}` : '外部基座或未登记训练来源'}</p></div>
        </div>
        {trace.productionCandidate && <div className="mt-3 flex flex-wrap items-center gap-2 border border-info/40 bg-info/8 p-3 text-xs text-body-strong"><b>生产回流候选</b><span>{dataLabStatusLabel(trace.productionCandidate.status)}</span><Link href="/data-lab/candidates" className="ml-auto underline">查看线上候选审核</Link></div>}
      </article>;
    })}{traces.length === 0 && <p className="border border-hairline bg-canvas p-5 text-sm text-muted">没有匹配的生成轨迹。</p>}</div>
  </div>;
}
