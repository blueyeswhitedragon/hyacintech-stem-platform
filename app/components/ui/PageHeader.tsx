import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * 页面顶栏：返回链接 + 标题 + 右侧操作位。
 *
 * 学生端与教师端的每个页面原本各自复制同一段 header markup，
 * 差异只在标题、返回目标和右侧内容。抽出来后返回链接的样式只有一处，
 * 顶栏高度和分隔线也不会再各页漂移。
 */
export default function PageHeader({
  title,
  backHref,
  backLabel,
  actions,
  meta,
  maxWidth = 'max-w-5xl',
}: {
  title: ReactNode;
  /** 有值时在标题左侧显示返回链接 */
  backHref?: string;
  backLabel?: string;
  /** 右侧内容，通常是 AuthNav */
  actions?: ReactNode;
  /** 标题右侧的次要说明，窄屏隐藏 */
  meta?: ReactNode;
  maxWidth?: string;
}) {
  return (
    <header className="border-b border-hairline bg-canvas px-4 py-4">
      <div className={`mx-auto flex ${maxWidth} items-center justify-between gap-4`}>
        <div className="flex min-w-0 items-baseline gap-4">
          {backHref && (
            <Link
              href={backHref}
              className="shrink-0 text-sm text-muted transition-colors duration-[120ms] hover:text-coral"
            >
              ← {backLabel ?? '返回'}
            </Link>
          )}
          <h1 className="display-sm min-w-0 truncate">{title}</h1>
          {meta && <span className="hidden truncate text-sm text-muted sm:inline">{meta}</span>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
