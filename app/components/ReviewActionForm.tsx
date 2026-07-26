"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from './ui/Button';
import Callout from './ui/Callout';
import Card from './ui/Card';
import { Field, Input, Label, Textarea } from './ui/Field';

interface Props {
  studentAssignmentId: string;
  stage: 2 | 3 | 4 | 5;
  currentStage: number;
  status: string;
}

export default function ReviewActionForm({ studentAssignmentId, stage, currentStage, status }: Props) {
  const router = useRouter();
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const numericScore = Number(score);
  const validStage5Score = score !== '' && Number.isFinite(numericScore) && numericScore >= 0 && numericScore <= 10;
  const canRelease = currentStage === stage && status !== 'COMPLETED';
  const validReleaseReason = releaseReason.trim().length >= 10;
  const allowStandardReview = stage === 3
    || (stage === 2 && status === 'PENDING_STAGE2')
    || (stage === 5 && status === 'PENDING_STAGE5');

  const act = async (action: 'approve' | 'reject' | 'release') => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/teacher/review/${studentAssignmentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          stage,
          score: stage === 5 && score !== '' ? Number(score) : undefined,
          feedback: feedback || undefined,
          reason: action === 'release' ? releaseReason.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || '操作失败'); return; }
      router.push('/teacher/review');
      router.refresh();
    } catch {
      setErr('网络错误，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tone="soft" className="space-y-4">
      <h3 className="display-sm">审核操作</h3>
      {stage === 3 && (
        <Callout tone="info">
          可选审核：通过只记录教师认可；驳回只留下修改建议。两种操作都不改变学生当前阶段，也不会清空数据或分析记录。
        </Callout>
      )}
      {stage === 4 && (
        <Callout tone="info">
          本阶段没有常规审核操作；如学生无法完成数据引用门禁，只能填写理由后留痕放行。
        </Callout>
      )}
      {stage === 5 && (
        <div>
          <Label htmlFor="review-score">评分（0–10）</Label>
          <Input
            id="review-score"
            type="number"
            min={0}
            max={10}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className="w-24 tabular-nums"
          />
          {/* 6 分是 5→6 的硬门禁，老师按下"通过"之前必须知道低分意味着退回重写。 */}
          {score !== '' && Number(score) < 6 && (
            <div className="mt-1.5 text-xs font-medium text-error">
              点击“通过”会要求学生修改后重交；有明确理由时可留痕放行，并保留这次实际评分。
            </div>
          )}
          {score !== '' && Number(score) >= 6 && (
            <div className="mt-1.5 text-xs text-[#2f7a43]">评分 ≥ 6 分，通过后学生将进入反思阶段。</div>
          )}
        </div>
      )}
      {stage !== 4 && (
        <Field
          label="评语 / 驳回理由"
          htmlFor="review-feedback"
          hint={stage === 5 ? '低于 6 分时，这段话就是学生的修改依据' : undefined}
        >
          <Textarea
            id="review-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder={stage === 2 ? '对实验方案的意见…' : stage === 3 ? '对数据表的修改意见…' : '对报告的评价…'}
          />
        </Field>
      )}
      {canRelease && (
        <div className="space-y-3 border-t border-hairline pt-4">
          <Callout tone="warning">
            放行会留痕，且该阶段对话不会作为正面训练样本。
          </Callout>
          <Field
            label="放行理由"
            htmlFor="review-release-reason"
            hint="至少 10 个字，必填"
          >
            <Textarea
              id="review-release-reason"
              value={releaseReason}
              onChange={(event) => setReleaseReason(event.target.value)}
              rows={3}
              placeholder="说明为什么不再要求学生满足本阶段常规门禁…"
            />
          </Field>
        </div>
      )}
      {err && <div className="text-sm text-error">{err}</div>}
      <div className="flex gap-2">
        {allowStandardReview && (
          <>
            <Button variant="primary" onClick={() => act('approve')} disabled={busy || (stage === 5 && !validStage5Score)}>
              {busy ? '处理中…' : '通过'}
            </Button>
            <Button variant="danger" onClick={() => act('reject')} disabled={busy}>
              驳回
            </Button>
          </>
        )}
        {canRelease && (
          <Button
            variant="secondary"
            onClick={() => act('release')}
            disabled={busy || !validReleaseReason || (stage === 5 && !validStage5Score)}
          >
            放行到下一阶段
          </Button>
        )}
      </div>
    </Card>
  );
}
