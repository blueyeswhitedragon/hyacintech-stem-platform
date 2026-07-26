'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Callout from './ui/Callout';
import Card from './ui/Card';
import { Textarea } from './ui/Field';

interface TraceOption {
  assistantMessageId: string;
  stage: number;
  dialogue: string;
  candidateStatus: string | null;
  nominationBlockedReason: string | null;
}

export default function CandidateNominationPanel({
  studentAssignmentId,
  traces,
  consentStatus,
}: {
  studentAssignmentId: string;
  traces: TraceOption[];
  consentStatus: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function nominate(assistantMessageId: string) {
    setPendingId(assistantMessageId);
    setMessage(null);
    try {
      const response = await fetch(`/api/teacher/review/${studentAssignmentId}/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantMessageId, triggerType: 'TEACHER_NOMINATION', triggerNote: note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '提名失败');
      setMessage('已生成脱敏候选，等待管理员审核。');
      setNote('');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingId(null);
    }
  }

  const nominatable = traces.filter((trace) => !trace.nominationBlockedReason && !trace.candidateStatus).length;

  return (
    <Card>
      <h2 className="display-sm">提名模型改进候选</h2>
      <p className="mt-1.5 text-sm leading-6 text-muted">
        只能提名已有不可变生成轨迹的导师回复；提名不是直接加入训练，需管理员审核脱敏快照后才进入候选池。
      </p>
      <p className="mt-1 text-sm text-muted">
        本作业可提名回合：<span className="tabular-nums text-body">{nominatable}</span>
      </p>
      {consentStatus !== 'GRANTED' ? (
        <div className="mt-3">
          <Callout tone="warning">学生未授权或已经撤回，当前不能提名。</Callout>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="问题说明（可选，例如：导师替学生下结论）"
              rows={2}
            />
          </div>
          {/* 轨迹列表是逐条扫读的候选池，用紧凑密度，一屏能多看几条。 */}
          <div className="density-compact mt-3 space-y-2">
            {traces.map((trace) => (
              <div key={trace.assistantMessageId} className="rounded-md border border-hairline bg-surface-soft p-3 text-sm">
                <div className="caption-upper mb-1.5">阶段 {trace.stage}</div>
                <p className="line-clamp-3 whitespace-pre-wrap leading-6 text-body">{trace.dialogue}</p>
                <div className="mt-2">
                  {trace.candidateStatus ? (
                    <Badge tone="info">候选状态：{trace.candidateStatus}</Badge>
                  ) : trace.nominationBlockedReason ? (
                    <span className="text-xs leading-5 text-muted">{trace.nominationBlockedReason}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={pendingId !== null}
                      onClick={() => nominate(trace.assistantMessageId)}
                    >
                      {pendingId === trace.assistantMessageId ? '处理中…' : '提名这一条'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {traces.length === 0 && <p className="text-sm text-muted">暂无可追踪的导师回复。</p>}
          </div>
        </>
      )}
      {message && <p className="mt-3 text-sm text-muted">{message}</p>}
    </Card>
  );
}
