import type { ReactNode } from 'react';

/**
 * 状态徽章。
 *
 * 现状是同一个"通过/失败/进行中"在不同页面用了浅绿底、翡翠底、绿点三种画法。
 * 状态色只有四个（success/warning/error/info），全部走低饱和描边而非实心填充：
 * 实心色块在奶油底上会盖过珊瑚 CTA，破坏"珊瑚才是最强信号"的层级。
 */

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'coral';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-hairline bg-surface-card text-body',
  success: 'border-success/35 bg-success/10 text-[#2f7a43]',
  warning: 'border-warning/40 bg-warning/10 text-[#8a6a0f]',
  error: 'border-error/35 bg-error/10 text-error',
  info: 'border-info/40 bg-info/10 text-[#2f7f70]',
  coral: 'border-coral/40 bg-coral/10 text-coral-active',
};

export default function Badge({
  tone = 'neutral', className = '', children,
}: {
  tone?: BadgeTone; className?: string; children: ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** 带小圆点的状态徽章，用于"运行中/已停止"这类需要一眼扫的场景 */
export function StatusDot({ tone = 'neutral' }: { tone?: BadgeTone }) {
  const dot: Record<BadgeTone, string> = {
    neutral: 'bg-muted-soft', success: 'bg-success', warning: 'bg-warning',
    error: 'bg-error', info: 'bg-info', coral: 'bg-coral',
  };
  return <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dot[tone]}`} />;
}
