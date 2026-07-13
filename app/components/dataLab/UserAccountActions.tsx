"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { roleLabel, type UserRole } from '@/app/lib/roles';

interface ManagedUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  canDelete: boolean;
  activeTaskCount: number;
  activeReviewCount: number;
}

type Panel = 'edit' | 'password' | 'status' | 'delete' | null;

export default function UserAccountActions({ user, currentUserId }: { user: ManagedUser; currentUserId: string }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSelf = user.id === currentUserId;

  async function request(url: string, method: string, body?: unknown) {
    setPending(true); setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '操作失败');
      setPanel(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  async function saveProfile(formData: FormData) {
    await request(`/api/data-lab/users/${user.id}`, 'PATCH', {
      username: String(formData.get('username') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      role: String(formData.get('role') ?? ''),
    });
  }

  async function resetPassword(formData: FormData) {
    const password = String(formData.get('password') ?? '');
    const confirmation = String(formData.get('confirmation') ?? '');
    if (password !== confirmation) { setError('两次输入的密码不一致'); return; }
    await request(`/api/data-lab/users/${user.id}/password`, 'POST', { password });
  }

  async function changeStatus(formData: FormData) {
    await request(`/api/data-lab/users/${user.id}/status`, 'POST', {
      isActive: !user.isActive,
      reason: String(formData.get('reason') ?? ''),
    });
  }

  return <div className="flex flex-wrap gap-2">
    <button type="button" onClick={() => { setPanel('edit'); setError(null); }} className="rounded-lg border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">编辑</button>
    <button type="button" onClick={() => { setPanel('password'); setError(null); }} className="rounded-lg border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">重置密码</button>
    {!isSelf && <button type="button" onClick={() => { setPanel('status'); setError(null); }} className={`rounded-lg border px-3 py-1.5 text-xs ${user.isActive ? 'border-amber-200 text-amber-700' : 'border-emerald-200 text-emerald-700'}`}>{user.isActive ? '停用' : '重新启用'}</button>}
    {!isSelf && <button type="button" disabled={!user.canDelete} title={user.canDelete ? '永久删除这个空账户' : '已有业务或审计记录，只能停用'} onClick={() => { setPanel('delete'); setError(null); }} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 disabled:cursor-not-allowed disabled:opacity-35">永久删除</button>}

    {panel && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-label="账户操作" className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">{panel === 'edit' ? '编辑账户' : panel === 'password' ? '重置密码' : panel === 'status' ? (user.isActive ? '停用账户' : '重新启用账户') : '永久删除账户'}</h3><p className="mt-1 text-sm text-gray-500">{user.displayName}（{user.username}）</p></div><button type="button" onClick={() => setPanel(null)} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100" aria-label="关闭">×</button></div>
      {panel === 'edit' && <form action={saveProfile} className="mt-5 space-y-4"><label className="block text-sm">显示名称<input name="displayName" required maxLength={50} defaultValue={user.displayName} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="block text-sm">用户名<input name="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" defaultValue={user.username} className="mt-1 w-full rounded-lg border px-3 py-2" /><span className="mt-1 block text-xs text-gray-500">3-32 位字母、数字、点、下划线或短横线。</span></label><label className="block text-sm">身份<select name="role" defaultValue={user.role} disabled={isSelf} className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-100"><option value="annotator">标注者</option><option value="reviewer">复审者</option><option value="admin">管理员</option></select>{isSelf && <input type="hidden" name="role" value="admin" />}</label><div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">当前身份：{roleLabel(user.role)}。有进行中任务时不能修改身份。</div><div className="flex justify-end gap-2"><button type="button" onClick={() => setPanel(null)} className="rounded-lg border px-4 py-2 text-sm">取消</button><button disabled={pending} className="rounded-lg bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-50">保存修改</button></div></form>}
      {panel === 'password' && <form action={resetPassword} className="mt-5 space-y-4"><div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">保存后，该账户现有登录会立即失效，需要使用新密码重新登录。{isSelf ? '你正在重置自己的密码。' : ''}</div><label className="block text-sm">新密码<input name="password" type="password" minLength={8} maxLength={128} required className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="block text-sm">再次输入<input name="confirmation" type="password" minLength={8} maxLength={128} required className="mt-1 w-full rounded-lg border px-3 py-2" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setPanel(null)} className="rounded-lg border px-4 py-2 text-sm">取消</button><button disabled={pending} className="rounded-lg bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-50">确认重置</button></div></form>}
      {panel === 'status' && <form action={changeStatus} className="mt-5 space-y-4"><div className={`rounded-lg p-3 text-sm ${user.isActive ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{user.isActive ? '停用后不能登录或领取新任务，历史标注和有效条数仍会保留。' : '重新启用后可以登录，但不会自动恢复以前的活动分配。'}</div>{user.isActive && <label className="block text-sm">停用说明（可选）<textarea name="reason" className="mt-1 min-h-20 w-full rounded-lg border p-3" placeholder="例如：本轮标注工作已结束" /></label>}<div className="text-xs text-gray-500">进行中标注 {user.activeTaskCount} 条；进行中仲裁 {user.activeReviewCount} 条。</div><div className="flex justify-end gap-2"><button type="button" onClick={() => setPanel(null)} className="rounded-lg border px-4 py-2 text-sm">取消</button><button disabled={pending} className={`rounded-lg px-4 py-2 text-sm text-white disabled:opacity-50 ${user.isActive ? 'bg-amber-600' : 'bg-emerald-600'}`}>{user.isActive ? '确认停用' : '确认启用'}</button></div></form>}
      {panel === 'delete' && <div className="mt-5 space-y-4"><div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">该账户尚无业务和审计记录，可以永久删除。此操作不可恢复。</div><div className="flex justify-end gap-2"><button type="button" onClick={() => setPanel(null)} className="rounded-lg border px-4 py-2 text-sm">取消</button><button type="button" disabled={pending} onClick={() => request(`/api/data-lab/users/${user.id}`, 'DELETE')} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50">确认永久删除</button></div></div>}
      {error && <p aria-live="polite" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section></div>}
  </div>;
}
