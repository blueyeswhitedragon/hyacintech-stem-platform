"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm p-6">
        <h1 className="text-2xl font-bold text-blue-600 mb-1">注册</h1>
        <p className="text-sm text-gray-500 mb-6">Hyacintech STEM 平台</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">用户名（至少 3 字符）</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border rounded-lg p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">显示名称</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full border rounded-lg p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">密码（至少 6 字符）</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded-lg p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">身份</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="role"
                  checked={role === 'student'}
                  onChange={() => setRole('student')}
                />
                学生
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="role"
                  checked={role === 'teacher'}
                  onChange={() => setRole('teacher')}
                />
                教师
              </label>
            </div>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 text-white rounded-lg py-2 hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? '注册中…' : '注册'}
          </button>
        </form>

        <p className="text-sm text-gray-500 mt-4 text-center">
          已有账号？
          <Link href="/auth/login" className="text-blue-600 hover:underline ml-1">
            登录
          </Link>
        </p>
      </div>
    </main>
  );
}
