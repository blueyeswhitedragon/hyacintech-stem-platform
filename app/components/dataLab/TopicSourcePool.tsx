'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Dialog from '@/app/components/dataLab/Dialog';
import { TOPIC_RESOURCE_TYPE_LABELS, TOPIC_SOURCE_STATUS_LABELS } from '@/app/lib/dataLab/labels';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select, Textarea } from '@/app/components/ui/Field';

interface SourceView {
  id: string;
  title: string;
  summary: string;
  resourceType: string;
  sourcePlatform: string;
  sourceResourceId: string;
  sourceUrl: string;
  authorizationStatus: string;
  familyKey: string;
  familyOverrideKey: string;
  effectiveFamilyKey: string;
  qualitySignalsJson: string;
  legacyHintsJson: string;
  status: string;
  _count: { cards: number };
}

const resourceTypes = ['UNCLASSIFIED', 'STUDENT_INQUIRY_RESOURCE', 'STUDENT_ENGINEERING_RESOURCE', 'HYBRID_RESOURCE', 'TEACHER_RESOURCE', 'SCIENCE_POPULARIZATION', 'INSUFFICIENT_SOURCE'];
const sourceStatuses = ['NEW', 'SHORTLISTED', 'REJECTED', 'COMPILED'];

function groupSources(sources: SourceView[]) {
  return sources.reduce<Record<string, SourceView[]>>((result, source) => {
    (result[source.effectiveFamilyKey] ??= []).push(source);
    return result;
  }, {});
}

export default function TopicSourcePool({ sources, defaultModels }: { sources: SourceView[]; defaultModels: { A: { provider: string; model: string }; B: { provider: string; model: string } } }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('SHORTLISTED');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [modelA, setModelA] = useState(defaultModels.A);
  const [modelB, setModelB] = useState(defaultModels.B);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [targetProject, setTargetProject] = useState('NEW');
  const filtered = useMemo(() => sources.filter((source) => (statusFilter === 'ALL' || source.status === statusFilter) && (!search.trim() || `${source.title} ${source.summary} ${source.sourceResourceId}`.toLowerCase().includes(search.trim().toLowerCase()))), [sources, search, statusFilter]);
  const grouped = useMemo(() => groupSources(filtered), [filtered]);
  const allProjects = useMemo(() => groupSources(sources), [sources]);

  function start() { setPending(true); setFeedback(null); }
  function fail(error: unknown) { setFeedback({ tone: 'error', text: error instanceof Error ? error.message : String(error) }); }

  async function importBuiltIn() {
    start();
    try {
      const response = await fetch('/api/data-lab/topic-sources/import', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '导入失败');
      setFeedback({ tone: 'success', text: `内置目录刷新完成：新增 ${data.created} 条，更新 ${data.updated} 条。` });
      router.refresh();
    } catch (error) { fail(error); }
    finally { setPending(false); }
  }

  async function update(id: string, patch: Record<string, unknown>) {
    start();
    try {
      const response = await fetch(`/api/data-lab/topic-sources/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '保存失败');
      setFeedback({ tone: 'success', text: '素材信息已保存。' });
      router.refresh();
    } catch (error) { fail(error); }
    finally { setPending(false); }
  }

  async function moveToProject() {
    if (!selected.length) return;
    start();
    try {
      const response = await fetch('/api/data-lab/topic-sources/family', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selected, familyKey: targetProject === 'NEW' ? '' : targetProject }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '课程项目调整失败');
      setSelected([]);
      setTargetProject('NEW');
      setProjectDialogOpen(false);
      setFeedback({ tone: 'success', text: `已将 ${data.count} 条素材归入同一课程项目。` });
      router.refresh();
    } catch (error) { fail(error); }
    finally { setPending(false); }
  }

  async function compileSelected() {
    if (!selected.length) return;
    start();
    try {
      const response = await fetch('/api/data-lab/topic-cards/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceCandidateIds: selected, modelA, modelB }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '双模型编译失败');
      const failures = Array.isArray(data.failures) ? data.failures as Array<{ reason?: string }> : [];
      setFeedback({ tone: data.failed ? 'error' : 'success', text: `编译完成：生成 ${data.completed} 张待审核卡，失败或拒绝 ${data.failed} 张${failures.length ? `。${failures.map((item) => item.reason).filter(Boolean).join('；')}` : ''}` });
      setSelected([]);
      router.refresh();
    } catch (error) { fail(error); }
    finally { setPending(false); }
  }

  return <section className="border border-hairline bg-canvas p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">候选素材池</h2><p className="mt-1 text-xs text-muted">同一门课的课件、视频和任务单按课程项目去重；确认授权并补足摘要后才能编译。</p></div><button disabled={pending} onClick={importBuiltIn} className={buttonClass('secondary', 'sm')}>导入或刷新内置目录</button></div>
    <div className="mt-3 border border-info/40 bg-info/8 p-3 text-xs text-body-strong"><div className="grid gap-2 md:grid-cols-3"><p><b>1. 确认授权</b><br />没有明确授权的素材不能调用模型。</p><p><b>2. 补充摘要</b><br />至少 20 字，写清真实问题、核心机制和课程信息。</p><p><b>3. 送入编译</b><br />同一课程项目只产出一组候选，避免重复出题。</p></div></div>
    <div className="mt-4 flex flex-wrap gap-2"><Select aria-label="素材状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="SHORTLISTED">只看首轮入选</option><option value="NEW">只看待进一步判断</option><option value="REJECTED">只看首轮排除</option><option value="COMPILED">只看已有卡片</option><option value="ALL">查看全部</option></Select><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、摘要或资源编号" className="flex-1" /><span className="self-center text-xs text-muted">{filtered.length} 条 · {Object.keys(grouped).length} 个课程项目 · 已选 {selected.length}</span></div>
    <div className="mt-3 grid gap-3 md:grid-cols-2">{[[modelA, setModelA, 'A'], [modelB, setModelB, 'B']].map(([model, setter, slot]) => { const item = model as typeof modelA; const set = setter as typeof setModelA; return <fieldset key={String(slot)} className="border border-hairline p-3"><legend className="px-1 text-xs font-medium">编译模型 {String(slot)}</legend><div className="mt-2 grid grid-cols-2 gap-2"><label className="text-[10px] text-muted">服务商<Input value={item.provider} onChange={(event) => set({ ...item, provider: event.target.value })} placeholder="openai" className="mt-1" /></label><label className="text-[10px] text-muted">模型标识<Input value={item.model} onChange={(event) => set({ ...item, model: event.target.value })} placeholder="模型名称" className="mt-1" /></label></div></fieldset>; })}</div>
    <div className="mt-3 flex flex-wrap gap-2"><button disabled={pending || !selected.length} onClick={compileSelected} className={buttonClass('secondary', 'sm')}>编译所选课程项目</button><button disabled={pending || !selected.length} onClick={() => setProjectDialogOpen(true)} className={buttonClass('secondary', 'sm')}>归入同一项目</button></div>
    {feedback && <p className={`mt-3 border border-hairline p-3 text-sm ${feedback.tone === 'success' ? 'border-success/40 bg-success/8 text-body-strong' : 'border-error/40 bg-error/8 text-body-strong'}`}>{feedback.text}</p>}
    <div className="mt-5 space-y-4">{Object.entries(grouped).map(([projectId, members]) => <details key={projectId} className="border border-hairline bg-surface-soft p-3"><summary className="cursor-pointer text-sm font-medium"><span className="mr-2 bg-canvas px-2 py-0.5 text-xs">{members.length} 条素材</span>{members[0].title}</summary><div className="mt-3 space-y-3">{members.map((source) => <SourceEditor key={source.id} source={source} selected={selected.includes(source.id)} disabled={pending} onSelect={(checked) => setSelected(checked ? [...selected, source.id] : selected.filter((id) => id !== source.id))} onSave={(patch) => update(source.id, patch)} />)}</div></details>)}</div>
    {!sources.length && <p className="mt-4 text-sm text-muted">素材池为空。请先导入内置目录或通过接口提交授权资源。</p>}
    <Dialog open={projectDialogOpen} title="归入同一课程项目" description={`已选择 ${selected.length} 条素材。选择已有项目，或让系统创建一个新项目。`} onClose={() => { if (!pending) setProjectDialogOpen(false); }} footer={<><button type="button" disabled={pending} onClick={() => setProjectDialogOpen(false)} className="border border-hairline px-4 py-2 text-sm">取消</button><button type="button" disabled={pending || !selected.length} onClick={moveToProject} className={buttonClass('primary', 'md')}>确认归入</button></>}><label className="block text-sm font-medium">目标项目<Select value={targetProject} onChange={(event) => setTargetProject(event.target.value)} className="mt-2"><option value="NEW">新建课程项目（系统自动编号）</option>{Object.entries(allProjects).map(([key, members]) => <option key={key} value={key}>{members[0].title}（{members.length} 条素材）</option>)}</Select></label></Dialog>
  </section>;
}

function SourceEditor({ source, selected, disabled, onSelect, onSave }: { source: SourceView; selected: boolean; disabled: boolean; onSelect: (value: boolean) => void; onSave: (patch: Record<string, unknown>) => void }) {
  const [summary, setSummary] = useState(source.summary);
  const [resourceType, setResourceType] = useState(source.resourceType);
  const [authorizationStatus, setAuthorizationStatus] = useState(source.authorizationStatus);
  const [status, setStatus] = useState(source.status);
  const signals = parseList(source.qualitySignalsJson).filter((item) => !item.startsWith('INITIAL_CURATION_'));
  const curation = initialCuration(source.legacyHintsJson);
  return <article className="border border-hairline bg-canvas p-3"><div className="flex items-start gap-2"><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} className="mt-1" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b className="text-sm">{source.title}</b><span className="text-[10px] text-muted-soft">{source.sourcePlatform} · {source.sourceResourceId || '无资源编号'} · 已生成 {source._count.cards} 张卡</span></div>{curation && <div className={`mt-2 p-2 text-xs ${curation.decision === 'SHORTLISTED' ? 'bg-success/8 text-body-strong' : curation.decision === 'REJECTED' ? 'bg-error/8 text-body-strong' : 'bg-warning/8 text-body-strong'}`}><b>首轮筛选：{curation.decision === 'SHORTLISTED' ? '入选' : curation.decision === 'REJECTED' ? '排除' : '待进一步判断'}</b>{curation.projectLabel ? ` · ${curation.projectLabel}` : ''}<p className="mt-1">{curation.reason}</p></div>}{signals.length > 0 && <p className="mt-1 text-[10px] text-[#8a6a0f]">自动检查提示：需要人工复核 {signals.length} 项</p>}</div></div>
    <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="至少 20 字：说明学生面对的问题、核心机制和课程信息；不要只复制标题" className="mt-3 min-h-20" />
    <div className="mt-2 grid gap-2 md:grid-cols-3"><label className="text-[10px] text-muted">1. 资源性质<Select value={resourceType} onChange={(event) => setResourceType(event.target.value)} className="mt-1">{resourceTypes.map((item) => <option key={item} value={item}>{TOPIC_RESOURCE_TYPE_LABELS[item]}</option>)}</Select></label><label className="text-[10px] text-muted">2. 授权状态<Select value={authorizationStatus} onChange={(event) => setAuthorizationStatus(event.target.value)} className="mt-1"><option value="UNCONFIRMED">未确认，不可编译</option><option value="CONFIRMED">已确认，可以编译</option></Select></label><label className="text-[10px] text-muted">3. 流程状态<Select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1">{sourceStatuses.map((item) => <option key={item} value={item}>{TOPIC_SOURCE_STATUS_LABELS[item]}</option>)}</Select></label></div>
    <button disabled={disabled} onClick={() => onSave({ summary, resourceType, authorizationStatus, status })} className="mt-2 border border-hairline px-3 py-1 text-xs disabled:opacity-40">保存素材信息</button>
  </article>;
}

function parseList(raw: string): string[] { try { const value = JSON.parse(raw); return Array.isArray(value) ? value.map(String) : []; } catch { return []; } }
function initialCuration(raw: string): { decision: string; reason: string; projectLabel: string } | null { try { const value = JSON.parse(raw) as { initialCuration?: { decision?: unknown; reason?: unknown; projectLabel?: unknown } }; if (!value.initialCuration) return null; return { decision: String(value.initialCuration.decision ?? 'REVIEW'), reason: String(value.initialCuration.reason ?? ''), projectLabel: String(value.initialCuration.projectLabel ?? '') }; } catch { return null; } }
