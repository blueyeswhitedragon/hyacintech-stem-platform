import 'server-only';
import { NextResponse } from 'next/server';
import { getSessionState, type SessionInvalidReason, type SessionUser, type UserRole } from './session';

/**
 * 鉴权守卫工具。返回判别联合：
 *   { ok: true, user }          —— 已认证（且角色匹配）
 *   { ok: false, error, status, reason? } —— 未认证(401) 或 越权(403)
 *
 * Route Handler 用法（参考 Next.js 官方两段式校验）：
 *   const auth = await requireUser();
 *   if (!auth.ok) return authFailureResponse(auth);
 *   // 使用 auth.user
 */
export type AuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string; status: 401 | 403; reason?: SessionInvalidReason };

export function authFailureResponse(auth: Extract<AuthResult, { ok: false }>) {
  return NextResponse.json(
    { error: auth.error, ...(auth.reason ? { reason: auth.reason } : {}) },
    { status: auth.status },
  );
}

export async function requireUser(): Promise<AuthResult> {
  const { user, reason } = await getSessionState();
  if (!user) {
    const error = {
      ANONYMOUS: '未登录',
      SESSION_SUPERSEDED: '登录状态已失效，请重新登录',
      ACCOUNT_DISABLED: '账号已被停用，请联系管理员',
      ROLE_INVALID: '账号角色无效，请联系管理员',
    }[reason];
    return { ok: false, error, status: 401, reason };
  }
  return { ok: true, user };
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
