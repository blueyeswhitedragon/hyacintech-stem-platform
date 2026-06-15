import 'server-only';
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export type UserRole = 'student' | 'teacher';

export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
}

export interface AppSession {
  user?: SessionUser;
}

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
 * 仅读取当前登录用户（不抛错）。供 Server Component 页面使用：
 *   const user = await getCurrentUser();
 *   if (!user) redirect('/auth/login');
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session.user ?? null;
}
