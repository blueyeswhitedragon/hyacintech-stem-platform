import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

/**
 * 表格原语。DataLab 大量比对版本号、状态、计数，表格是那边的主要载体。
 *
 * 两个刻意的选择：
 * - 表头用 caption-upper（12px 大写字距），不用加粗黑字。密集表格里，
 *   靠字距和弱化颜色分层比靠字重更耐看。
 * - 数字列用 tabular-nums 等宽，否则一列版本号/计数会左右横跳。
 */

export default function Table({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-hairline ${className}`}>
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-hairline bg-surface-soft">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-hairline-soft">{children}</tbody>;
}

export function TR({ className = '', children }: { className?: string; children: ReactNode }) {
  return <tr className={`transition-colors duration-[120ms] hover:bg-surface-soft/60 ${className}`}>{children}</tr>;
}

interface CellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export function TH({ numeric, className = '', children, ...rest }: CellProps) {
  return (
    <th
      scope="col"
      className={`caption-upper whitespace-nowrap px-3 py-2.5 ${numeric ? 'text-right' : 'text-left'} ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({ numeric, className = '', children, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td className={`px-3 py-2.5 align-top ${numeric ? 'text-right tabular-nums' : ''} ${className}`} {...rest}>
      {children}
    </td>
  );
}
