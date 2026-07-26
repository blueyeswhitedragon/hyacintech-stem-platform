'use client';

import { useState } from 'react';

export default function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return <button type="button" onClick={copy} className="shrink-0 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-xs text-body transition-colors hover:border-coral hover:text-ink">{copied ? '已复制' : '复制命令'}</button>;
}
