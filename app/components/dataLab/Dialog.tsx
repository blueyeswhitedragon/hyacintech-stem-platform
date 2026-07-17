'use client';

import { useEffect, type ReactNode } from 'react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={title} className={`w-full ${maxWidth} max-h-[calc(100vh-2rem)] overflow-auto rounded-lg border bg-white p-5 shadow-xl`}>
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold">{title}</h2>{description && <p className="mt-1 text-sm leading-6 text-gray-600">{description}</p>}</div>
          <button type="button" onClick={onClose} className="size-8 shrink-0 rounded border text-lg leading-none text-gray-500 hover:bg-gray-50" aria-label="关闭对话框" title="关闭">×</button>
        </div>
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-4">{footer}</div>}
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
  return <Dialog open={open} title={title} description={description} onClose={onClose} footer={<><button type="button" onClick={onClose} disabled={pending} className="rounded border px-4 py-2 text-sm disabled:opacity-40">取消</button><button type="button" onClick={onConfirm} disabled={pending} className={`rounded px-4 py-2 text-sm text-white disabled:opacity-40 ${danger ? 'bg-red-700' : 'bg-gray-950'}`}>{pending ? '处理中…' : confirmLabel}</button></>}>
    {consequence && <p className={`rounded border p-3 text-sm leading-6 ${danger ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>{consequence}</p>}
  </Dialog>;
}
