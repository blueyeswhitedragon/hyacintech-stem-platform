"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import { Field, Input, Label } from '@/app/components/ui/Field';

type Role = 'student' | 'teacher';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role, displayName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '注册失败');
        return;
      }
      const dest = data.user?.role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard';
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
        <h1 className="display-md">注册</h1>
        <p className="mt-1 text-sm text-muted">Hyacintech STEM 平台</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field label="用户名" hint="至少 3 字符" htmlFor="reg-username">
            <Input
              id="reg-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="显示名称" htmlFor="reg-display-name">
            <Input
              id="reg-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label="密码" hint="至少 6 字符" htmlFor="reg-password">
            <Input
              id="reg-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div>
            <Label>身份</Label>
            {/* 公开注册只开放学生与教师；标注/审核/管理员由后台开号，这里刻意不给入口。 */}
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-body">
                <input
                  type="radio"
                  name="role"
                  className="accent-coral"
                  checked={role === 'student'}
                  onChange={() => setRole('student')}
                />
                学生
              </label>
              <label className="flex items-center gap-2 text-sm text-body">
                <input
                  type="radio"
                  name="role"
                  className="accent-coral"
                  checked={role === 'teacher'}
                  onChange={() => setRole('teacher')}
                />
                教师
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <Button type="submit" variant="primary" disabled={loading} className="w-full">
            {loading ? '注册中…' : '注册'}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          已有账号？
          <Link href="/auth/login" className="ml-1 text-coral hover:underline">
            登录
          </Link>
        </p>
      </div>
    </main>
  );
}
