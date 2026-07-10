import 'server-only';
import { getSession, type SessionUser, type UserRole } from './session';

/**
 * 鉴权守卫工具。返回判别联合：
 *   { ok: true, user }          —— 已认证（且角色匹配）
 *   { ok: false, error, status } —— 未认证(401) 或 越权(403)
 *
 * Route Handler 用法（参考 Next.js 官方两段式校验）：
 *   const auth = await requireUser();
 *   if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
 *   // 使用 auth.user
 */
export type AuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string; status: 401 | 403 };

export async function requireUser(): Promise<AuthResult> {
  const session = await getSession();
  if (!session.user) {
    return { ok: false, error: '未登录', status: 401 };
  }
  return { ok: true, user: session.user };
}

export async function requireRole(role: UserRole): Promise<AuthResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (auth.user.role !== role) {
    return { ok: false, error: '无权限', status: 403 };
  }
  return auth;
}

export async function requireAnyRole(roles: readonly UserRole[]): Promise<AuthResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!roles.includes(auth.user.role)) {
    return { ok: false, error: '无权限', status: 403 };
  }
  return auth;
}
