"use client";

import React, { useState } from 'react';
import Button from './ui/Button';

interface Props {
  label: string;
  loadingLabel?: string;
  successLabel?: string;
  variant?: 'primary' | 'success' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onSubmit: () => Promise<string | null>;
  autoReset?: boolean;
}

/**
 * 提交/保存按钮的标准化封装。
 * 管理 loading / error / success 状态，统一展示样式。
 *
 * 用法：
 *   <SubmitButton label="保存" onSubmit={saveFn} />
 *   <SubmitButton label="提交方案" variant="success" loadingLabel="提交中…" onSubmit={submitFn} />
 */
export default function SubmitButton({
  label,
  loadingLabel,
  successLabel,
  variant = 'success',
  size = 'md',
  disabled = false,
  onSubmit,
  autoReset = true,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    setOk(false);
    const err = await onSubmit();
    setBusy(false);
    if (err) {
      setError(err);
    } else {
      setOk(true);
      if (autoReset) {
        setTimeout(() => setOk(false), 2500);
      }
    }
  };

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <Button
        variant={ok ? 'ghost' : variant}
        size={size}
        loading={busy}
        loadingText={loadingLabel ?? label}
        disabled={disabled}
        onClick={handleClick}
      >
        {ok ? (successLabel ?? '✓ 已保存') : label}
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
