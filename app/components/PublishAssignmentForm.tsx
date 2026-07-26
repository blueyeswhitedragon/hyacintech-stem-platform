"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from './ui/Button';
import { Field, Input, Select } from './ui/Field';

interface ClassOption {
  id: string;
  name: string;
}

export default function PublishAssignmentForm({ classes }: { classes: ClassOption[] }) {
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [topicDirection, setTopicDirection] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [allowDataContribution, setAllowDataContribution] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          title,
          topicDirection: topicDirection || undefined,
          allowDataContribution,
          dueDate: dueDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '发布失败');
        return;
      }
      setTitle('');
      setTopicDirection('');
      setDueDate('');
      setAllowDataContribution(false);
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (classes.length === 0) {
    return <p className="text-sm text-muted">请先创建班级，才能发布作业。</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
      <Field label="班级" htmlFor="assignment-class">
        <Select id="assignment-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="作业标题" htmlFor="assignment-title">
        <Input id="assignment-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="研究方向" htmlFor="assignment-direction" hint="可选，用于限定第 1 阶段的选题范围">
        <Input
          id="assignment-direction"
          type="text"
          value={topicDirection}
          onChange={(e) => setTopicDirection(e.target.value)}
        />
      </Field>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-hairline bg-surface-soft p-3 text-sm">
        <input
          type="checkbox"
          checked={allowDataContribution}
          onChange={(event) => setAllowDataContribution(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-coral"
        />
        <span>
          <span className="font-medium text-body-strong">允许学生自愿授权脱敏对话用于模型改进</span>
          <span className="mt-1 block text-xs leading-5 text-muted">
            默认关闭。开启后学生可以同意、拒绝或撤回；拒绝不会影响作业完成。只有教师提名且管理员审核通过的脱敏片段才会进入候选池。
          </span>
          {/* 时序陷阱：授权之前产生的回合不保存训练上下文，事后补开也救不回来。
              这条必须视觉上跳出来，否则老师发完才发现数据取不回。 */}
          <span className="mt-2 block border-l-2 border-l-warning pl-2.5 text-xs leading-5 text-body">
            只有学生<b>点下同意之后</b>产生的对话才可提名——授权前的回合不会保存训练上下文，事后补开也无法追溯。需要回流数据时请现在勾选，并提醒学生先授权再开始探究（发布后仍可在作业列表里开关）。
          </span>
        </span>
      </label>

      <Field label="截止日期" htmlFor="assignment-due" hint="可选。逾期只记录并显示，不会锁住学生的作业">
        <Input id="assignment-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>

      {error && <div className="text-sm text-error">{error}</div>}

      <Button type="submit" variant="primary" disabled={loading || title.trim() === ''}>
        {loading ? '发布中…' : '发布作业'}
      </Button>
    </form>
  );
}
