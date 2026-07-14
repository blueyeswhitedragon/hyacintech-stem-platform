"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  ISSUE_TAGS,
  ISSUE_TAG_META,
  PHASE_META,
  STYLE_LABELS,
  type AutoCheckIssue,
  type AutoCheckResult,
  type AnnotationClaimAvailability,
  type AnnotationPayload,
  type RevisionInput,
  TRANSFORMATION_LABELS,
  TRANSFORMATION_TYPES,
  type TransformationType,
} from '@/app/lib/dataLab/types';
import type { ChatResponse } from '@/app/models/types';
import { getStylePolicy } from '@/app/lib/stylePolicy';

type EditableTurn = { messageIndex: number; response: ChatResponse };

function availabilityMessage(availability?: AnnotationClaimAvailability | null): string {
  if (!availability) return '当前没有可领取任务。';
  if (availability.reason === 'NO_ACTIVE_CAMPAIGN') return '当前没有进行中的标注活动，请联系管理员启动活动。';
  if (availability.reason === 'NO_CAMPAIGN_ASSIGNMENT') return '管理员尚未把你加入当前标注活动，请联系管理员分配任务。';
  if (availability.reason === 'DOUBLE_BLIND_EXHAUSTED') {
    return `你已处理完当前可分配样本。剩余 ${availability.blockedByDoubleBlind} 条为双标任务，需要其他标注员完成。`;
  }
  return '当前活动暂时没有待领取任务。';
}

function cloneResponse(response: ChatResponse): ChatResponse {
  return JSON.parse(JSON.stringify(response)) as ChatResponse;
}

function ValidationBadge({ check, validating }: { check: AutoCheckResult | null; validating: boolean }) {
  if (validating || !check) return <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">正在校验</span>;
  const errors = check.issues.filter((item) => item.severity === 'error').length;
  const warnings = check.issues.filter((item) => item.severity === 'warning').length;
  if (errors > 0) return <span className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700">{errors} 个错误 · {warnings} 个复核项</span>;
  if (warnings > 0) return <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">{warnings} 个复核项 · 允许提交</span>;
  return <span className="rounded-full bg-green-100 px-2 py-1 text-xs text-green-700">自动检查通过</span>;
}

export default function AnnotationWorkbench() {
  const [task, setTask] = useState<AnnotationPayload | null>(null);
  const [turns, setTurns] = useState<EditableTurn[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [noChange, setNoChange] = useState(false);
  const [transformationType, setTransformationType] = useState<TransformationType>('LIGHT_EDIT');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revisionCheck, setRevisionCheck] = useState<AutoCheckResult | null>(null);
  const [validating, setValidating] = useState(false);

  function load(payload: AnnotationPayload | null) {
    setTask(payload); setMessage(null); setRevisionCheck(null); setValidating(!!payload);
    if (!payload) { setTurns([]); return; }
    const base = payload.draft?.assistantMessages?.length
      ? payload.draft.assistantMessages.map((item) => ({ messageIndex: item.messageIndex, response: cloneResponse(item.response) }))
      : payload.conversations.filter((item) => item.from === 'gpt' && item.response).map((item) => ({ messageIndex: item.index, response: cloneResponse(item.response!) }));
    setTurns(base); setTags(payload.draft?.issueTags ?? []); setReason(payload.draft?.changeReason ?? ''); setNoChange(payload.draft?.noChange ?? false); setTransformationType(payload.draft?.transformationType ?? (payload.draft?.noChange ? 'NO_CHANGE' : 'LIGHT_EDIT'));
  }

  async function claim() {
    setPending(true); setMessage(null);
    try { const response = await fetch('/api/data-lab/tasks/claim', { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '领取失败'); load(data.task); if (!data.task) setMessage(availabilityMessage(data.availability)); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }

  useEffect(() => {
    let cancelled = false;
    fetch('/api/data-lab/tasks/claim', { method: 'POST' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '领取失败');
        if (!cancelled) load(data.task);
        if (!cancelled && !data.task) setMessage(availabilityMessage(data.availability));
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);

  function updateTurn(index: number, updater: (response: ChatResponse) => ChatResponse) {
    setNoChange(false); if (transformationType === 'NO_CHANGE') setTransformationType('LIGHT_EDIT');
    setTurns((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, response: updater(cloneResponse(item.response)) } : item));
  }

  const payload: RevisionInput = useMemo(() => ({ assistantMessages: turns, issueTags: tags, changeReason: reason, noChange, transformationType }), [turns, tags, reason, noChange, transformationType]);
  const payloadSignature = useMemo(() => JSON.stringify(payload), [payload]);
  const turnChecks = useMemo(() => new Map(
    turns.map((turn) => [
      turn.messageIndex,
      revisionCheck?.issues.filter((item) => item.messageIndex === turn.messageIndex) ?? [],
    ])
  ), [revisionCheck, turns]);
  const hardIssueCount = revisionCheck?.issues.filter((item) => item.severity === 'error').length ?? 0;
  const warningCount = revisionCheck?.issues.filter((item) => item.severity === 'warning').length ?? 0;
  const generalIssues = revisionCheck?.issues.filter((item) => item.messageIndex === undefined) ?? [];
  const hasEdits = useMemo(() => {
    if (!task) return false;
    const originals = new Map(task.conversations.filter((item) => item.from === 'gpt' && item.response).map((item) => [item.index, item.response!]));
    return turns.some((turn) => JSON.stringify(turn.response) !== JSON.stringify(originals.get(turn.messageIndex)));
  }, [task, turns]);

  async function requestValidation(value: RevisionInput, signal?: AbortSignal): Promise<AutoCheckResult> {
    if (!task) return { status: 'error', issues: [{ ruleCode: 'TASK_MISSING', severity: 'error', message: '当前没有可校验任务' }] };
    const response = await fetch(`/api/data-lab/tasks/${task.taskId}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? '校验失败');
    return data.check as AutoCheckResult;
  }

  useEffect(() => {
    if (!task || turns.length === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setValidating(true);
      setRevisionCheck(null);
      requestValidation(payload, controller.signal)
        .then((check) => { if (!controller.signal.aborted) setRevisionCheck(check); })
        .catch((error) => {
          if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
        })
        .finally(() => { if (!controller.signal.aborted) setValidating(false); });
    }, 550);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // payloadSignature 是稳定的修订快照；避免因对象引用变化重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.taskId, payloadSignature]);

  function focusIssue(item: AutoCheckIssue) {
    if (item.messageIndex === undefined) return;
    document.getElementById(`assistant-turn-${item.messageIndex}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function save() {
    if (!task) return; setPending(true); setMessage(null);
    try { const response = await fetch(`/api/data-lab/tasks/${task.taskId}/draft`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '保存失败'); setMessage('草稿已保存'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); }
  }

  async function submit() {
    if (!task) return;
    if (noChange && hasEdits) { setMessage('已修改导师回复，不能同时勾选“无需修改”。'); return; }
    setPending(true); setValidating(true); setMessage(null);
    try {
      const latestCheck = await requestValidation(payload);
      setRevisionCheck(latestCheck);
      if (latestCheck.status === 'error') {
        const count = latestCheck.issues.filter((item) => item.severity === 'error').length;
        setMessage(`还有 ${count} 个硬错误，请先修正标红轮次。`);
        focusIssue(latestCheck.issues.find((item) => item.severity === 'error')!);
        return;
      }
      const response = await fetch(`/api/data-lab/tasks/${task.taskId}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) {
        if (data.check) setRevisionCheck(data.check as AutoCheckResult);
        throw new Error(data.error ?? '提交失败');
      }
      setMessage(latestCheck.status === 'warning' ? '已带人工复核项提交，正在领取下一条' : '提交成功，正在领取下一条');
      await claim();
    }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setPending(false); setValidating(false); }
  }

  if (!task) return <div className="rounded-xl border bg-white p-8 text-center shadow-sm"><p className="text-gray-600">{message ?? '正在领取任务…'}</p><button onClick={claim} disabled={pending} className="mt-4 rounded-lg bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-50">重新检查任务</button></div>;

  const phaseMeta = PHASE_META[task.phase] ?? { label: `阶段 ${task.phase}`, goal: '', guardrail: '' };
  const stylePolicy = task.styleFamily ? getStylePolicy(task.styleFamily, task.stylePolicyVersion) : null;
  const startingPoint = task.conversations.find((item) => item.from === 'human')?.value;

  return <div className="space-y-5">
    <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-sm font-semibold text-blue-700">阶段 {task.phase}/6 · {phaseMeta.label} · {task.styleFamily ? STYLE_LABELS[task.styleFamily] : '自由风格'}</div><h2 className="mt-1 text-lg font-semibold">{task.scenario}</h2><p className="mt-2 text-sm text-gray-700">本阶段目标：{phaseMeta.goal}</p><p className="mt-1 text-xs text-amber-700">边界提醒：{phaseMeta.guardrail}</p><p className="mt-2 text-xs text-gray-500">任务租约至 {task.leaseExpiresAt ? new Date(task.leaseExpiresAt).toLocaleTimeString('zh-CN') : '-'}</p></div><div className="hidden flex-col items-end gap-2 sm:flex"><ValidationBadge check={revisionCheck} validating={validating} /><div className="flex gap-2"><button onClick={save} disabled={pending} className="rounded-lg border px-3 py-2 text-sm">保存草稿</button><button onClick={submit} disabled={pending} className="rounded-lg bg-gray-950 px-3 py-2 text-sm text-white disabled:opacity-50">提交标注</button></div></div></div>
      <ol className="mt-4 grid grid-cols-3 gap-1 text-center text-[11px] sm:grid-cols-6">{Object.entries(PHASE_META).map(([phase, meta]) => <li key={phase} className={`rounded px-1 py-2 ${Number(phase) === task.phase ? 'bg-blue-600 font-medium text-white' : 'bg-gray-100 text-gray-500'}`}>{phase}. {meta.label}</li>)}</ol>
      {stylePolicy && <details className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm"><summary className="cursor-pointer font-medium text-blue-900">本条目标风格：{stylePolicy.label} · 查看判定标准</summary><p className="mt-2 text-blue-800">{stylePolicy.summary}</p><ul className="mt-2 space-y-1 text-xs text-blue-800">{stylePolicy.annotationRubric.map((item) => <li key={item}>• {item}</li>)}</ul><p className="mt-2 text-[11px] text-blue-600">规范版本：{stylePolicy.version}</p></details>}
      <details className="mt-3 rounded-lg bg-gray-50 p-3 text-sm"><summary className="cursor-pointer font-medium text-gray-700">查看本条标注背景</summary><div className="mt-2 space-y-2 text-gray-600"><p><span className="font-medium text-gray-800">学生起点：</span>{startingPoint ?? '未提供'}</p><p><span className="font-medium text-gray-800">标注重点：</span>判断导师是否围绕当前阶段推进，并只修订导师回复。</p></div></details>
    </div>
    {task.autoCheck.issues.length > 0 && <div className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><div className="font-medium">原始样本自动检查</div><ul className="mt-1 space-y-1 text-xs">{task.autoCheck.issues.map((item) => <li key={`${item.ruleCode}-${item.message}`}>• [{item.severity}] {item.message}</li>)}</ul></div>}
    {(revisionCheck || validating) && <div className={`rounded-lg border p-3 text-sm ${hardIssueCount > 0 ? 'border-red-300 bg-red-50 text-red-800' : warningCount > 0 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-green-200 bg-green-50 text-green-800'}`}><div className="flex flex-wrap items-center justify-between gap-2"><span>{validating ? '正在使用与正式提交相同的服务端规则校验…' : hardIssueCount > 0 ? `检测到 ${hardIssueCount} 个硬错误，必须修正后才能提交。` : warningCount > 0 ? `有 ${warningCount} 个项目需要人工复核，但允许提交。` : '当前修订已通过自动检查。'}</span><ValidationBadge check={revisionCheck} validating={validating} /></div>{generalIssues.length > 0 && <ul className="mt-2 space-y-1 text-xs">{generalIssues.map((item) => <li key={`${item.ruleCode}-${item.message}`}>• [{item.severity === 'error' ? '错误' : '复核'}] {item.message}</li>)}</ul>}{revisionCheck && revisionCheck.issues.some((item) => item.messageIndex !== undefined) && <div className="mt-2 flex flex-wrap gap-2">{revisionCheck.issues.filter((item) => item.messageIndex !== undefined).map((item) => <button type="button" onClick={() => focusIssue(item)} key={`${item.ruleCode}-${item.messageIndex}-${item.message}`} className="rounded border border-current/20 px-2 py-1 text-xs">跳到导师回复 {item.messageIndex}</button>)}</div>}</div>}
    <div className="space-y-3">{task.conversations.map((item) => {
      if (item.from === 'human') return <div key={item.index} className="max-w-3xl border-l-4 border-gray-300 bg-white p-4"><div className="mb-2 text-xs font-medium text-gray-500">学生 · 只读</div><p className="whitespace-pre-wrap text-sm leading-6">{item.value}</p></div>;
      const turnIndex = turns.findIndex((turn) => turn.messageIndex === item.index); const turn = turns[turnIndex]; if (!turn) return null;
      const contractIssues = turnChecks.get(item.index) ?? [];
      return <AssistantEditor key={item.index} messageIndex={item.index} phase={task.phase} response={turn.response} originalResponse={item.response!} contractIssues={contractIssues} validating={validating} onChange={(response) => updateTurn(turnIndex, () => response)} />;
    })}</div>
    <div className="grid gap-4 rounded-xl border bg-white p-4 shadow-sm lg:grid-cols-2"><fieldset><legend className="text-sm font-medium">问题标签</legend><p className="mt-1 text-xs text-gray-500">按实际问题选择；点击“说明”可查看判定标准。</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{ISSUE_TAGS.map((tag) => <div key={tag} className="rounded-lg border p-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tags.includes(tag)} onChange={(event) => setTags((current) => event.target.checked ? [...current, tag] : current.filter((item) => item !== tag))} />{ISSUE_TAG_META[tag].label}</label><details className="mt-1 text-xs text-gray-500"><summary className="cursor-pointer">说明</summary><p className="mt-1 leading-5">{ISSUE_TAG_META[tag].description}</p></details></div>)}</div></fieldset><div><label className="text-sm font-medium">人工变换类型<select value={transformationType} onChange={(event) => { const value = event.target.value as TransformationType; setTransformationType(value); setNoChange(value === 'NO_CHANGE'); }} className="mt-2 w-full rounded-lg border p-2 text-sm">{TRANSFORMATION_TYPES.map((type) => <option key={type} value={type}>{TRANSFORMATION_LABELS[type]}</option>)}</select></label>{task.sourceKind === 'production_trace' && <p className="mt-1 text-xs text-amber-700">线上模型原回答只有“实质纠正”或“人工重写”并通过服务端差异校验后，才可能进入训练。</p>}<label className="mt-3 block text-sm font-medium">修改理由<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 min-h-28 w-full rounded-lg border p-2 text-sm" placeholder="说明保留了什么、修复了什么。" /></label><label className={`mt-2 block text-sm ${hasEdits ? 'text-gray-400' : ''}`}><input type="checkbox" checked={noChange} disabled={hasEdits} onChange={(event) => { setNoChange(event.target.checked); setTransformationType(event.target.checked ? 'NO_CHANGE' : 'LIGHT_EDIT'); }} className="mr-1" />无需修改，原回复已符合要求</label>{hasEdits && <p className="mt-1 text-xs text-gray-500">已检测到回复修订，因此不能选择“无需修改”。</p>}</div></div>
    {message && <div className="text-sm text-gray-600">{message}</div>}
    <div className="sticky bottom-3 z-20 flex items-center gap-2 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur sm:hidden"><ValidationBadge check={revisionCheck} validating={validating} /><button onClick={save} disabled={pending} className="flex-1 rounded-lg border px-3 py-3 text-sm">保存草稿</button><button onClick={submit} disabled={pending} className="flex-1 rounded-lg bg-gray-950 px-3 py-3 text-sm text-white">提交标注</button></div>
  </div>;
}

function AssistantEditor({ messageIndex, phase, response, originalResponse, contractIssues, validating, onChange }: { messageIndex: number; phase: number; response: ChatResponse; originalResponse: ChatResponse; contractIssues: AutoCheckIssue[]; validating: boolean; onChange: (value: ChatResponse) => void }) {
  const patch = (value: Partial<ChatResponse>) => onChange({ ...response, ...value });
  const errors = contractIssues.filter((item) => item.severity === 'error');
  const warnings = contractIssues.filter((item) => item.severity === 'warning');
  return <div id={`assistant-turn-${messageIndex}`} className={`scroll-mt-24 rounded-xl border bg-white p-4 shadow-sm ${errors.length > 0 ? 'border-red-400' : warnings.length > 0 ? 'border-amber-400' : ''}`}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium text-blue-700">导师回复 · 可修订</span><div className="flex items-center gap-2"><button type="button" onClick={() => onChange(cloneResponse(originalResponse))} className="rounded border px-2 py-1 text-xs text-gray-600">恢复本轮原文</button>{validating ? <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">正在校验</span> : <span className={`rounded-full px-2 py-1 text-xs ${errors.length > 0 ? 'bg-red-100 text-red-700' : warnings.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-700'}`}>{errors.length > 0 ? `${errors.length} 个错误` : warnings.length > 0 ? `${warnings.length} 个复核项` : '自动检查通过'}</span>}</div></div>
    <label className="text-sm">对话内容<textarea value={response.dialogue} onChange={(event) => patch({ dialogue: event.target.value })} className="mt-1 min-h-28 w-full border p-2 leading-6" /></label>
    <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-sm">下一步动作<select value={response.next_action_type} onChange={(event) => patch({ next_action_type: event.target.value as ChatResponse['next_action_type'] })} className="mt-1 w-full border px-2 py-2"><option value="text_input">继续输入</option><option value="confirmation">请求确认</option><option value="info">信息提示</option><option value="ask_choice">选择题</option></select></label><label className="text-sm">提示（每行一条）<textarea value={(response.hints ?? []).join('\n')} onChange={(event) => patch({ hints: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} className="mt-1 min-h-20 w-full border p-2" /></label><label className="text-sm">选项（每行一条）<textarea value={(response.options ?? []).join('\n')} onChange={(event) => patch({ options: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} className="mt-1 min-h-20 w-full border p-2" /></label></div>
    <label className="mt-3 block text-sm"><input type="checkbox" checked={response.phase_complete} onChange={(event) => patch({ phase_complete: event.target.checked })} className="mr-1" />当前阶段完成</label>
    {phase === 1 && <Phase1Editor response={response} onChange={patch} />}
    {phase === 2 && <Phase2Editor response={response} onChange={patch} />}
    {phase === 5 && <Phase5Editor response={response} onChange={patch} />}
    {contractIssues.length > 0 && <ul className="mt-3 space-y-1 border-t pt-3 text-xs">{contractIssues.map((item) => <li key={`${item.ruleCode}-${item.message}`} className={item.severity === 'error' ? 'text-red-700' : 'text-amber-800'}>• [{item.severity === 'error' ? '错误' : '人工复核'}] {item.message}</li>)}</ul>}
  </div>;
}

function Phase1Editor({ response, onChange }: { response: ChatResponse; onChange: (value: Partial<ChatResponse>) => void }) {
  const mapping = response.theme_mapping ?? { originalInterest: '', retainedFeature: '', classroomProxy: '', researchQuestion: '' };
  const legacy = response.variables;
  const direction = response.topic_direction ?? {
    factor: legacy?.independent ?? '',
    phenomenon: legacy?.dependent ?? '',
  };
  return (
    <div className="mt-4 border-t pt-4">
      <h3 className="text-sm font-medium">阶段1确认结构</h3>
      <p className="mt-1 text-xs text-amber-700">这里只确定因素方向和现象方向；水平、测量方式与控制变量留到阶段2。</p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {(['originalInterest', 'retainedFeature', 'classroomProxy', 'researchQuestion'] as const).map((key) => (
          <label key={key} className="text-xs">{key}
            <input value={mapping[key]} onChange={(event) => onChange({ theme_mapping: { ...mapping, [key]: event.target.value } })} className="mt-1 w-full border px-2 py-1.5 text-sm" />
          </label>
        ))}
        <label className="text-xs">拟改变因素方向
          <input value={direction.factor} onChange={(event) => onChange({ topic_direction: { ...direction, factor: event.target.value } })} className="mt-1 w-full border px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs">关注现象方向
          <input value={direction.phenomenon} onChange={(event) => onChange({ topic_direction: { ...direction, phenomenon: event.target.value } })} className="mt-1 w-full border px-2 py-1.5 text-sm" />
        </label>
      </div>
      <label className="mt-2 block text-xs">确认书
        <textarea value={response.snapshot ?? ''} onChange={(event) => onChange({ snapshot: event.target.value, stage1_confirmed: true, variables: undefined })} className="mt-1 min-h-20 w-full border p-2 text-sm" />
      </label>
    </div>
  );
}

function Phase2Editor({ response, onChange }: { response: ChatResponse; onChange: (value: Partial<ChatResponse>) => void }) {
  const plan = response.experiment_plan ?? {
    independentVariable: { name: '', levels: [] },
    dependentVariable: { name: '', measurement: '' },
    controlledVariables: [],
    materials: [],
    procedure: [],
    repeatCount: 3,
    safetyNotes: [],
  };
  const splitLines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
  const planEditor = (
    <div className="mt-4 border-t pt-4">
      <h3 className="text-sm font-medium">结构化实验方案</h3>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="text-xs">自变量名称<input value={plan.independentVariable.name} onChange={(event) => onChange({ experiment_plan: { ...plan, independentVariable: { ...plan.independentVariable, name: event.target.value } } })} className="mt-1 w-full border px-2 py-1.5 text-sm" /></label>
        <label className="text-xs">自变量水平（每行一个）<textarea value={plan.independentVariable.levels.join('\n')} onChange={(event) => onChange({ experiment_plan: { ...plan, independentVariable: { ...plan.independentVariable, levels: splitLines(event.target.value) } } })} className="mt-1 min-h-20 w-full border p-2 text-sm" /></label>
        <label className="text-xs">因变量名称<input value={plan.dependentVariable.name} onChange={(event) => onChange({ experiment_plan: { ...plan, dependentVariable: { ...plan.dependentVariable, name: event.target.value } } })} className="mt-1 w-full border px-2 py-1.5 text-sm" /></label>
        <label className="text-xs">测量方式<input value={plan.dependentVariable.measurement} onChange={(event) => onChange({ experiment_plan: { ...plan, dependentVariable: { ...plan.dependentVariable, measurement: event.target.value } } })} className="mt-1 w-full border px-2 py-1.5 text-sm" /></label>
        <label className="text-xs">每个水平重复次数<input type="number" min={1} value={plan.repeatCount} onChange={(event) => onChange({ experiment_plan: { ...plan, repeatCount: Math.max(1, Number(event.target.value) || 1) } })} className="mt-1 w-full border px-2 py-1.5 text-sm" /></label>
        {([
          ['controlledVariables', '控制变量'],
          ['materials', '材料'],
          ['procedure', '步骤'],
          ['safetyNotes', '安全措施'],
        ] as const).map(([key, label]) => <label key={key} className="text-xs">{label}（每行一条）<textarea value={plan[key].join('\n')} onChange={(event) => onChange({ experiment_plan: { ...plan, [key]: splitLines(event.target.value) } })} className="mt-1 min-h-20 w-full border p-2 text-sm" /></label>)}
      </div>
    </div>
  );

  if (!response.data_table_schema) {
    return <>{planEditor}<div className="mt-4 border-t pt-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium">实验数据表</h3><p className="mt-1 text-xs text-gray-500">中间讨论轮次可不生成数据表；最终轮次必须同时提交方案与表格。</p></div><button type="button" onClick={() => onChange({ experiment_plan: plan, next_action_type: 'confirmation', data_table_schema: { columns: [{ key: 'notes', title: '备注', type: 'text', required: false }], minRows: 3, maxRows: 200 } })} className="border px-2 py-1 text-xs">在本轮创建数据表</button></div></div></>;
  }
  const schema = response.data_table_schema;
  const columns = schema.columns;
  return <>{planEditor}<div className="mt-4 border-t pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">实验数据表</h3><div className="flex gap-2"><button type="button" onClick={() => onChange({ data_table_schema: undefined, next_action_type: response.next_action_type === 'confirmation' ? 'text_input' : response.next_action_type, phase_complete: false })} className="rounded border border-red-200 px-2 py-1 text-xs text-red-700">移除本轮数据表</button><button type="button" onClick={() => onChange({ data_table_schema: { ...schema, columns: [...columns, { key: `field_${columns.length + 1}`, title: '新字段', type: 'text', required: false }] } })} className="rounded border px-2 py-1 text-xs">添加列</button></div></div><div className="mt-3 flex flex-wrap gap-3"><label className="text-xs">最少行数<input type="number" min={3} value={schema.minRows} onChange={(event) => onChange({ data_table_schema: { ...schema, minRows: Number(event.target.value) } })} className="ml-2 w-20 rounded border px-2 py-1" /></label><label className="text-xs">最大行数<input type="number" min={1} value={schema.maxRows} onChange={(event) => onChange({ data_table_schema: { ...schema, maxRows: Number(event.target.value) } })} className="ml-2 w-20 rounded border px-2 py-1" /></label></div><div className="mt-3 space-y-2">{columns.map((column, index) => <div key={`${column.key}-${index}`} className="grid gap-2 rounded-lg border bg-gray-50 p-3 md:grid-cols-[1fr_1.5fr_100px_80px_32px]"><label className="text-xs text-gray-500 md:contents"><span className="md:hidden">字段键</span><input aria-label={`第 ${index + 1} 列字段键`} value={column.key} onChange={(event) => onChange({ data_table_schema: { ...schema, columns: columns.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) } })} className="w-full rounded border bg-white px-2 py-2 text-sm text-gray-900" /></label><label className="text-xs text-gray-500 md:contents"><span className="md:hidden">中文名称</span><input aria-label={`第 ${index + 1} 列中文名称`} value={column.title} onChange={(event) => onChange({ data_table_schema: { ...schema, columns: columns.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) } })} className="w-full rounded border bg-white px-2 py-2 text-sm text-gray-900" /></label><select aria-label={`第 ${index + 1} 列类型`} value={column.type} onChange={(event) => onChange({ data_table_schema: { ...schema, columns: columns.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as 'text'|'number'|'image' } : item) } })} className="rounded border bg-white px-2 py-2 text-sm"><option value="text">文本</option><option value="number">数字</option><option value="image">图片</option></select><label className="pt-2 text-xs"><input type="checkbox" checked={column.required} onChange={(event) => onChange({ data_table_schema: { ...schema, columns: columns.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item) } })} className="mr-1" />必填</label><button type="button" onClick={() => onChange({ data_table_schema: { ...schema, columns: columns.filter((_, itemIndex) => itemIndex !== index) } })} title="删除列" className="rounded p-2 text-red-600">删除</button></div>)}</div></div></>;
}

function Phase5Editor({ response, onChange }: { response: ChatResponse; onChange: (value: Partial<ChatResponse>) => void }) {
  const sections = response.report_sections ?? { purpose: '', hypothesis: '', materials: '', procedure: '', dataSummary: '', analysis: '' };
  return <div className="mt-4 border-t pt-4"><h3 className="text-sm font-medium">报告框架</h3><div className="mt-2 grid gap-2 md:grid-cols-2">{(Object.keys(sections) as Array<keyof typeof sections>).map((key) => <label key={key} className="text-xs">{key}<textarea value={sections[key]} onChange={(event) => onChange({ report_sections: { ...sections, [key]: event.target.value } })} className="mt-1 min-h-20 w-full border p-2 text-sm" /></label>)}</div></div>;
}
