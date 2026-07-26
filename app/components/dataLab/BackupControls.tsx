'use client';

import { useState } from 'react';

export default function BackupControls() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ path: string; bytes: number; sha256: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function backup() {
    setPending(true); setError(null);
    try {
      const response = await fetch('/api/data-lab/backups', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '备份失败');
      setResult(data);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(false); }
  }
  return <section className="rounded-lg border border-hairline bg-canvas p-4"><h2 className="font-medium">安全备份</h2><p className="mt-1 text-xs text-muted">管理员可在平台创建数据库一致性备份。恢复需要由运维在项目根目录执行；创建后请把路径和校验值一并提供给运维。</p><button onClick={backup} disabled={pending} className="mt-3 border border-ink px-3 py-2 text-sm disabled:opacity-40">{pending ? '备份中…' : '创建数据库备份'}</button>{result && <div className="mt-3 break-all rounded-md bg-success/8 p-3 text-xs text-body-strong"><div>备份路径：{result.path}</div><div>文件大小：{result.bytes} 字节</div><div>文件校验值：{result.sha256}</div><p className="mt-2">请将以上三项提供给运维，用于恢复与完整性核对。</p></div>}{error && <p className="mt-2 text-sm text-error">{error}</p>}</section>;
}
