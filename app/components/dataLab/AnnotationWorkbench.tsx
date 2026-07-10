"use client";

import { useEffect, useMemo, useState } from 'react';
import { ISSUE_TAGS, STYLE_LABELS, type AnnotationPayload, type RevisionInput } from '@/app/lib/dataLab/types';
import type { ChatResponse } from '@/app/models/types';

type EditableTurn = { messageIndex: number; response: ChatResponse };

function cloneResponse(response: ChatResponse): ChatResponse {
  return JSON.parse(JSON.stringify(response)) as ChatResponse;
}

export default function AnnotationWorkbench() {
  const [task, setTask] = useState<AnnotationPayload | null>(null);
  const [turns, setTurns] = useState<EditableTurn[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [noChange, setNoChange] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function load(payload: AnnotationPayload | null) {
    setTask(payload); setMessage(null);
    if (!payload) { setTurns([]); return; }
    const base = payload.draft?.assistantMessages?.length
      ? payload.draft.assistantMessages.map((item) => ({ messageIndex: item.messageIndex, response: cloneResponse(item.response) }))
      : payload.conversations.filter((item) => item.from === 'gpt' && item.response).map((item) => ({ messageIndex: item.index, response: cloneResponse(item.response!) }));
    setTurns(base); setTags(payload.draft?.issueTags ?? []); setReason(payload.draft?.changeReason ?? ''); setNoChange(payload.draft?.noChange ?? false);
  }

  async function claim() {
    setPending(true); setMessage(null);
    try { const response = await fetch('/api/data-lab/tasks/claim', { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '领取失败'); load(data.task); if (!data.task) setMessage('当前没有可领取任务。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }

  useEffect(() => {
    let cancelled = false;
    fetch('/api/data-lab/tasks/claim', { method: 'POST' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '领取失败');
        if (!cancelled) load(data.task);
        if (!cancelled && !data.task) setMessage('当前没有可领取任务。');
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);

  function updateTurn(index: number, updater: (response: ChatResponse) => ChatResponse) {
    setTurns((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, response: updater(cloneResponse(item.response)) } : item));
  }

  const payload: RevisionInput = useMemo(() => ({ assistantMessages: turns, issueTags: tags, changeReason: reason, noChange }), [turns, tags, reason, noChange]);

  async function save() {
    if (!task) return; setPending(true); setMessage(null);
    try { const response = await fetch(`/api/data-lab/tasks/${task.taskId}/draft`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '保存失败'); setMessage('草稿已保存'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }

  async function submit() {
    if (!task) return; setPending(true); setMessage(null);
    try { const response = await fetch(`/api/data-lab/tasks/${task.taskId}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '提交失败'); setMessage('提交成功，正在领取下一条'); await claim(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }

  if (!task) return <div className="border bg-white p-8 text-center"><p className="text-gray-500">{message ?? '正在领取任务…'}</p><button onClick={claim} disabled={pending} className="mt-4 bg-gray-950 px-4 py-2 text-sm text-white">重新领取</button></div>;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4 border bg-white p-4"><div><div className="text-xs font-medium text-blue-700">P{task.phase} · {task.styleFamily ? STYLE_LABELS[task.styleFamily] : '自由风格'}</div><h2 className="mt-1 text-lg font-semibold">{task.scenario}</h2><p className="mt-1 text-xs text-gray-500">任务租约至 {task.leaseExpiresAt ? new Date(task.leaseExpiresAt).toLocaleTimeString('zh-CN') : '-'}</p></div><div className="flex gap-2"><button onClick={save} disabled={pending} className="border px-3 py-2 text-sm">保存草稿</button><button onClick={submit} disabled={pending} className="bg-gray-950 px-3 py-2 text-sm text-white">提交标注</button></div></div>
    <div className="space-y-3">{task.conversations.map((item) => {
      if (item.from === 'human') return <div key={item.index} className="max-w-3xl border-l-4 border-gray-300 bg-white p-4"><div className="mb-2 text-xs font-medium text-gray-500">学生 · 只读</div><p className="whitespace-pre-wrap text-sm leading-6">{item.value}</p></div>;
      const turnIndex = turns.findIndex((turn) => turn.messageIndex === item.index); const turn = turns[turnIndex]; if (!turn) return null;
      return <AssistantEditor key={item.index} phase={task.phase} response={turn.response} onChange={(response) => updateTurn(turnIndex, () => response)} />;
    })}</div>
    <div className="grid gap-4 border bg-white p-4 lg:grid-cols-2"><fieldset><legend className="text-sm font-medium">问题标签</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{ISSUE_TAGS.map((tag) => <label key={tag} className="text-xs"><input type="checkbox" checked={tags.includes(tag)} onChange={(event) => setTags((current) => event.target.checked ? [...current, tag] : current.filter((item) => item !== tag))} className="mr-1" />{tag}</label>)}</div></fieldset><div><label className="text-sm font-medium">修改理由<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 min-h-28 w-full border p-2 text-sm" placeholder="说明保留了什么、修复了什么。" /></label><label className="mt-2 block text-sm"><input type="checkbox" checked={noChange} onChange={(event) => setNoChange(event.target.checked)} className="mr-1" />无需修改，原回复已符合要求</label></div></div>
    {message && <div className="text-sm text-gray-600">{message}</div>}
  </div>;
}

function AssistantEditor({ phase, response, onChange }: { phase: number; response: ChatResponse; onChange: (value: ChatResponse) => void }) {
  const patch = (value: Partial<ChatResponse>) => onChange({ ...response, ...value });
  return <div className="border bg-white p-4"><div className="mb-3 text-xs font-medium text-blue-700">导师回复 · 可修订</div>
    <label className="text-sm">对话内容<textarea value={response.dialogue} onChange={(event) => patch({ dialogue: event.target.value })} className="mt-1 min-h-28 w-full border p-2 leading-6" /></label>
    <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-sm">下一步动作<select value={response.next_action_type} onChange={(event) => patch({ next_action_type: event.target.value as ChatResponse['next_action_type'] })} className="mt-1 w-full border px-2 py-2"><option value="text_input">继续输入</option><option value="confirmation">请求确认</option><option value="info">信息提示</option><option value="ask_choice">选择题</option></select></label><label className="text-sm">提示（每行一条）<textarea value={(response.hints ?? []).join('\n')} onChange={(event) => patch({ hints: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} className="mt-1 min-h-20 w-full border p-2" /></label><label className="text-sm">选项（每行一条）<textarea value={(response.options ?? []).join('\n')} onChange={(event) => patch({ options: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} className="mt-1 min-h-20 w-full border p-2" /></label></div>
    <label className="mt-3 block text-sm"><input type="checkbox" checked={response.phase_complete} onChange={(event) => patch({ phase_complete: event.target.checked })} className="mr-1" />当前阶段完成</label>
    {phase === 1 && <Phase1Editor response={response} onChange={patch} />}
    {phase === 2 && <Phase2Editor response={response} onChange={patch} />}
    {phase === 5 && <Phase5Editor response={response} onChange={patch} />}
  </div>;
}

function Phase1Editor({ response, onChange }: { response: ChatResponse; onChange: (value: Partial<ChatResponse>) => void }) {
  const mapping = response.theme_mapping ?? { originalInterest: '', retainedFeature: '', classroomProxy: '', researchQuestion: '' };
  const variables = response.variables ?? { independent: '', dependent: '', controlled: [] };
  return <div className="mt-4 border-t pt-4"><h3 className="text-sm font-medium">阶段1确认结构</h3><div className="mt-2 grid gap-2 md:grid-cols-2">{(['originalInterest','retainedFeature','classroomProxy','researchQuestion'] as const).map((key) => <label key={key} className="text-xs">{key}<input value={mapping[key]} onChange={(event) => onChange({ theme_mapping: { ...mapping, [key]: event.target.value } })} className="mt-1 w-full border px-2 py-1.5 text-sm" /></label>)}<label className="text-xs">自变量<input value={variables.independent} onChange={(event) => onChange({ variables: { ...variables, independent: event.target.value } })} className="mt-1 w-full border px-2 py-1.5 text-sm" /></label><label className="text-xs">因变量<input value={variables.dependent ?? ''} onChange={(event) => onChange({ variables: { ...variables, dependent: event.target.value } })} className="mt-1 w-full border px-2 py-1.5 text-sm" /></label></div><label className="mt-2 block text-xs">确认书<textarea value={response.snapshot ?? ''} onChange={(event) => onChange({ snapshot: event.target.value, stage1_confirmed: true })} className="mt-1 min-h-20 w-full border p-2 text-sm" /></label></div>;
}

function Phase2Editor({ response, onChange }: { response: ChatResponse; onChange: (value: Partial<ChatResponse>) => void }) {
  const schema = response.data_table_schema ?? { columns: [], minRows: 1, maxRows: 200 };
  const columns = schema.columns;
  return <div className="mt-4 border-t pt-4"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">实验数据表</h3><button type="button" onClick={() => onChange({ data_table_schema: { ...schema, columns: [...columns, { key: `field_${columns.length + 1}`, title: '新字段', type: 'text', required: false }] } })} className="border px-2 py-1 text-xs">添加列</button></div><div className="mt-2 space-y-2">{columns.map((column, index) => <div key={`${column.key}-${index}`} className="grid gap-2 md:grid-cols-[1fr_1.5fr_100px_80px_32px]"><input value={column.key} onChange={(event) => onChange({ data_table_schema: { ...schema, columns: columns.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) } })} className="border px-2 py-1 text-sm" /><input value={column.title} onChange={(event) => onChange({ data_table_schema: { ...schema, columns: columns.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) } })} className="border px-2 py-1 text-sm" /><select value={column.type} onChange={(event) => onChange({ data_table_schema: { ...schema, columns: columns.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as 'text'|'number'|'image' } : item) } })} className="border px-2 py-1 text-sm"><option value="text">文本</option><option value="number">数字</option><option value="image">图片</option></select><label className="pt-1 text-xs"><input type="checkbox" checked={column.required} onChange={(event) => onChange({ data_table_schema: { ...schema, columns: columns.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item) } })} className="mr-1" />必填</label><button type="button" onClick={() => onChange({ data_table_schema: { ...schema, columns: columns.filter((_, itemIndex) => itemIndex !== index) } })} title="删除列" className="text-red-600">×</button></div>)}</div></div>;
}

function Phase5Editor({ response, onChange }: { response: ChatResponse; onChange: (value: Partial<ChatResponse>) => void }) {
  const sections = response.report_sections ?? { purpose: '', hypothesis: '', materials: '', procedure: '', dataSummary: '', analysis: '' };
  return <div className="mt-4 border-t pt-4"><h3 className="text-sm font-medium">报告框架</h3><div className="mt-2 grid gap-2 md:grid-cols-2">{(Object.keys(sections) as Array<keyof typeof sections>).map((key) => <label key={key} className="text-xs">{key}<textarea value={sections[key]} onChange={(event) => onChange({ report_sections: { ...sections, [key]: event.target.value } })} className="mt-1 min-h-20 w-full border p-2 text-sm" /></label>)}</div></div>;
}
