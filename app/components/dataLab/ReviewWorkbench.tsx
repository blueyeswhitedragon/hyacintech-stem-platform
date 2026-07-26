"use client";

import { useEffect, useMemo, useState } from 'react';
import type { AutoCheckIssue, AutoCheckResult, ShareGPTRecord } from '@/app/lib/dataLab/types';
import type { ChatResponse } from '@/app/models/types';
import { getStylePolicy, type StyleFamily } from '@/app/lib/stylePolicy';
import { buttonClass } from '@/app/components/ui/Button';
import { Select, Textarea } from '@/app/components/ui/Field';

interface ReviewPayload {
  id: string;
  phase: number;
  scenario: string;
  original: ShareGPTRecord;
  candidates: Array<{ label: string; id: string; record: ShareGPTRecord; check: AutoCheckResult }>;
  autoCheck: AutoCheckResult;
  styleFamily: StyleFamily | null;
  stylePolicyVersion: string;
  styleTargetMismatch: boolean;
  campaignStatus: string;
}

interface TurnDetail {
  index: number;
  response?: ChatResponse;
  raw: string;
  issues: AutoCheckIssue[];
}

function assistantDetails(record: ShareGPTRecord, check: AutoCheckResult): TurnDetail[] {
  return record.conversations.flatMap((message, index) => {
    if (message.from !== 'gpt') return [];
    try {
      const response = JSON.parse(message.value) as ChatResponse;
      const issues = check.issues.filter((item) => item.messageIndex === index);
      return [{ index, response, raw: message.value, issues }];
    } catch {
      return [{ index, raw: message.value, issues: check.issues.filter((item) => item.messageIndex === index) }];
    }
  });
}

export default function ReviewWorkbench() {
  const [item, setItem] = useState<ReviewPayload | null>(null);
  const [selected, setSelected] = useState('');
  const [tier, setTier] = useState<'human_gold'|'reviewed_silver'|'reject'>('human_gold');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function claim() {
    setPending(true); setMessage(null);
    try {
      const response = await fetch('/api/data-lab/reviews/claim', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '领取失败');
      setItem(data.reviewCase); setSelected('');
      if (!data.reviewCase) setMessage('当前没有待仲裁任务。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setPending(false); }
  }

  useEffect(() => {
    let cancelled = false;
    fetch('/api/data-lab/reviews/claim', { method: 'POST' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '领取失败');
        if (!cancelled) setItem(data.reviewCase);
        if (!cancelled && !data.reviewCase) setMessage('当前没有待仲裁任务。');
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);

  const candidateChecks = useMemo(() => new Map(
    (item?.candidates ?? []).map((candidate) => [candidate.id, assistantDetails(candidate.record, candidate.check)])
  ), [item]);
  const selectedHasErrors = item?.candidates.find((candidate) => candidate.id === selected)?.check.status === 'error';
  const stylePolicy = item?.styleFamily ? getStylePolicy(item.styleFamily, item.stylePolicyVersion) : null;

  async function decide(action: 'SELECT'|'RETURN'|'REJECT') {
    if (!item) return;
    if (action === 'SELECT' && !selected) { setMessage('请选择一个候选版本'); return; }
    if (action === 'SELECT' && selectedHasErrors) { setMessage('所选版本仍有结构契约错误，不能接受；请退回修订或选择其他版本。'); return; }
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/reviews/${item.id}/decide`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, selectedRevisionId: action === 'SELECT' ? selected : undefined, finalTier: action === 'REJECT' ? 'reject' : tier, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '提交失败');
      await claim();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setPending(false); }
  }

  if (!item) return <div className="border border-hairline bg-canvas p-8 text-center"><p className="text-muted">{message ?? '正在领取仲裁任务…'}</p><button onClick={claim} disabled={pending} className={buttonClass('primary', 'md', 'mt-4')}>重新领取</button></div>;

  return <div className="space-y-5">
    <div className="border border-hairline bg-canvas p-4"><div className="text-xs font-medium text-[#2f7f70]">P{item.phase} · 匿名仲裁</div><h2 className="mt-1 text-lg font-semibold">{item.scenario}</h2>{item.campaignStatus === 'ARCHIVED' && <div className="mt-3 rounded-lg border border-hairline bg-surface-card p-3 text-xs leading-5 text-body">所属活动已经归档。你仍可接受、合并或拒绝已有版本，但不能再退回给标注员修改。</div>}{stylePolicy && <div className="mt-3 rounded-lg border border-info/40 bg-info/8 p-3 text-sm text-body-strong"><div className="font-medium">共同目标风格：{stylePolicy.label}</div><p className="mt-1 text-xs leading-5">{stylePolicy.summary} 判定时同时检查：{stylePolicy.annotationRubric.join('；')}。</p></div>}{item.styleTargetMismatch && <div className="mt-3 rounded-lg border border-warning/40 bg-warning/8 p-3 text-xs text-body-strong">这是旧活动遗留任务，候选版本的目标风格不一致。本次只能按内容、阶段和结构质量仲裁，不能用于判断风格遵循度。</div>}<div className="mt-3 max-w-4xl space-y-2">{item.original.conversations.filter((entry) => entry.from === 'human').map((entry, index) => <p key={index} className="border-l-4 border-hairline pl-3 text-sm leading-6">{entry.value}</p>)}</div>{item.autoCheck?.issues?.length > 0 && <div className="mt-3 border border-warning/40 bg-warning/8 p-3 text-xs text-body-strong">原始样本自动检查：{item.autoCheck.issues.map((check) => check.message).join('；')}</div>}</div>
    <div className="grid gap-4 xl:grid-cols-2">{item.candidates.map((candidate) => {
      const details = candidateChecks.get(candidate.id) ?? [];
      const errors = candidate.check.issues.filter((checkIssue) => checkIssue.severity === 'error');
      const warnings = candidate.check.issues.filter((checkIssue) => checkIssue.severity === 'warning');
      const generalIssues = candidate.check.issues.filter((checkIssue) => checkIssue.messageIndex === undefined);
      return <label key={candidate.id} className={`block cursor-pointer border border-hairline bg-canvas p-4 ${selected === candidate.id ? 'border-coral/55 ring-1 ring-coral/25' : ''}`}><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-lg font-semibold">版本 {candidate.label}</span><span className={`rounded-full px-2 py-1 text-xs ${errors.length > 0 ? 'bg-error/10 text-body-strong' : warnings.length > 0 ? 'bg-warning/10 text-body-strong' : 'bg-success/10 text-body-strong'}`}>{errors.length > 0 ? `${errors.length} 个错误 · ${warnings.length} 个复核项` : warnings.length > 0 ? `${warnings.length} 个复核项 · 可选择` : '自动检查通过'}</span></div><input type="radio" name="candidate" value={candidate.id} checked={selected === candidate.id} onChange={() => setSelected(candidate.id)} /></div>{generalIssues.length > 0 && <ul className="mt-3 space-y-1 rounded-md border border-warning/40 bg-warning/8 p-2 text-xs">{generalIssues.map((checkIssue) => <li key={`${checkIssue.ruleCode}-${checkIssue.message}`} className={checkIssue.severity === 'error' ? 'text-error' : 'text-[#8a6a0f]'}>• [{checkIssue.severity === 'error' ? '错误' : '人工复核'}] {checkIssue.message}</li>)}</ul>}<div className="mt-4 space-y-4">{details.map((turn, turnIndex) => { const turnErrors = turn.issues.filter((checkIssue) => checkIssue.severity === 'error'); const turnWarnings = turn.issues.filter((checkIssue) => checkIssue.severity === 'warning'); return <div key={turn.index} className={`rounded-md border border-hairline p-3 ${turnErrors.length > 0 ? 'border-error/40 bg-error/8' : turnWarnings.length > 0 ? 'border-warning/40 bg-warning/8' : 'border-hairline'}`}><div className="mb-2 flex flex-wrap gap-2 text-xs"><span className="font-medium">导师回复 {turnIndex + 1}</span>{turn.response && <><span className="rounded-md bg-info/8 px-2 py-0.5 text-body-strong">action: {turn.response.next_action_type}</span><span className="rounded-md bg-surface-card px-2 py-0.5">phase_complete: {String(turn.response.phase_complete)}</span><span className="rounded-md bg-surface-card px-2 py-0.5 text-body">schema: {turn.response.data_table_schema?.columns.length ?? 0} 列</span></>}</div><p className="whitespace-pre-wrap text-sm leading-6 text-body-strong">{turn.response?.dialogue ?? turn.raw}</p>{turn.response?.data_table_schema && <p className="mt-2 text-xs text-muted">字段：{turn.response.data_table_schema.columns.map((column) => `${column.key}(${column.type})`).join('、')}</p>}{turn.issues.length > 0 && <ul className="mt-2 space-y-1 text-xs">{turn.issues.map((checkIssue) => <li key={`${checkIssue.ruleCode}-${checkIssue.message}`} className={checkIssue.severity === 'error' ? 'text-error' : 'text-[#8a6a0f]'}>• [{checkIssue.severity === 'error' ? '错误' : '人工复核'}] {checkIssue.message}</li>)}</ul>}</div>; })}</div></label>;
    })}</div>
    <div className="grid gap-4 border border-hairline bg-canvas p-4 lg:grid-cols-[220px_1fr_auto]"><label className="text-sm">最终等级<Select value={tier} onChange={(event) => setTier(event.target.value as typeof tier)} className="mt-1"><option value="human_gold">Human Gold</option><option value="reviewed_silver">Reviewed Silver</option><option value="reject">Reject</option></Select></label><label className="text-sm">仲裁理由<Textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-20" /></label><div className="flex flex-wrap items-end gap-2"><button onClick={() => decide('SELECT')} disabled={pending || selectedHasErrors} className={buttonClass('primary', 'sm')}>接受所选</button><button title={item.campaignStatus === 'ACTIVE' ? '退回标注员修改' : '活动已归档，不能重新开放任务'} onClick={() => decide('RETURN')} disabled={pending || item.campaignStatus !== 'ACTIVE'} className="border border-hairline px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-35">退回</button><button onClick={() => decide('REJECT')} disabled={pending} className={buttonClass('danger', 'sm')}>拒绝</button></div></div>{message && <p className="text-sm text-error">{message}</p>}
  </div>;
}
