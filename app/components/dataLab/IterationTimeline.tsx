import Link from 'next/link';
import type { IterationSummary, NodeState } from '@/app/lib/dataLab/iterationTimeline';

const nodeMeta: Record<NodeState, { dot: string; ring: string; text: string }> = {
  done: { dot: 'bg-success', ring: 'border-success', text: 'text-body' },
  active: { dot: 'bg-coral', ring: 'border-coral', text: 'text-ink' },
  blocked: { dot: 'bg-error', ring: 'border-error', text: 'text-ink' },
  pending: { dot: 'bg-hairline', ring: 'border-hairline', text: 'text-muted' },
  // skipped 用空心点：这个环节在本条线上不存在，不该看起来像「待办」
  skipped: { dot: 'bg-transparent', ring: 'border-hairline', text: 'text-muted-soft' },
};

function Iteration({ iteration }: { iteration: IterationSummary }) {
  const countable = iteration.nodes.filter((node) => node.state !== 'skipped');
  const done = countable.filter((node) => node.state === 'done').length;

  return (
    <article className="border border-hairline bg-canvas">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-b border-b-hairline border-hairline-soft px-5 py-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="display-sm">{iteration.title}</h3>
          <span className="font-lineage truncate text-sm text-muted">{iteration.anchor}</span>
        </div>
        <span className="shrink-0 text-sm tabular-nums text-muted">{done}/{countable.length} 节点完成</span>
      </header>

      <ol className="px-5 py-4">
        {iteration.nodes.map((node, position) => {
          const meta = nodeMeta[node.state];
          const last = position === iteration.nodes.length - 1;
          return (
            <li key={node.key} className="relative flex gap-4 pb-5 last:pb-0">
              {/* 竖线连接相邻节点，最后一个不画 */}
              {!last && <span aria-hidden="true" className="absolute left-[7px] top-5 h-full w-px bg-hairline" />}
              <span className={`relative z-10 mt-1.5 size-3.5 shrink-0 rounded-full border-2 bg-canvas ${meta.ring}`}>
                <span className={`absolute inset-0.5 rounded-full ${meta.dot}`} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className={`text-sm font-medium ${meta.text}`}>{node.label}</span>
                  {node.lineage && <span className="font-lineage text-sm text-muted">{node.lineage}</span>}
                </div>
                <p className="mt-1 text-sm leading-6 text-muted">{node.detail}</p>
              </div>
              {node.action && (
                <Link
                  href={node.href}
                  className="mt-0.5 shrink-0 self-start rounded-md bg-coral px-3 py-1.5 text-[13px] font-medium text-on-primary transition-colors hover:bg-coral-active"
                >
                  {node.action}
                </Link>
              )}
            </li>
          );
        })}
      </ol>

      {iteration.nextStep && (
        <footer className="border-t border-t-hairline border-hairline-soft bg-surface-soft px-5 py-3 text-sm leading-6 text-muted">
          下一步：<span className="text-ink">{iteration.nextStep.label}</span> · {iteration.nextStep.detail}
        </footer>
      )}
    </article>
  );
}

export default function IterationTimeline({ iterations }: { iterations: IterationSummary[] }) {
  if (iterations.length === 0) {
    return (
      <div className="border border-hairline bg-surface-soft px-6 py-8">
        <h3 className="display-sm">还没有可追溯的迭代</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          一次迭代从冻结数据版本开始，依次经过外部训练、打包运行组合、六阶段评测，最后灰度上线。
          先在下方数据生产流水线积累已定稿数据，再到数据版本交付台冻结第一个版本。
        </p>
        <Link
          href="/data-lab/releases"
          className="mt-5 inline-block rounded-md bg-coral px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-coral-active"
        >
          前往数据版本
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {iterations.map((iteration) => (
        <Iteration key={iteration.id} iteration={iteration} />
      ))}
    </div>
  );
}
