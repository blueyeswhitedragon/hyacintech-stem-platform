import type { ReactNode } from 'react';

/**
 * 卡片与区块标题。
 *
 * 设计文档的深浅节奏是 cream → cream-card → dark，靠表面色差分层，不靠阴影。
 * 这里只暴露三种表面，堵住"再来一种灰"的口子。
 */

export type CardTone = 'plain' | 'soft' | 'dark';

const TONES: Record<CardTone, string> = {
  plain: 'border border-hairline bg-canvas text-body',
  soft: 'border border-hairline-soft bg-surface-soft text-body',
  dark: 'bg-surface-dark text-on-dark',
};

export default function Card({
  tone = 'plain', className = '', padded = true, children,
}: {
  tone?: CardTone; className?: string; padded?: boolean; children: ReactNode;
}) {
  return (
    <div className={`rounded-lg ${TONES[tone]} ${padded ? '[padding:var(--pad-card)]' : ''} ${className}`}>
      {children}
    </div>
  );
}

/** 区块标题：标题 + 可选说明 + 右侧操作位 */
export function SectionHeader({
  title, description, actions, className = '',
}: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <div className={`mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-hairline pb-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="display-md">{title}</h2>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
