import { redirect } from 'next/navigation';
import UserAccountActions from '@/app/components/dataLab/UserAccountActions';
import UserManager from '@/app/components/dataLab/UserManager';
import { listDataLabUsers } from '@/app/lib/dataLab/service';
import { roleLabel, type UserRole } from '@/app/lib/roles';
import { getCurrentUser } from '@/app/lib/session';

export default async function UsersPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== 'admin') redirect('/data-lab');
  const users = await listDataLabUsers();
  const actions = (user: (typeof users)[number]) => <UserAccountActions user={{
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as UserRole,
    isActive: user.isActive,
    canDelete: user.canDelete,
    activeTaskCount: user.activeTaskCount,
    activeReviewCount: user.activeReviewCount,
  }} currentUserId={currentUser.id} />;

  return <div className="space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2f7f70]">高级管理</p><h1 className="mt-1 text-2xl font-semibold">后台账号</h1><p className="mt-1 text-sm text-muted">创建、编辑和停用后台人员；有历史记录的账户不会被永久删除。</p></div>
    <UserManager/>
    <section className="grid gap-3 md:hidden">{users.map((user) => <article key={user.id} className={`rounded-lg border border-hairline p-4 ${user.isActive ? 'bg-canvas' : 'bg-surface-soft text-muted'}`}><div className="flex items-start justify-between gap-3"><div><h2 className="font-medium">{user.displayName}</h2><p className="text-xs text-muted">{user.username} · {roleLabel(user.role as UserRole)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs ${user.isActive ? 'bg-success/8 text-body-strong' : 'bg-surface-cream-strong text-muted'}`}>{user.isActive ? '启用' : '已停用'}</span></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-surface-soft p-3 text-center"><div><div className="text-xs text-muted">进行中标注</div><div className="mt-1 font-semibold tabular-nums">{user.activeTaskCount}</div></div><div><div className="text-xs text-muted">进行中仲裁</div><div className="mt-1 font-semibold tabular-nums">{user.activeReviewCount}</div></div><div><div className="text-xs text-muted">有效条数</div><div className="mt-1 font-semibold tabular-nums">{user.effectiveWorkCount}</div></div></div>{!user.isActive && user.disabledReason && <p className="mt-3 text-xs">停用说明：{user.disabledReason}</p>}<div className="mt-3 border-t border-t-hairline pt-3">{actions(user)}</div></article>)}</section>
    <section className="hidden overflow-hidden rounded-lg border border-hairline bg-canvas md:block"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-surface-soft text-xs text-muted"><tr><th className="p-3">账户</th><th className="p-3">身份</th><th className="p-3">状态</th><th className="p-3">进行中</th><th className="p-3">有效条数</th><th className="p-3">最近登录</th><th className="p-3">操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className={`border-t border-t-hairline ${user.isActive ? '' : 'bg-surface-soft text-muted'}`}><td className="p-3"><div className="font-medium">{user.displayName}</div><div className="text-xs text-muted">{user.username}</div></td><td className="p-3">{roleLabel(user.role as UserRole)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${user.isActive ? 'bg-success/8 text-body-strong' : 'bg-surface-cream-strong text-muted'}`}>{user.isActive ? '启用' : '已停用'}</span>{!user.isActive && user.disabledReason && <div className="mt-1 max-w-48 text-xs">{user.disabledReason}</div>}</td><td className="p-3 tabular-nums">标注 {user.activeTaskCount} / 仲裁 {user.activeReviewCount}</td><td className="p-3 font-semibold tabular-nums">{user.effectiveWorkCount}</td><td className="p-3 text-xs text-muted">{user.lastLoginAt ? user.lastLoginAt.toLocaleString('zh-CN') : '尚未登录'}</td><td className="p-3">{actions(user)}</td></tr>)}</tbody></table></div></section>
  </div>;
}
