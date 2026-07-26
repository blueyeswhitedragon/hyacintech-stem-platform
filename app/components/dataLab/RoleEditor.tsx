"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@/app/lib/roles';
import { Select } from '@/app/components/ui/Field';

export default function RoleEditor({ userId, currentRole }: { userId: string; currentRole: UserRole }) {
  const router = useRouter();
  const [role, setRole] = useState(currentRole);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function update(nextRole: UserRole) {
    setRole(nextRole); setPending(true); setError(null);
    try {
      const response = await fetch(`/api/data-lab/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '角色更新失败');
      router.refresh();
    } catch (err) {
      setRole(currentRole);
      setError(err instanceof Error ? err.message : String(err));
    } finally { setPending(false); }
  }
  return <div><Select value={role} disabled={pending} onChange={(event) => update(event.target.value as UserRole)}><option value="annotator">标注者</option><option value="reviewer">复审者</option><option value="admin">管理员</option></Select>{error && <div className="mt-1 text-xs text-error">{error}</div>}</div>;
}
