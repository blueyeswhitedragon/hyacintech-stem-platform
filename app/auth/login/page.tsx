"use client";

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import { Field, Input } from '@/app/components/ui/Field';
import { dashboardForRole, type UserRole } from '@/app/lib/roles';

const SESSION_NOTICES: Record<string, string> = {
  SESSION_SUPERSEDED: '你的账号在其他设备或标签页登录过，这里的登录状态已失效。重新登录即可继续，本次操作没有丢失。',
  ACCOUNT_DISABLED: '账号已被停用，请联系管理员。',
  ROLE_INVALID: '账号角色无效，请联系管理员。',
};

function LoginForm() {
  const router = useRouter();
  // 会话失效原因由服务端重定向写进 query，渲染期直接读取，不经 effect 回写 state。
  const notice = SESSION_NOTICES[useSearchParams().get('reason') ?? ''] ?? null;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '登录失败');
        return;
      }
      const dest = dashboardForRole(data.user?.role as UserRole);
      router.push(dest);
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="density-roomy flex min-h-screen items-center justify-center bg-surface-soft p-4">
      <div className="w-full max-w-sm rounded-lg border border-hairline bg-canvas [padding:var(--pad-card)]">
        <h1 className="display-md">登录</h1>
        <p className="mt-1 text-sm text-muted">Hyacintech STEM 平台</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field label="用户名" htmlFor="login-username">
            <Input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="密码" htmlFor="login-password">
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {notice && <p className="text-sm text-info">{notice}</p>}
          {error && <p className="text-sm text-error">{error}</p>}

          <Button type="submit" variant="primary" disabled={loading} className="w-full">
            {loading ? '登录中…' : '登录'}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          还没有账号？
          <Link href="/auth/register" className="ml-1 text-coral hover:underline">
            注册
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams 需要 Suspense 边界，否则整页退化为客户端渲染。
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
