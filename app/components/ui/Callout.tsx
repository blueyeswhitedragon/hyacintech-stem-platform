import type { ReactNode } from 'react';

/**
 * 提示条。仓库里现在有琥珀、明黄、浅红、浅蓝四五种底色写法，
 * 其中琥珀和蓝都不在三色体系内。统一到四个语义色。
 *
 * 注意 tone="coral" 不是"另一种警告"，而是设计文档里的 callout-card-coral：
 * 整块珊瑚底、白字，用于全页唯一的主号召。别拿它做普通提示。
 */

export type CalloutTone = 'info' | 'success' | 'warning' | 'error' | 'coral';

const TONES: Record<CalloutTone, string> = {
  info: 'border-hairline bg-surface-soft text-body',
  success: 'border-success/40 bg-success/8 text-body-strong',
  warning: 'border-warning/45 bg-warning/8 text-body-strong',
  error: 'border-error/40 bg-error/8 text-body-strong',
  coral: 'border-transparent bg-coral text-on-primary',
};

export default function Callout({
  tone = 'info', title, actions, className = '', children,
}: {
  tone?: CalloutTone; title?: ReactNode; actions?: ReactNode; className?: string; children?: ReactNode;
}) {
  return (
    <div className={`rounded-lg border [padding:var(--pad-card)] ${TONES[tone]} ${className}`}>
      {title && (
        <p className={`text-sm font-medium ${tone === 'coral' ? 'text-on-primary' : 'text-ink'}`}>{title}</p>
      )}
      {children && (
        <div className={`text-sm leading-6 ${title ? 'mt-1.5' : ''} ${tone === 'coral' ? 'text-on-primary/90' : ''}`}>
          {children}
        </div>
      )}
      {actions && <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
