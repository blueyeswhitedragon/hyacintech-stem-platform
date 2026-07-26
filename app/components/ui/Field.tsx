import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

/**
 * 输入类原语。`mt-1 w-full border px-3 py-2` 这串类名在仓库里重复了 41 次，
 * 且各处的圆角、焦点态、禁用态都不一致——这里统一。
 *
 * 内边距走 --pad-control：学生端（density-roomy）自动变松，DataLab 保持紧凑，
 * 组件本身不需要判断自己在哪个房间。
 */

const CONTROL =
  'w-full rounded-md border border-hairline bg-canvas text-ink placeholder:text-muted-soft ' +
  'transition-colors duration-[120ms] focus:border-coral focus:outline-none ' +
  'focus:ring-[3px] focus:ring-coral/15 disabled:cursor-not-allowed disabled:bg-surface-soft disabled:text-muted';

const CONTROL_PAD = '[padding:var(--pad-control)] [font-size:var(--text-body)]';

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-body-strong">
      {children}
      {hint && <span className="ml-2 font-normal text-muted">{hint}</span>}
    </label>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL} ${CONTROL_PAD} ${className}`} {...rest} />;
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL} ${CONTROL_PAD} leading-[var(--leading-body)] ${className}`} {...rest} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${CONTROL} ${CONTROL_PAD} ${className}`} {...rest}>
      {children}
    </select>
  );
}

/** label + 控件 + 说明/错误的成组包装 */
export function Field({
  label, hint, error, description, htmlFor, children,
}: {
  label: string; hint?: ReactNode; error?: string | null; description?: ReactNode; htmlFor?: string; children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} hint={hint}>{label}</Label>
      {children}
      {/* 错误优先于说明：两者同时出现时，用户需要先看到怎么修 */}
      {error ? (
        <p className="mt-1.5 text-sm leading-5 text-error">{error}</p>
      ) : description ? (
        <p className="mt-1.5 text-sm leading-5 text-muted">{description}</p>
      ) : null}
    </div>
  );
}
