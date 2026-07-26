import type { ReactNode } from 'react';

/**
 * 空态。这是简笔画真正落地最多的地方。
 *
 * 空态不该只说"暂无数据"——用户到这里通常是不知道下一步该做什么。
 * 所以强制三件套：一句说明现状、一句说明怎么开始、一个动作。
 */

export type EmptyArt = 'box' | 'flask' | 'chart' | 'doc' | 'search';

const ART: Record<EmptyArt, ReactNode> = {
  // 空盒
  box: (
    <>
      <path d="M6 18h36v22a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" className="text-ink" opacity={0.8} />
      <path d="M4 10h40v8H4z" className="text-ink" opacity={0.8} />
      <path d="M20 26h8" className="text-coral" />
    </>
  ),
  // 烧杯
  flask: (
    <>
      <path d="M19 6v13L9 36a3 3 0 0 0 2.6 4.5h24.8A3 3 0 0 0 39 36L29 19V6" className="text-ink" opacity={0.8} />
      <path d="M16 6h16" className="text-ink" opacity={0.8} />
      <path d="M14.5 30h19" className="text-coral" />
    </>
  ),
  // 折线
  chart: (
    <>
      <path d="M8 8v32h32" className="text-ink" opacity={0.8} />
      <path d="M14 32l8-9 6 5 10-14" className="text-coral" />
    </>
  ),
  // 文稿
  doc: (
    <>
      <path d="M12 6h16l8 8v28H12z" className="text-ink" opacity={0.8} />
      <path d="M28 6v8h8" className="text-ink" opacity={0.8} />
      <path d="M18 24h12M18 30h12M18 36h6" className="text-coral" />
    </>
  ),
  // 放大镜
  search: (
    <>
      <path d="M21 8a13 13 0 1 0 0 26 13 13 0 0 0 0-26Z" className="text-ink" opacity={0.8} />
      <path d="M30.5 30.5 42 42" className="text-ink" opacity={0.8} />
      <path d="M21 15v12M15 21h12" className="text-coral" />
    </>
  ),
};

export default function EmptyState({
  art = 'box', title, description, action, className = '',
}: {
  art?: EmptyArt; title: string; description?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={`flex flex-col items-center rounded-lg border border-hairline bg-surface-soft px-6 py-12 text-center ${className}`}>
      <svg
        viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-12"
      >
        {ART[art]}
      </svg>
      <h3 className="display-sm mt-5">{title}</h3>
      {description && <p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
