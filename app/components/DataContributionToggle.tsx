"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from './ui/Button';

/**
 * 已发布作业的数据回流开关。
 *
 * 发布时忘记勾选是很容易发生的事，而这个字段决定学生端是否出现授权卡片，
 * 进而决定该作业的对话能否被提名为训练数据。所以它必须在发布之后仍可更改。
 */
export default function DataContributionToggle({
  assignmentId,
  enabled,
}: {
  assignmentId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowDataContribution: !enabled }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '修改失败');
        return;
      }
      setNotice(
        enabled
          ? '已关闭数据回流；学生已作出的授权决定保留在记录里，但不会再产生新的可提名回合。'
          : `已开启数据回流${data.backfilled ? `，${data.backfilled} 名已开始的学生会看到授权卡片` : ''}。注意：只有学生点下同意之后产生的对话才可提名。`,
      );
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="ghost" onClick={toggle} disabled={saving}>
        {saving ? '保存中…' : enabled ? '关闭回流' : '开启回流'}
      </Button>
      {error && <span className="text-xs text-error">{error}</span>}
      {notice && <span className="text-xs text-muted">{notice}</span>}
    </span>
  );
}
