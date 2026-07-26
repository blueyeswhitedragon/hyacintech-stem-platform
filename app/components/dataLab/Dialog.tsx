'use client';

import { useEffect, type ReactNode } from 'react';
import Button from '@/app/components/ui/Button';
import Callout from '@/app/components/ui/Callout';

export default function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={title} className={`density-compact w-full ${maxWidth} max-h-[calc(100vh-2rem)] overflow-auto rounded-lg border border-hairline bg-canvas p-5 shadow-xl`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="display-sm">{title}</h2>
            {description && <p className="mt-1.5 text-sm leading-6 text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 shrink-0 rounded-md border border-hairline text-lg leading-none text-muted transition-colors duration-[120ms] hover:bg-surface-soft hover:text-ink"
            aria-label="关闭对话框"
            title="关闭"
          >
            ×
          </button>
        </div>
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-t-hairline border-hairline pt-4">{footer}</div>}
      </section>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  consequence,
  confirmLabel,
  pending = false,
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  consequence?: string;
  confirmLabel: string;
  pending?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={pending}>取消</Button>
          <Button type="button" variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={pending}>
            {pending ? '处理中…' : confirmLabel}
          </Button>
        </>
      }
    >
      {/* 后果说明：不可逆操作用 error，其余用 warning。 */}
      {consequence && <Callout tone={danger ? 'error' : 'warning'}>{consequence}</Callout>}
    </Dialog>
  );
}
