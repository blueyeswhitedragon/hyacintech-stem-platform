"use client";

import { useEffect, useMemo, useState } from 'react';
import type { AutoCheckResult, ShareGPTRecord } from '@/app/lib/dataLab/types';
import type { ChatResponse } from '@/app/models/types';
import { hasResponseStage2Schema, validateChatContract } from '@/app/lib/llm/chatContract';
import { getStylePolicy, type StyleFamily } from '@/app/lib/stylePolicy';

interface ReviewPayload {
  id: string;
  phase: number;
  scenario: string;
  original: ShareGPTRecord;
  candidates: Array<{ label: string; id: string; record: ShareGPTRecord }>;
  autoCheck: AutoCheckResult;
  styleFamily: StyleFamily | null;
  stylePolicyVersion: string;
  styleTargetMismatch: boolean;
}

interface TurnDetail {
  index: number;
  response?: ChatResponse;
  raw: string;
  issues: string[];
}

function assistantDetails(record: ShareGPTRecord): TurnDetail[] {
  let hasStage2Schema = false;
  return record.conversations.flatMap((message, index) => {
    if (message.from !== 'gpt') return [];
    try {
      const response = JSON.parse(message.value) as ChatResponse;
      const contract = validateChatContract(response, { stage: record.phase, hasStage2Schema });
      const issues = contract.issues.map((item) => item.message);
      if (record.phase === 2 && response.data_table_schema) {
        const hasNotes = response.data_table_schema.columns.some((column) => column.key === 'notes' && column.type === 'text');
        if (!hasNotes || response.data_table_schema.maxRows !== 200) issues.push('数据表必须含 notes 文本列且 maxRows 为 200');
      }
      if (hasResponseStage2Schema(response)) hasStage2Schema = true;
      return [{ index, response, raw: message.value, issues }];
    } catch {
      return [{ index, raw: message.value, issues: ['导师回复不是合法的 ChatResponse JSON'] }];
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
    (item?.candidates ?? []).map((candidate) => [candidate.id, assistantDetails(candidate.record)])
  ), [item]);
  const selectedHasErrors = (candidateChecks.get(selected) ?? []).some((turn) => turn.issues.length > 0);
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

  if (!item) return <div className="border bg-white p-8 text-center"><p className="text-gray-500">{message ?? '正在领取仲裁任务…'}</p><button onClick={claim} disabled={pending} className="mt-4 bg-gray-950 px-4 py-2 text-sm text-white">重新领取</button></div>;

  return <div className="space-y-5">
    <div className="border bg-white p-4"><div className="text-xs font-medium text-blue-700">P{item.phase} · 匿名仲裁</div><h2 className="mt-1 text-lg font-semibold">{item.scenario}</h2>{stylePolicy && <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900"><div className="font-medium">共同目标风格：{stylePolicy.label}</div><p className="mt-1 text-xs leading-5">{stylePolicy.summary} 判定时同时检查：{stylePolicy.annotationRubric.join('；')}。</p></div>}{item.styleTargetMismatch && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">这是旧活动遗留任务，候选版本的目标风格不一致。本次只能按内容、阶段和结构质量仲裁，不能用于判断风格遵循度。</div>}<div className="mt-3 max-w-4xl space-y-2">{item.original.conversations.filter((entry) => entry.from === 'human').map((entry, index) => <p key={index} className="border-l-4 border-gray-300 pl-3 text-sm leading-6">{entry.value}</p>)}</div>{item.autoCheck?.issues?.length > 0 && <div className="mt-3 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">原始样本自动检查：{item.autoCheck.issues.map((check) => check.message).join('；')}</div>}</div>
    <div className="grid gap-4 xl:grid-cols-2">{item.candidates.map((candidate) => {
      const details = candidateChecks.get(candidate.id) ?? [];
      const issueCount = details.reduce((sum, turn) => sum + turn.issues.length, 0);
      return <label key={candidate.id} className={`block cursor-pointer border bg-white p-4 ${selected === candidate.id ? 'border-blue-600 ring-1 ring-blue-600' : ''}`}><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-lg font-semibold">版本 {candidate.label}</span><span className={`rounded-full px-2 py-1 text-xs ${issueCount > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{issueCount > 0 ? `${issueCount} 个结构错误` : '结构契约通过'}</span></div><input type="radio" name="candidate" value={candidate.id} checked={selected === candidate.id} onChange={() => setSelected(candidate.id)} /></div><div className="mt-4 space-y-4">{details.map((turn, turnIndex) => <div key={turn.index} className={`rounded border p-3 ${turn.issues.length > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}><div className="mb-2 flex flex-wrap gap-2 text-xs"><span className="font-medium">导师回复 {turnIndex + 1}</span>{turn.response && <><span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700">action: {turn.response.next_action_type}</span><span className="rounded bg-gray-100 px-2 py-0.5">phase_complete: {String(turn.response.phase_complete)}</span><span className="rounded bg-purple-50 px-2 py-0.5 text-purple-700">schema: {turn.response.data_table_schema?.columns.length ?? 0} 列</span></>}</div><p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">{turn.response?.dialogue ?? turn.raw}</p>{turn.response?.data_table_schema && <p className="mt-2 text-xs text-gray-500">字段：{turn.response.data_table_schema.columns.map((column) => `${column.key}(${column.type})`).join('、')}</p>}{turn.issues.length > 0 && <ul className="mt-2 space-y-1 text-xs text-red-700">{turn.issues.map((issue) => <li key={issue}>• {issue}</li>)}</ul>}</div>)}</div></label>;
    })}</div>
    <div className="grid gap-4 border bg-white p-4 lg:grid-cols-[220px_1fr_auto]"><label className="text-sm">最终等级<select value={tier} onChange={(event) => setTier(event.target.value as typeof tier)} className="mt-1 w-full border px-2 py-2"><option value="human_gold">Human Gold</option><option value="reviewed_silver">Reviewed Silver</option><option value="reject">Reject</option></select></label><label className="text-sm">仲裁理由<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-20 w-full border p-2" /></label><div className="flex flex-wrap items-end gap-2"><button onClick={() => decide('SELECT')} disabled={pending || selectedHasErrors} className="bg-gray-950 px-3 py-2 text-sm text-white disabled:opacity-40">接受所选</button><button onClick={() => decide('RETURN')} disabled={pending} className="border px-3 py-2 text-sm">退回</button><button onClick={() => decide('REJECT')} disabled={pending} className="border border-red-600 px-3 py-2 text-sm text-red-700">拒绝</button></div></div>{message && <p className="text-sm text-red-600">{message}</p>}
  </div>;
}
