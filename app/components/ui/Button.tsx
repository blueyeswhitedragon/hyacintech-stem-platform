import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from 'react';
import Link from 'next/link';

/**
 * 全站按钮。建这个原语的直接原因：50 个文件各写各的按钮类名，
 * 同一串「深灰实心 + px-4 py-2 + 白字」复制了 8 次，
 * 于是每加一个功能就多一种按钮。样式集中在这里才谈得上"保持"风格。
 *
 * 珊瑚是稀缺资源：primary 才用。一屏里出现两个珊瑚按钮，通常说明
 * 其中一个应该是 secondary。
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-coral text-on-primary hover:bg-coral-active active:bg-coral-active',
  secondary: 'border border-hairline bg-canvas text-ink hover:bg-surface-soft',
  ghost: 'text-body hover:bg-surface-soft hover:text-ink',
  // 破坏性操作用描边而非实心：实心红在奶油底上过于跳，且会和珊瑚抢主次
  danger: 'border border-error/40 bg-canvas text-error hover:bg-error/8',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-5 text-sm',
};

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium ' +
  'transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-40';

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = '') {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.trim();
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export default function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 透传给 next/link：分页这类「原地换内容」的导航需要 false，否则每次翻页都跳回页首 */
  scroll?: boolean;
}

/** 视觉上是按钮、语义上是导航的场景（时间轴的「下一步」等） */
export function ButtonLink({ href, variant = 'secondary', size = 'md', className = '', scroll, ...rest }: ButtonLinkProps) {
  return <Link href={href} scroll={scroll} className={buttonClass(variant, size, className)} {...rest} />;
}
