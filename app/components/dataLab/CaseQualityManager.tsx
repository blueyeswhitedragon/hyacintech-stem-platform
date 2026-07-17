'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import { TUTOR_CASE_ISSUE_LABELS, dataLabStatusLabel, dataLabValueLabel } from '@/app/lib/dataLab/labels';

interface CaseQualityTaskView {
  id: string;
  reason: string;
  caseIssueJson: string;
  case: {
    id: string;
    revision: number;
    phase: number;
    triggerType: string;
    studentMessage: string;
    visibleFactsJson: string;
    status: string;
    topicCard: { displayTitle: string; subject: string } | null;
    generationRun: { reviewPolicy: string } | null;
  };
}

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export default function CaseQualityManager({ tasks }: { tasks: CaseQualityTaskView[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [visibleFacts, setVisibleFacts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [rejectingTask, setRejectingTask] = useState<CaseQualityTaskView | null>(null);

  async function resolve(task: CaseQualityTaskView, decision: 'APPROVE_REVISION' | 'KEEP_CASE' | 'REJECT_CASE') {
    setPendingId(task.id);
    setResult(null);
    try {
      const factsRaw = visibleFacts[task.id] ?? JSON.stringify(parseJson(task.case.visibleFactsJson, {}), null, 2);
      let parsedFacts: unknown;
      try { parsedFacts = JSON.parse(factsRaw); } catch { throw new Error('学生可见事实 JSON 无法解析'); }
      const response = await fetch('/api/data-lab/tutor-cases/quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          decision,
          studentMessage: messages[task.id] ?? parseJson<{ suggestedStudentMessage?: string }>(task.caseIssueJson, {}).suggestedStudentMessage ?? task.case.studentMessage,
          visibleFacts: parsedFacts,
          reason: reasons[task.id] ?? '',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '处理失败');
      setResult(`已处理：${dataLabStatusLabel(data.status)}`);
      setRejectingTask(null);
      router.refresh();
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingId(null);
    }
  }

  return <div className="space-y-4">
    {tasks.map((task) => {
      const issue = parseJson<{ categories?: string[]; suggestedStudentMessage?: string; note?: string }>(task.caseIssueJson, {});
      const studentMessage = messages[task.id] ?? issue.suggestedStudentMessage ?? task.case.studentMessage;
      const facts = visibleFacts[task.id] ?? JSON.stringify(parseJson(task.case.visibleFactsJson, {}), null, 2);
      return <article key={task.id} className="rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-xs text-gray-500">阶段 {task.case.phase} · 第 {task.case.revision} 版 · {dataLabValueLabel(task.case.topicCard?.subject)} · {dataLabValueLabel(task.case.generationRun?.reviewPolicy ?? 'HUMAN_ANNOTATOR_REQUIRED')}</div><h2 className="mt-1 font-semibold">{task.case.topicCard?.displayTitle ?? '未绑定话题卡'}</h2></div>
          <span className="rounded bg-violet-100 px-2 py-1 text-xs text-violet-800">等待管理员处理</span>
        </div>
        <div className="mt-3 rounded bg-gray-50 p-3 text-sm"><b>原学生问题：</b>{task.case.studentMessage}</div>
        <div className="mt-3 rounded border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950"><div><b>定稿人说明：</b>{issue.note || task.reason}</div><div className="mt-1 text-xs">类别：{issue.categories?.map((category) => TUTOR_CASE_ISSUE_LABELS[category as keyof typeof TUTOR_CASE_ISSUE_LABELS] ?? '其他案例质量问题').join('、') || '未分类'}</div></div>
        <label className="mt-3 block text-sm font-medium">建议修订后的学生问题<textarea value={studentMessage} onChange={(event) => setMessages((current) => ({ ...current, [task.id]: event.target.value }))} className="mt-1 min-h-24 w-full border p-3 font-normal" /></label>
        <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">高级：检查或修改学生可见事实</summary><p className="mt-2 text-xs text-gray-500">仅在学生问题与现有事实不一致时修改，内容使用 JSON 格式。</p><textarea value={facts} onChange={(event) => setVisibleFacts((current) => ({ ...current, [task.id]: event.target.value }))} className="mt-2 min-h-52 w-full border bg-gray-950 p-3 font-mono text-xs text-gray-100" /></details>
        <label className="mt-3 block text-sm font-medium">管理员处理理由（必填）<textarea value={reasons[task.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [task.id]: event.target.value }))} className="mt-1 min-h-20 w-full border p-3 font-normal" /></label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={pendingId === task.id || !(reasons[task.id] ?? '').trim()} onClick={() => resolve(task, 'APPROVE_REVISION')} className="bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-40">批准修改并创建新版本</button>
          <button disabled={pendingId === task.id || !(reasons[task.id] ?? '').trim()} onClick={() => resolve(task, 'KEEP_CASE')} className="border px-3 py-2 text-sm disabled:opacity-40">保留原案例并送回定稿人</button>
          <button disabled={pendingId === task.id || !(reasons[task.id] ?? '').trim()} onClick={() => setRejectingTask(task)} className="border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-40">淘汰案例</button>
        </div>
      </article>;
    })}
    {tasks.length === 0 && <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">当前没有待管理员处理的学生案例质量任务。</div>}
    {result && <p className="text-sm text-gray-600">{result}</p>}
    <ConfirmDialog open={Boolean(rejectingTask)} title="淘汰学生案例" description={`将淘汰“${rejectingTask?.case.topicCard?.displayTitle ?? '当前案例'}”的这个案例版本。`} consequence="案例将不再进入双审或数据版本；已有审核记录会保留用于审计。此操作不会删除原始话题卡。" confirmLabel="确认淘汰" danger pending={Boolean(pendingId)} onClose={() => setRejectingTask(null)} onConfirm={() => rejectingTask && resolve(rejectingTask, 'REJECT_CASE')} />
  </div>;
}
