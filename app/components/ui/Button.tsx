"use client";

import React from 'react';

type Variant = 'primary' | 'success' | 'danger' | 'warning' | 'ghost' | 'ghost-danger';

const STYLES: Record<Variant, string> = {
  primary: 'bg-blue-500 text-white hover:bg-blue-600',
  success: 'bg-green-500 text-white hover:bg-green-600',
  danger: 'bg-red-500 text-white hover:bg-red-600',
  warning: 'bg-amber-500 text-white hover:bg-amber-600',
  ghost: 'border border-gray-300 text-gray-700 hover:bg-gray-50 bg-white',
  'ghost-danger': 'text-red-500 hover:text-red-700 hover:bg-red-50 border border-transparent',
};

type Size = 'sm' | 'md' | 'lg';

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-base',
};

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingText?: string;
  children: React.ReactNode;
}

/** 全项目统一的按钮组件。所有按钮都应使用此组件。 */
export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  children,
  disabled,
  className = '',
  ...rest
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium
        transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
        disabled:opacity-50 disabled:cursor-not-allowed
        ${STYLES[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
