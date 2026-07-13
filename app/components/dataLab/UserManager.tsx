"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UserManager() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function create(formData: FormData) {
    setPending(true); setMessage(null);
    try {
      const response = await fetch('/api/data-lab/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(formData)) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '创建失败');
      router.refresh(); setMessage('后台账号已创建，可以立即登录。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }
  return <details className="rounded-xl border bg-white shadow-sm"><summary className="cursor-pointer px-4 py-4 font-semibold">添加后台账户</summary><form action={create} className="grid gap-4 border-t p-4 md:grid-cols-2 xl:grid-cols-4"><label className="text-sm">显示名称<input name="displayName" required maxLength={50} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="例如：标注员·丙" /></label><label className="text-sm">用户名<input name="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="例如：annotator3" /></label><label className="text-sm">初始密码<input name="password" type="password" minLength={8} maxLength={128} required className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm">身份<select name="role" className="mt-1 w-full rounded-lg border px-3 py-2"><option value="annotator">标注者</option><option value="reviewer">复审者</option><option value="admin">管理员</option></select></label><div className="flex flex-wrap items-center gap-3 md:col-span-2 xl:col-span-4"><button disabled={pending} className="rounded-lg bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-50">创建账户</button><span className="text-xs text-gray-500">密码只在创建时输入，后台不会显示现有密码。</span>{message && <span aria-live="polite" className="text-sm text-gray-700">{message}</span>}</div></form></details>;
}
