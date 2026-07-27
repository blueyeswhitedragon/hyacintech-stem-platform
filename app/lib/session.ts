import 'server-only';
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { db } from './db';
import { isUserRole, type UserRole } from './roles';

export type { UserRole } from './roles';

export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
}

interface SessionIdentity extends SessionUser {
  sessionVersion: number;
}

export interface AppSession {
  user?: SessionIdentity;
}

export type SessionInvalidReason =
  | 'ANONYMOUS'
  | 'SESSION_SUPERSEDED'
  | 'ACCOUNT_DISABLED'
  | 'ROLE_INVALID';

export type SessionState =
  | { user: SessionUser; reason: null }
  | { user: null; reason: SessionInvalidReason };

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET ?? '',
  cookieName: 'hyacintech_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  },
};

/**
 * 读取（或初始化）当前请求的 iron-session。
 * Next.js 16 中 cookies() 为异步，故此处 await。
 */
export async function getSession() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error(
      'SESSION_SECRET 未设置或长度不足 32 字符。请在 .env 中配置（openssl rand -base64 32）。'
    );
  }
  return getIronSession<AppSession>(await cookies(), sessionOptions);
}

/**
 * 读取当前会话及失效原因。受保护页面应使用 getSessionState() + loginRedirectPath()
 * 保留非匿名会话失效的说明；API 守卫也从这里取得唯一的失效原因。
 */
export async function getSessionState(): Promise<SessionState> {
  const session = await getSession();
  if (!session.user?.id) return { user: null, reason: 'ANONYMOUS' };
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, username: true, displayName: true, role: true, isActive: true, sessionVersion: true },
  });
  if (!user || !user.isActive) return { user: null, reason: 'ACCOUNT_DISABLED' };
  if (!isUserRole(user.role)) return { user: null, reason: 'ROLE_INVALID' };
  const cookieVersion = typeof session.user.sessionVersion === 'number' ? session.user.sessionVersion : 0;
  if (cookieVersion !== user.sessionVersion) return { user: null, reason: 'SESSION_SUPERSEDED' };
  return {
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    reason: null,
  };
}

/**
 * 仅读取当前登录用户（不抛错）。供不需要展示失效原因的既有调用方使用。
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  return (await getSessionState()).user;
}
