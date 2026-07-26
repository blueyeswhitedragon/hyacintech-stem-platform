"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { dashboardForRole, roleLabel, type UserRole } from '@/app/lib/roles';

interface MeUser {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
}

export default function AuthNav() {
  const router = useRouter();
  const [user, setUser] = useState<MeUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoaded(true));
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.refresh();
  };

  if (!loaded) return null;

  if (user) {
    const dashboard = dashboardForRole(user.role);
    return (
      <div className="flex items-center gap-3 text-sm">
        <Link href={dashboard} className="text-body transition-colors duration-[120ms] hover:text-coral">
          {user.displayName}
          <span className="ml-1 text-muted">({roleLabel(user.role)})</span>
        </Link>
        <button onClick={handleLogout} className="text-muted transition-colors duration-[120ms] hover:text-coral">
          登出
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <Link href="/auth/login" className="text-body transition-colors duration-[120ms] hover:text-coral">
        登录
      </Link>
      <Link href="/auth/register" className="text-coral hover:text-coral-active">
        注册
      </Link>
    </div>
  );
}
