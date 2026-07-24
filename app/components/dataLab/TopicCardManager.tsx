'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BOOTSTRAP_SUBJECTS } from '@/app/lib/dataLab/bootstrap/contracts';
import Dialog, { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import {
  DATA_LAB_STATUS_LABELS,
  TOPIC_ACTIVITY_MODE_LABELS,
  TOPIC_CONTEXT_MODULE_LABELS,
  TOPIC_DISCIPLINE_LABELS,
  TOPIC_METRIC_KIND_LABELS,
} from '@/app/lib/dataLab/labels';

interface BridgeForm {
  label: string;
  retainedFeature: string;
  researchQuestion: string;
  factor: string;
  phenomenon: string;
  levels: string;
  measurement: string;
  unit: string;
  metricKind: string;
  safeMin: string;
  safeMax: string;
  controlledConditions: string;
  returnToDesign: string;
}

interface CardForm {
  displayTitle: string;
  studentOpening: string;
  internalArchetype: string;
  subject: string;
  gradeBand: string;
  coreMechanism: string;
  forbiddenDirections: string;
  curriculumAnchors: string;
  sourceTitle: string;
  sourceCandidateId: string;
  activityMode: string;
  contextModule: string;
  disciplineAnchors: string[];
  authenticNeed: string;
  stakeholder: string;
  engineeringGoal: string;
  constraints: string;
  performanceCriteria: string;
  bridges: BridgeForm[];
  compilerEvidence: Record<string, unknown>;
  criticOverrideReason: string;
}

interface CardView {
  id: string;
  displayTitle: string;
  studentOpening: string;
  internalArchetype: string;
  subject: string;
  gradeBand: string;
  coreMechanism: string;
  acceptableDirectionsJson: string;
  forbiddenDirectionsJson: string;
  curriculumAnchorsJson: string;
  sourceJson: string;
  compilerEvidenceJson: string;
  schemaVersion: number;
  revision: number;
  revisionOfId: string | null;
  activityMode: string;
  contextModule: string;
  disciplineAnchorsJson: string;
  authenticNeed: string;
  stakeholder: string;
  engineeringGoal: string;
  constraintsJson: string;
  performanceCriteriaJson: string;
  inquiryBridgesJson: string;
  sourceCandidateId: string | null;
  status: string;
  rejectionReason: string;
  approvedBy: { displayName: string } | null;
  revisionOf: { id: string; displayTitle: string; revision: number; status: string } | null;
  sourceCandidate: { id: string; title: string; familyKey: string; familyOverrideKey: string; sourcePlatform: string } | null;
  _count: { cases: number; revisions: number };
}

interface TopicPreview {
  studentMessages: Array<{ phase: number; message: string }>;
  deterministicRows: { columns: string[]; rows: Array<Record<string, unknown>> };
  visibleFactsSummary: Array<{ phase: number; facts: unknown }>;
}

const activityModes = ['SCIENTIFIC_INQUIRY', 'ENGINEERING_DESIGN', 'HYBRID'];
const contextModules = ['LIFE_HEALTH', 'ENERGY_ENVIRONMENT', 'INTELLIGENT_INFORMATION', 'AEROSPACE', 'DEEP_EARTH_OCEAN'];
const disciplineAnchors = ['biology', 'chemistry', 'physics', 'earth_science', 'mathematics', 'information_technology', 'engineering'];
const metricKinds = ['COUNT', 'PERCENTAGE', 'TIME', 'DISTANCE', 'MASS', 'TEMPERATURE', 'OTHER'];

function lines(value: string) {
  return value.split('\n').map((item) => item.trim()).filter(Boolean);
}

function previewErrorStep(error: string) {
  if (/标题|开场|活动模式|情境模块|真实需求|核心机制/.test(error)) return '第 1 步：情境';
  if (/方向|研究路线|测试水平|测量方式|单位|指标类型|证据如何返回设计/.test(error)) return '第 2 步：研究路线';
  if (/锚点|约束|性能标准|安全数值范围/.test(error)) return '第 3 步：边界';
  return '请检查表单';
}

function blankBridge(index: number): BridgeForm {
  return { label: `候选方向 ${index + 1}`, retainedFeature: '', researchQuestion: '', factor: '', phenomenon: '', levels: '', measurement: '', unit: '', metricKind: 'OTHER', safeMin: '', safeMax: '', controlledConditions: '', returnToDesign: '' };
}

const empty: CardForm = {
  displayTitle: '', studentOpening: '', internalArchetype: 'manual_v2', subject: 'biology_ecology', gradeBand: '初中', coreMechanism: '',
  forbiddenDirections: '', curriculumAnchors: '', sourceTitle: '', sourceCandidateId: '', activityMode: 'SCIENTIFIC_INQUIRY', contextModule: 'LIFE_HEALTH',
  disciplineAnchors: ['biology'], authenticNeed: '', stakeholder: '', engineeringGoal: '', constraints: '', performanceCriteria: '', bridges: [blankBridge(0), blankBridge(1)], compilerEvidence: {}, criticOverrideReason: '',
};

function bridgeFromUnknown(value: unknown, index: number): BridgeForm {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return blankBridge(index);
  const raw = value as Record<string, unknown>;
  const scaffold = raw.testScaffold && typeof raw.testScaffold === 'object' && !Array.isArray(raw.testScaffold) ? raw.testScaffold as Record<string, unknown> : {};
  const range = Array.isArray(scaffold.safeValueRange) ? scaffold.safeValueRange : [];
  return {
    label: String(raw.label ?? `候选方向 ${index + 1}`), retainedFeature: String(raw.retainedFeature ?? ''), researchQuestion: String(raw.researchQuestion ?? ''),
    factor: String(raw.factor ?? ''), phenomenon: String(raw.phenomenon ?? ''), levels: listValue(scaffold.levels).join('\n'), measurement: String(scaffold.measurement ?? ''),
    unit: String(scaffold.unit ?? ''), metricKind: String(scaffold.metricKind ?? 'OTHER'), safeMin: range[0] === undefined ? '' : String(range[0]), safeMax: range[1] === undefined ? '' : String(range[1]),
    controlledConditions: listValue(scaffold.controlledConditions).join('\n'), returnToDesign: String(raw.returnToDesign ?? ''),
  };
}

export default function TopicCardManager({ cards }: { cards: CardView[] }) {
  const router = useRouter();
  const [form, setForm] = useState<CardForm>(empty);
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ideation, setIdeation] = useState({ theme: '', activityMode: '', contextModule: '', count: 1 });
  const [batchTitles, setBatchTitles] = useState('');
  const [batchMode, setBatchMode] = useState<'single' | 'batch'>('single');
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [manualOpen, setManualOpen] = useState(false);
  const [preview, setPreview] = useState<TopicPreview | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [previewPending, setPreviewPending] = useState(false);
  const [autofillPending, setAutofillPending] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmingApproval, setConfirmingApproval] = useState(false);
  const grouped = useMemo(() => cards.reduce<Record<string, CardView[]>>((result, card) => { (result[card.status] ??= []).push(card); return result; }, {}), [cards]);
  const engineering = form.activityMode === 'ENGINEERING_DESIGN' || form.activityMode === 'HYBRID';

  function updateBridge(index: number, patch: Partial<BridgeForm>) {
    setForm((current) => ({ ...current, bridges: current.bridges.map((bridge, itemIndex) => itemIndex === index ? { ...bridge, ...patch } : bridge) }));
  }

  const cardPayload = useCallback(() => {
    return {
      displayTitle: form.displayTitle, studentOpening: form.studentOpening, internalArchetype: form.internalArchetype, subject: form.subject, gradeBand: form.gradeBand,
      coreMechanism: form.coreMechanism, acceptableDirections: form.bridges.map((bridge) => bridge.researchQuestion).filter(Boolean), forbiddenDirections: lines(form.forbiddenDirections),
      curriculumAnchors: lines(form.curriculumAnchors), source: { title: form.sourceTitle, kind: editingId ? 'manual_v2_edit' : 'manual_v2' },
      schemaVersion: 2, activityMode: form.activityMode, contextModule: form.contextModule, disciplineAnchors: form.disciplineAnchors, authenticNeed: form.authenticNeed,
      stakeholder: form.stakeholder, engineeringGoal: form.engineeringGoal, constraints: lines(form.constraints), performanceCriteria: lines(form.performanceCriteria),
      inquiryBridges: form.bridges.map((bridge) => ({
        label: bridge.label, retainedFeature: bridge.retainedFeature, researchQuestion: bridge.researchQuestion, factor: bridge.factor, phenomenon: bridge.phenomenon,
        testScaffold: {
          levels: lines(bridge.levels), measurement: bridge.measurement, unit: bridge.unit, metricKind: bridge.metricKind,
          ...(bridge.safeMin !== '' && bridge.safeMax !== '' ? { safeValueRange: [Number(bridge.safeMin), Number(bridge.safeMax)] } : {}),
          controlledConditions: lines(bridge.controlledConditions),
        },
        ...(bridge.returnToDesign.trim() ? { returnToDesign: bridge.returnToDesign } : {}),
      })),
      compilerEvidence: form.compilerEvidence, criticOverrideReason: form.criticOverrideReason,
      ...(form.sourceCandidateId ? { sourceCandidateId: form.sourceCandidateId } : {}),
    };
  }, [editingId, form]);

  useEffect(() => {
    if (!manualOpen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewPending(true);
      try {
        const response = await fetch('/api/data-lab/topic-cards/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cardPayload()), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '预览失败');
        setPreviewErrors(Array.isArray(data.errors) ? data.errors : []);
        setPreview(data.preview ?? null);
      } catch (error) {
        if (!controller.signal.aborted) { setPreview(null); setPreviewErrors([error instanceof Error ? error.message : String(error)]); }
      } finally {
        if (!controller.signal.aborted) setPreviewPending(false);
      }
    }, 500);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [cardPayload, manualOpen]);

  async function save() {
    setPending(true); setMessage(null);
    try {
      const response = await fetch(editingId ? `/api/data-lab/topic-cards/${editingId}` : '/api/data-lab/topic-cards', {
        method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingId ? { action: 'UPDATE', card: cardPayload() } : cardPayload()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '保存失败');
      setForm(empty); setEditingId(null); setManualOpen(false); setPreview(null); setPreviewErrors([]); setMessageTone('success'); setMessage(editingId ? '话题卡已更新并回到待审核状态。' : '话题卡草稿已创建。'); router.refresh();
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  function edit(card: CardView) {
    const source = parseObject(card.sourceJson);
    const parsedBridges = parseArray(card.inquiryBridgesJson).map(bridgeFromUnknown);
    setEditingId(card.id);
    setManualOpen(true);
    setForm({
      displayTitle: card.displayTitle, studentOpening: card.studentOpening, internalArchetype: card.internalArchetype, subject: card.subject, gradeBand: card.gradeBand,
      coreMechanism: card.coreMechanism, forbiddenDirections: parseList(card.forbiddenDirectionsJson).join('\n'), curriculumAnchors: parseList(card.curriculumAnchorsJson).join('\n'),
      sourceTitle: typeof source.title === 'string' ? source.title : '', sourceCandidateId: card.sourceCandidateId ?? '', activityMode: card.activityMode || (card.subject === 'engineering' ? 'ENGINEERING_DESIGN' : 'SCIENTIFIC_INQUIRY'),
      contextModule: card.contextModule || 'LIFE_HEALTH', disciplineAnchors: parseList(card.disciplineAnchorsJson), authenticNeed: card.authenticNeed || card.studentOpening,
      stakeholder: card.stakeholder, engineeringGoal: card.engineeringGoal, constraints: parseList(card.constraintsJson).join('\n'), performanceCriteria: parseList(card.performanceCriteriaJson).join('\n'),
      bridges: parsedBridges.length >= 2 ? parsedBridges : [...parsedBridges, ...Array.from({ length: 2 - parsedBridges.length }, (_, index) => blankBridge(parsedBridges.length + index))],
      compilerEvidence: parseObject(card.compilerEvidenceJson), criticOverrideReason: String((parseObject(card.compilerEvidenceJson).adminOverride as { reason?: unknown } | undefined)?.reason ?? ''),
    });
    scrollToEditor();
  }

  function scrollToEditor() {
    requestAnimationFrame(() => document.getElementById('topic-card-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function createRevision(cardId: string) {
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/topic-cards/${cardId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'CREATE_REVISION' }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '创建修订失败');
      setMessageTone('success'); setMessage(`已创建第 ${data.card.revision} 版修订草稿。`); router.refresh();
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  function mergeSelected() {
    const picked = cards.filter((card) => selected.includes(card.id));
    if (picked.length < 2) return;
    const first = picked[0];
    const bridges = picked.flatMap((card) => parseArray(card.inquiryBridgesJson).map(bridgeFromUnknown));
    setEditingId(null);
    setManualOpen(true);
    setForm({
      ...empty, displayTitle: first.displayTitle, studentOpening: picked.map((card) => card.studentOpening).join(' / '), internalArchetype: 'manual_v2_merge', subject: first.subject,
      gradeBand: first.gradeBand, coreMechanism: [...new Set(picked.map((card) => card.coreMechanism))].join('；'), forbiddenDirections: [...new Set(picked.flatMap((card) => parseList(card.forbiddenDirectionsJson)))].join('\n'),
      curriculumAnchors: [...new Set(picked.flatMap((card) => parseList(card.curriculumAnchorsJson)))].join('\n'), sourceTitle: `合并自 ${picked.length} 张候选卡`,
      activityMode: first.activityMode || 'SCIENTIFIC_INQUIRY', contextModule: first.contextModule || 'LIFE_HEALTH', disciplineAnchors: [...new Set(picked.flatMap((card) => parseList(card.disciplineAnchorsJson)))],
      authenticNeed: picked.map((card) => card.authenticNeed || card.studentOpening).join('；'), stakeholder: first.stakeholder, engineeringGoal: first.engineeringGoal,
      constraints: [...new Set(picked.flatMap((card) => parseList(card.constraintsJson)))].join('\n'), performanceCriteria: [...new Set(picked.flatMap((card) => parseList(card.performanceCriteriaJson)))].join('\n'),
      bridges: bridges.length >= 2 ? bridges : [blankBridge(0), blankBridge(1)], compilerEvidence: { mergedFrom: picked.map((card) => card.id) }, criticOverrideReason: '',
    });
    setSelected([]); scrollToEditor();
  }

  async function approveSelected() {
    setConfirmingApproval(false);
    setPending(true); setMessage(null);
    let successful = 0;
    let failed = 0;
    const reasons: string[] = [];
    try {
      for (const id of [...selected]) {
        const response = await fetch(`/api/data-lab/topic-cards/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'APPROVE' }) });
        const data = await response.json();
        if (response.ok) successful += 1;
        else { failed += 1; reasons.push(data.error ?? '自动校验未通过'); }
      }
      setSelected([]); setMessageTone(failed ? 'error' : 'success'); setMessage(`批量批准完成：成功 ${successful} 张，失败 ${failed} 张${reasons.length ? `。${[...new Set(reasons)].join('；')}` : ''}`); router.refresh();
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  async function decide(id: string, action: 'APPROVE' | 'REJECT', reason = '') {
    if (action === 'REJECT' && !reason.trim()) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/topic-cards/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '操作失败');
      setRejectingId(null); setRejectReason(''); setMessageTone('success'); setMessage(action === 'APPROVE' ? '话题卡已批准，可用于案例批次。' : '话题卡已拒绝并记录理由。'); router.refresh();
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  async function deleteCard(id: string) {
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/topic-cards/${id}`, { method: 'DELETE' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '删除失败');
      setMessageTone('success'); setMessage('话题卡已删除。'); router.refresh();
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  async function deleteSelected() {
    setPending(true); setMessage(null);
    let successful = 0;
    let failed = 0;
    const reasons: string[] = [];
    try {
      for (const id of [...selected]) {
        const response = await fetch(`/api/data-lab/topic-cards/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (response.ok) successful += 1;
        else { failed += 1; reasons.push(data.error ?? '删除失败'); }
      }
      setSelected([]); setMessageTone(failed ? 'error' : 'success'); setMessage(`批量删除完成：成功 ${successful} 张，失败 ${failed} 张${reasons.length ? `。${[...new Set(reasons)].join('；')}` : ''}`); router.refresh();
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  async function autofillCard() {
    setAutofillPending(true); setMessage(null);
    try {
      const response = await fetch('/api/data-lab/topic-cards/autofill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cardPayload()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'AI 填充失败');
      const filled = data.filled;
      // 只填充空白字段
      setForm((current) => ({
        displayTitle: current.displayTitle.trim() || filled.displayTitle,
        studentOpening: current.studentOpening.trim() || filled.studentOpening,
        internalArchetype: current.internalArchetype || filled.internalArchetype,
        subject: current.subject || filled.subject,
        gradeBand: current.gradeBand || filled.gradeBand,
        coreMechanism: current.coreMechanism.trim() || filled.coreMechanism,
        forbiddenDirections: current.forbiddenDirections.trim() || (filled.forbiddenDirections ?? []).join('\n'),
        curriculumAnchors: current.curriculumAnchors.trim() || (filled.curriculumAnchors ?? []).join('\n'),
        sourceTitle: current.sourceTitle,
        sourceCandidateId: current.sourceCandidateId,
        activityMode: current.activityMode || filled.activityMode || 'SCIENTIFIC_INQUIRY',
        contextModule: current.contextModule || filled.contextModule || 'LIFE_HEALTH',
        disciplineAnchors: current.disciplineAnchors.length ? current.disciplineAnchors : filled.disciplineAnchors,
        authenticNeed: current.authenticNeed.trim() || filled.authenticNeed,
        stakeholder: current.stakeholder.trim() || filled.stakeholder,
        engineeringGoal: current.engineeringGoal.trim() || filled.engineeringGoal,
        constraints: current.constraints.trim() || (filled.constraints ?? []).join('\n'),
        performanceCriteria: current.performanceCriteria.trim() || (filled.performanceCriteria ?? []).join('\n'),
        bridges: (Array.isArray(filled.inquiryBridges) ? filled.inquiryBridges : []).map((bridge: unknown, index: number) => {
          const existing = current.bridges[index];
          if (existing && existing.factor.trim() && existing.phenomenon.trim()) return existing;
          return bridgeFromUnknown(bridge, index);
        }),
        compilerEvidence: current.compilerEvidence,
        criticOverrideReason: current.criticOverrideReason,
      }));
      setMessageTone('success'); setMessage('AI 已自动填充缺失字段，请检查并修改后保存。');
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setAutofillPending(false); }
  }

  async function generateWithDefaultModel() {
    setPending(true); setMessage(null);
    try {
      const response = await fetch('/api/data-lab/topic-cards/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: ideation.theme.trim() || undefined,
          activityMode: ideation.activityMode || undefined,
          contextModule: ideation.contextModule || undefined,
          count: ideation.count,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '生成失败');
      const failures = Array.isArray(data.failures) ? data.failures as Array<{ kind?: string; reason?: string }> : [];
      setMessageTone(data.failed ? 'error' : 'success'); setMessage(`已生成 ${data.completed} 张待审核草稿${data.failed ? `，${data.failed} 张未通过自动校验（保留为已拒绝，供参考）` : ''}${failures.length ? `。${failures.map((item) => item.reason ?? '').filter(Boolean).join('；')}` : ''}`);
      router.refresh();
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  async function generateBatchFromTitles() {
    const titles = batchTitles.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!titles.length) return;
    setPending(true); setMessage(null);
    let totalCompleted = 0;
    let totalFailed = 0;
    const allReasons: string[] = [];
    try {
      for (const title of titles) {
        const response = await fetch('/api/data-lab/topic-cards/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: title, activityMode: ideation.activityMode || undefined, contextModule: ideation.contextModule || undefined, count: 1 }),
        });
        const data = await response.json();
        if (!response.ok) { totalFailed += 1; allReasons.push(`"${title}"：${data.error ?? '生成失败'}`); continue; }
        totalCompleted += data.completed ?? 0;
        totalFailed += data.failed ?? 0;
        if (Array.isArray(data.failures)) data.failures.forEach((f: { reason?: string }) => { if (f.reason) allReasons.push(`"${title}"：${f.reason}`); });
      }
      setMessageTone(totalFailed && !totalCompleted ? 'error' : 'success');
      setMessage(`批量生成完成：${totalCompleted} 张草稿已创建${totalFailed ? `，${totalFailed} 张失败` : ''}${allReasons.length ? `。\n${allReasons.join('\n')}` : ''}`);
      setBatchTitles('');
      router.refresh();
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  const cardSections = <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-2 border bg-white p-3 text-sm"><span>已选 {selected.length} 张</span><button disabled={pending || selected.length === 0} onClick={() => setConfirmingApproval(true)} className="bg-green-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">批量批准</button><button disabled={pending || selected.length === 0} onClick={deleteSelected} className="border border-red-500 px-3 py-1.5 text-xs text-red-700 disabled:opacity-40">删除选中</button><button disabled={selected.length < 2} onClick={mergeSelected} className="border px-3 py-1.5 text-xs disabled:opacity-40">合并为新版草稿</button></div>
    {['DRAFT', 'APPROVED', 'SUPERSEDED', 'REJECTED'].map((status) => <section key={status} className="space-y-3"><h2 className="font-semibold">{DATA_LAB_STATUS_LABELS[status]}（{grouped[status]?.length ?? 0}）</h2>{(grouped[status] ?? []).map((card) => <article key={card.id} className="border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-2"><input type="checkbox" checked={selected.includes(card.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, card.id] : selected.filter((id) => id !== card.id))} className="mt-1" /><div><div className="text-xs text-gray-500">{card.schemaVersion === 2 ? '新版话题结构' : '历史话题结构'} · 第 {card.revision} 版 · {TOPIC_DISCIPLINE_LABELS[card.subject] ?? '其他学科'} · {TOPIC_ACTIVITY_MODE_LABELS[card.activityMode] ?? '旧版活动'} · {TOPIC_CONTEXT_MODULE_LABELS[card.contextModule] ?? '情境未分类'} · 已生成 {card._count.cases} 个案例</div><h3 className="mt-1 font-semibold">{card.displayTitle}</h3><p className="mt-2 text-sm text-gray-700">学生开场：{card.studentOpening}</p>{card.revisionOf && <div className="mt-2 inline-block rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs text-violet-900">📝 修订自：{card.revisionOf.displayTitle} 第 {card.revisionOf.revision} 版</div>}{card.sourceCandidate && <p className="mt-1 text-xs text-blue-700">来源素材：{card.sourceCandidate.title}</p>}</div></div><span className="bg-gray-100 px-2 py-1 text-xs">{DATA_LAB_STATUS_LABELS[card.status] ?? '状态待确认'}</span></div>
      <div className="mt-3 grid gap-3 text-xs text-gray-600 md:grid-cols-3"><div><b>核心机制</b><p>{card.coreMechanism}</p>{card.schemaVersion === 2 && <><b className="mt-2 block">真实需求</b><p>{card.authenticNeed}</p></>}</div><div><b>研究路线（仅审核）</b><pre className="whitespace-pre-wrap">{parseList(card.acceptableDirectionsJson).join('\n')}</pre></div><div><b>禁止方向（仅审核）</b><pre className="whitespace-pre-wrap">{parseList(card.forbiddenDirectionsJson).join('\n') || '无'}</pre></div></div>
      {status === 'DRAFT' && criticIssues(parseObject(card.compilerEvidenceJson)).length > 0 && <div className="mt-3 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>需要人工确认才能批准：</b>{criticIssues(parseObject(card.compilerEvidenceJson)).map((issue) => String(issue.message ?? '需要人工核对')).join('；')}<p className="mt-1 text-gray-600">操作方法：点「修改」→ 到底部「模型复核问题」→ 填写处理说明 → 保存 → 再批准。</p></div>}
      {status === 'DRAFT' && card.schemaVersion === 2 && hasEmptyBridges(card.inquiryBridgesJson) && <div className="mt-3 border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900"><b>研究路线不完整，需要补全后才能批准。</b><p className="mt-1">这张卡从旧版迁移而来，研究路线只有方向名，缺少具体实验设计（自变量、因变量、测试档位、测量方式等）。</p><p className="mt-1 text-gray-600">操作方法：点「修改」→ 第 2 步「研究路线」→ 逐条补全 → 保存 → 再批准。</p></div>}
      {card.rejectionReason && <p className="mt-3 text-sm text-red-700">拒绝原因：{card.rejectionReason}</p>}
      <div className="mt-3 flex flex-wrap gap-2">{status === 'DRAFT' && <><button disabled={pending} onClick={() => edit(card)} className="border px-3 py-1.5 text-xs">修改</button><button disabled={pending} onClick={() => decide(card.id, 'APPROVE')} className="bg-green-700 px-3 py-1.5 text-xs text-white">批准</button><button disabled={pending} onClick={() => { setRejectingId(card.id); setRejectReason(''); }} className="border border-red-500 px-3 py-1.5 text-xs text-red-700">拒绝</button><button disabled={pending} onClick={() => deleteCard(card.id)} className="border px-3 py-1.5 text-xs text-gray-600">删除</button></>}{status === 'REJECTED' && <button disabled={pending} onClick={() => deleteCard(card.id)} className="border px-3 py-1.5 text-xs text-gray-600">删除</button>}{status === 'APPROVED' && <button disabled={pending} onClick={() => createRevision(card.id)} className="border border-violet-600 px-3 py-1.5 text-xs text-violet-700">创建新版修订</button>}</div>
    </article>)}{(grouped[status]?.length ?? 0) === 0 && <p className="border bg-white p-4 text-sm text-gray-500">当前没有{DATA_LAB_STATUS_LABELS[status]}话题卡。</p>}</section>)}
  </div>;

  return <div className="space-y-6">
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5">
      <h2 className="font-semibold">创建话题卡</h2>
      <p className="mt-1 text-xs text-gray-600">用平台模型原创完整话题卡（含研究路线与安全边界），自动避开已有话题。生成结果进入下方待审核列表，修改后再批准；未批准的卡不会用于案例生成。</p>
      <div className="mt-3 flex gap-2 text-sm">
        <button type="button" onClick={() => setBatchMode('single')} className={`rounded-full px-3 py-1 ${batchMode === 'single' ? 'bg-emerald-700 text-white' : 'border text-gray-700'}`}>单张生成</button>
        <button type="button" onClick={() => setBatchMode('batch')} className={`rounded-full px-3 py-1 ${batchMode === 'batch' ? 'bg-emerald-700 text-white' : 'border text-gray-700'}`}>批量导入标题</button>
      </div>
      {batchMode === 'single' ? <>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-sm md:col-span-2"><span className="mb-1 block text-xs text-gray-600">主题方向（可选，留空则由模型自选新方向）</span><input value={ideation.theme} onChange={(e) => setIdeation({ ...ideation, theme: e.target.value })} placeholder="如：校园噪音、阳台种菜、桥梁承重" className="w-full border bg-white px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-xs text-gray-600">活动类型（可选）</span><select value={ideation.activityMode} onChange={(e) => setIdeation({ ...ideation, activityMode: e.target.value })} className="w-full border bg-white px-3 py-2"><option value="">不限</option><option value="SCIENTIFIC_INQUIRY">科学探究</option><option value="ENGINEERING_DESIGN">工程设计</option><option value="HYBRID">混合</option></select></label>
          <label className="text-sm"><span className="mb-1 block text-xs text-gray-600">情境领域（可选）</span><select value={ideation.contextModule} onChange={(e) => setIdeation({ ...ideation, contextModule: e.target.value })} className="w-full border bg-white px-3 py-2"><option value="">不限</option><option value="LIFE_HEALTH">生命健康</option><option value="ENERGY_ENVIRONMENT">能源环境</option><option value="INTELLIGENT_INFORMATION">智能信息</option><option value="AEROSPACE">航空航天</option><option value="DEEP_EARTH_OCEAN">深地深海</option></select></label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <label className="text-sm"><span className="mr-2 text-xs text-gray-600">生成数量</span><select value={ideation.count} onChange={(e) => setIdeation({ ...ideation, count: Number(e.target.value) })} className="border bg-white px-2 py-1.5">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <button disabled={pending} onClick={generateWithDefaultModel} className="bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-40">{pending ? '生成中…（每张约需半分钟）' : '一键生成'}</button>
        </div>
      </> : <>
        <div className="mt-4">
          <label className="text-sm"><span className="mb-1 block text-xs text-gray-600">每行一个话题标题或关键词，模型会为每行分别生成一张完整话题卡</span><textarea value={batchTitles} onChange={(e) => setBatchTitles(e.target.value)} placeholder={'教室隔热窗帘\n校园噪音测量\n阳台种菜浇水频率\n桥梁承重结构'} className="min-h-32 w-full border bg-white p-3 text-sm" /></label>
          <p className="mt-1 text-xs text-gray-500">{batchTitles.split('\n').filter((l) => l.trim()).length} 个标题待生成</p>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <label className="text-sm"><span className="mr-2 text-xs text-gray-600">活动类型</span><select value={ideation.activityMode} onChange={(e) => setIdeation({ ...ideation, activityMode: e.target.value })} className="border bg-white px-2 py-1.5 text-sm"><option value="">不限</option><option value="SCIENTIFIC_INQUIRY">科学探究</option><option value="ENGINEERING_DESIGN">工程设计</option><option value="HYBRID">混合</option></select></label>
          <button disabled={pending || !batchTitles.trim()} onClick={generateBatchFromTitles} className="bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-40">{pending ? '批量生成中…' : `批量生成 ${batchTitles.split('\n').filter((l) => l.trim()).length} 张话题卡`}</button>
        </div>
      </>}
    </section>
    {message && <p aria-live="polite" className={`border p-3 text-sm ${messageTone === 'success' ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>{message}</p>}

    <section><div className="mb-3"><h2 className="font-semibold">待审核与已启用话题卡</h2><p className="mt-1 text-sm text-gray-500">常规工作是审核模型产出的草稿；只在素材无法编译时使用手工建卡。</p></div>{cardSections}</section>

    <details id="topic-card-editor" open={manualOpen} onToggle={(event) => setManualOpen(event.currentTarget.open)} className="scroll-mt-4 border bg-white p-5"><summary className="cursor-pointer font-semibold">{editingId ? '编辑话题卡' : '高级：手工创建话题卡'}</summary><div className="mt-5 space-y-6">
      {editingId && <div className="flex items-center gap-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm"><span className="text-blue-900">修改现有卡片时，可使用 AI 自动填充缺失字段（如研究路线），然后手工微调。</span><button disabled={autofillPending || pending} onClick={autofillCard} className="rounded bg-blue-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">{autofillPending ? '🤖 AI 填充中…' : '🤖 AI 自动填充'}</button></div>}
      <nav className="grid gap-2 text-sm sm:grid-cols-4"><a href="#topic-context" className="border-b-2 border-gray-900 pb-2">1. 情境</a><a href="#topic-routes" className="border-b-2 border-gray-300 pb-2">2. 研究路线</a><a href="#topic-boundaries" className="border-b-2 border-gray-300 pb-2">3. 边界</a><a href="#topic-preview" className="border-b-2 border-gray-300 pb-2">4. 预览</a></nav>

      <section id="topic-context" className="scroll-mt-20"><h3 className="font-semibold">1. 情境</h3><p className="mt-1 text-xs text-gray-500">定义学生真实面对的问题。保存后会成为案例标题、开场和情境背景。</p><div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label="学生可见标题"><input value={form.displayTitle} onChange={(event) => setForm({ ...form, displayTitle: event.target.value })} placeholder="如：教室西晒时怎样让遮光装置判断得更准" className="w-full border px-3 py-2" /></Field>
        <Field label="活动模式"><select value={form.activityMode} onChange={(event) => setForm({ ...form, activityMode: event.target.value })} className="w-full border px-3 py-2">{activityModes.map((item) => <option key={item} value={item}>{TOPIC_ACTIVITY_MODE_LABELS[item]}</option>)}</select></Field>
        <Field label="学生开场白" wide><textarea value={form.studentOpening} onChange={(event) => setForm({ ...form, studentOpening: event.target.value })} placeholder="用学生会说的话描述困惑或需求" className="min-h-20 w-full border p-3" /></Field>
        <Field label="真实需求" wide><textarea value={form.authenticNeed} onChange={(event) => setForm({ ...form, authenticNeed: event.target.value })} placeholder="说明为什么这个问题值得学生在真实情境中解决" className="min-h-20 w-full border p-3" /></Field>
        <Field label="核心机制" wide><textarea value={form.coreMechanism} onChange={(event) => setForm({ ...form, coreMechanism: event.target.value })} placeholder="如：环境光读数与触发阈值共同决定遮光响应" className="min-h-20 w-full border p-3" /></Field>
        <Field label="情境模块"><select value={form.contextModule} onChange={(event) => setForm({ ...form, contextModule: event.target.value })} className="w-full border px-3 py-2">{contextModules.map((item) => <option key={item} value={item}>{TOPIC_CONTEXT_MODULE_LABELS[item]}</option>)}</select></Field>
        <Field label="服务对象"><input value={form.stakeholder} onChange={(event) => setForm({ ...form, stakeholder: event.target.value })} placeholder="如：教室师生" className="w-full border px-3 py-2" /></Field>
        {engineering && <Field label="工程目标" wide><textarea value={form.engineeringGoal} onChange={(event) => setForm({ ...form, engineeringGoal: event.target.value })} placeholder="如：制作稳定触发的低压遮光模型" className="min-h-16 w-full border p-3" /></Field>}
      </div></section>

      <section id="topic-routes" className="scroll-mt-20 border-t pt-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">2. 研究路线</h3><p className="mt-1 text-xs text-gray-500">至少两条，让学生有不同可行路径，避免只有唯一答案。测试档位会直接成为学生数据表的列。</p></div><button type="button" onClick={() => setForm({ ...form, bridges: [...form.bridges, blankBridge(form.bridges.length)] })} className="border px-3 py-1.5 text-xs">添加研究路线</button></div><div className="mt-4 space-y-4">{form.bridges.map((bridge, index) => <div key={index} className="border bg-gray-50 p-4"><div className="flex justify-between"><b className="text-sm">研究路线 {index + 1}</b>{form.bridges.length > 2 && <button type="button" onClick={() => setForm({ ...form, bridges: form.bridges.filter((_, itemIndex) => itemIndex !== index) })} className="text-xs text-red-700">删除</button>}</div><div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label="路线名称"><input value={bridge.label} onChange={(event) => updateBridge(index, { label: event.target.value })} placeholder="如：触发阈值" className="w-full border px-2 py-1.5" /></Field><Field label="保留的真实机制"><input value={bridge.retainedFeature} onChange={(event) => updateBridge(index, { retainedFeature: event.target.value })} placeholder="如：自动判断并触发遮光" className="w-full border px-2 py-1.5" /></Field>
        <Field label="具体研究问题" wide><textarea value={bridge.researchQuestion} onChange={(event) => updateBridge(index, { researchQuestion: event.target.value })} placeholder="如：光照触发阈值是否影响装置的正确响应率？" className="min-h-16 w-full border p-2" /></Field><Field label="要改变的条件（自变量）"><input value={bridge.factor} onChange={(event) => updateBridge(index, { factor: event.target.value })} placeholder="如：豆芽每天的光照时长" className="w-full border px-2 py-1.5" /></Field><Field label="要观察的结果（因变量）"><input value={bridge.phenomenon} onChange={(event) => updateBridge(index, { phenomenon: event.target.value })} placeholder="如：芽的平均长度" className="w-full border px-2 py-1.5" /></Field>
        <Field label="测试档位（每行一个，将成为数据表列）"><textarea value={bridge.levels} onChange={(event) => updateBridge(index, { levels: event.target.value })} placeholder={'0 小时\n4 小时\n8 小时'} className="min-h-20 w-full border p-2" /></Field><Field label="保持一致的条件（每行一个）"><textarea value={bridge.controlledConditions} onChange={(event) => updateBridge(index, { controlledConditions: event.target.value })} placeholder={'同一批种子\n相同浇水量'} className="min-h-20 w-full border p-2" /></Field>
        <Field label="测量方式"><input value={bridge.measurement} onChange={(event) => updateBridge(index, { measurement: event.target.value })} placeholder="如：用直尺测量每株芽的长度并求平均" className="w-full border px-2 py-1.5" /></Field><Field label="测量单位"><input value={bridge.unit} onChange={(event) => updateBridge(index, { unit: event.target.value })} placeholder="如：毫米" className="w-full border px-2 py-1.5" /></Field>
        <Field label="指标类型"><select value={bridge.metricKind} onChange={(event) => updateBridge(index, { metricKind: event.target.value })} className="w-full border px-2 py-1.5">{metricKinds.map((item) => <option key={item} value={item}>{TOPIC_METRIC_KIND_LABELS[item]}</option>)}</select></Field>
        {engineering && <Field label="证据如何返回下一版设计" wide><textarea value={bridge.returnToDesign} onChange={(event) => updateBridge(index, { returnToDesign: event.target.value })} placeholder="如：依据正确响应率和误触发记录选择下一版阈值" className="min-h-16 w-full border p-2" /></Field>}
      </div></div>)}</div></section>

      <section id="topic-boundaries" className="scroll-mt-20 border-t pt-5"><h3 className="font-semibold">3. 边界</h3><p className="mt-1 text-xs text-gray-500">限定安全范围、课程依据和工程约束，防止案例偏题或不可执行。</p><div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label="禁止方向（每行一个）"><textarea value={form.forbiddenDirections} onChange={(event) => setForm({ ...form, forbiddenDirections: event.target.value })} placeholder="如：不得使用市电或危险切割工具" className="min-h-24 w-full border p-3" /></Field><Field label="课程锚点（每行一个）"><textarea value={form.curriculumAnchors} onChange={(event) => setForm({ ...form, curriculumAnchors: event.target.value })} placeholder={'控制变量\n结构稳定性'} className="min-h-24 w-full border p-3" /></Field>
        {engineering && <><Field label="工程约束（每行一个）"><textarea value={form.constraints} onChange={(event) => setForm({ ...form, constraints: event.target.value })} className="min-h-24 w-full border p-3" /></Field><Field label="性能标准（每行一个）"><textarea value={form.performanceCriteria} onChange={(event) => setForm({ ...form, performanceCriteria: event.target.value })} className="min-h-24 w-full border p-3" /></Field></>}
        <fieldset className="md:col-span-2"><legend className="text-xs text-gray-600">学科锚点</legend><div className="mt-2 flex flex-wrap gap-3">{disciplineAnchors.map((anchor) => <label key={anchor} className="text-xs"><input type="checkbox" checked={form.disciplineAnchors.includes(anchor)} onChange={(event) => setForm({ ...form, disciplineAnchors: event.target.checked ? [...form.disciplineAnchors, anchor] : form.disciplineAnchors.filter((item) => item !== anchor) })} className="mr-1" />{TOPIC_DISCIPLINE_LABELS[anchor]}</label>)}</div></fieldset>
        <div className="md:col-span-2 grid gap-3 md:grid-cols-2">{form.bridges.map((bridge, index) => <Field key={index} label={`研究路线 ${index + 1} 的安全数值范围（可选）`}><div className="flex gap-2"><input type="number" value={bridge.safeMin} onChange={(event) => updateBridge(index, { safeMin: event.target.value })} className="w-1/2 border px-2 py-1.5" placeholder="最小值" /><input type="number" value={bridge.safeMax} onChange={(event) => updateBridge(index, { safeMax: event.target.value })} className="w-1/2 border px-2 py-1.5" placeholder="最大值" /></div></Field>)}</div>
      </div><details className="mt-4 border bg-gray-50 p-3"><summary className="cursor-pointer text-sm font-medium">高级兼容字段</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="原始资源标题"><input value={form.sourceTitle} onChange={(event) => setForm({ ...form, sourceTitle: event.target.value })} className="w-full border px-3 py-2" /></Field><Field label="学段"><input value={form.gradeBand} onChange={(event) => setForm({ ...form, gradeBand: event.target.value })} className="w-full border px-3 py-2" /></Field><Field label="旧版学科分类（兼容）"><select value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} className="w-full border px-3 py-2">{BOOTSTRAP_SUBJECTS.map((subject) => <option key={subject} value={subject}>{TOPIC_DISCIPLINE_LABELS[subject]}</option>)}</select></Field><Field label="内部自动分类"><input value={form.internalArchetype} onChange={(event) => setForm({ ...form, internalArchetype: event.target.value })} className="w-full border px-3 py-2" /></Field></div></details></section>

      <section id="topic-preview" className="scroll-mt-20 border-t pt-5"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">4. 预览</h3><p className="mt-1 text-xs text-gray-500">输入停顿后自动刷新，不会保存数据。</p></div>{previewPending && <span className="text-xs text-blue-700">正在生成预览…</span>}</div>
        {previewErrors.length > 0 && <div className="mt-3 border border-red-200 bg-red-50 p-3 text-sm text-red-900"><b>还不能生成完整预览：</b><ul className="mt-2 list-disc space-y-1 pl-5">{previewErrors.map((error) => <li key={error}><span className="font-medium">{previewErrorStep(error)}：</span>{error}</li>)}</ul></div>}
        {preview && <div className="mt-4 space-y-4"><div><h4 className="text-sm font-medium">学生会这样开场</h4><div className="mt-2 grid gap-2 md:grid-cols-3">{preview.studentMessages.map((sample) => <div key={sample.phase} className="border bg-gray-50 p-3 text-sm"><b>阶段 {sample.phase}</b><p className="mt-2 leading-6">{sample.message}</p></div>)}</div></div><div><h4 className="text-sm font-medium">数据表长这样</h4><div className="mt-2 overflow-x-auto border"><table className="min-w-full text-left text-xs"><thead className="bg-gray-100"><tr>{preview.deterministicRows.columns.map((column) => <th key={column} className="whitespace-nowrap p-2">{column}</th>)}</tr></thead><tbody>{preview.deterministicRows.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t">{preview.deterministicRows.columns.map((column) => <td key={column} className="whitespace-nowrap p-2">{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div></div><details className="border p-3 text-xs"><summary className="cursor-pointer font-medium">导师可见的学生事实摘要</summary><div className="mt-3 grid gap-2 md:grid-cols-3">{preview.visibleFactsSummary.map((item) => <div key={item.phase} className="bg-gray-50 p-2"><b>阶段 {item.phase}</b><pre className="mt-1 whitespace-pre-wrap font-sans leading-5">{JSON.stringify(item.facts, null, 2)}</pre></div>)}</div></details></div>}
      </section>

      {criticIssues(form.compilerEvidence).length > 0 && <div className="border border-amber-300 bg-amber-50 p-4"><h3 className="text-sm font-medium">模型复核问题</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">{criticIssues(form.compilerEvidence).map((issue, index) => <li key={index}>{String(issue.message ?? '需要人工核对')}</li>)}</ul><label className="mt-3 block text-xs">人工覆盖说明（高置信度阻断项必须填写）<textarea value={form.criticOverrideReason} onChange={(event) => setForm({ ...form, criticOverrideReason: event.target.value })} className="mt-1 min-h-16 w-full border p-2" placeholder="说明已作何修订，或为什么该提醒不成立" /></label></div>}
      <div><button onClick={save} disabled={pending || previewPending || !preview || previewErrors.length > 0} className="bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">{editingId ? '保存修改' : '创建草稿'}</button>{editingId && <button onClick={() => { setEditingId(null); setForm(empty); setManualOpen(false); }} className="ml-2 border px-4 py-2 text-sm">取消修改</button>}</div>
    </div></details>

    <ConfirmDialog open={confirmingApproval} title="批量批准话题卡" description={`将逐张校验并批准所选 ${selected.length} 张话题卡。`} consequence="批准后这些话题卡会立即进入案例批次的可选范围；未通过校验的卡会保留为草稿并在结果中计数。" confirmLabel="确认批量批准" pending={pending} onClose={() => setConfirmingApproval(false)} onConfirm={approveSelected} />
    <Dialog open={Boolean(rejectingId)} title="拒绝话题卡" description="填写具体原因，便于后续修订或重新编译。" onClose={() => { if (!pending) setRejectingId(null); }} footer={<><button type="button" disabled={pending} onClick={() => setRejectingId(null)} className="border px-4 py-2 text-sm">取消</button><button type="button" disabled={pending || !rejectReason.trim()} onClick={() => rejectingId && decide(rejectingId, 'REJECT', rejectReason)} className="bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-40">确认拒绝</button></>}><label className="block text-sm font-medium">拒绝理由<textarea autoFocus value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="例如：情境缺少真实需求，研究路线无法形成可测数据" className="mt-2 min-h-28 w-full border p-3 font-normal" /></label></Dialog>
  </div>;
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`text-sm ${wide ? 'md:col-span-2' : ''}`}><span className="mb-1 block text-xs text-gray-600">{label}</span>{children}</label>;
}

function parseObject(raw: string): Record<string, unknown> { try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function parseArray(raw: string): unknown[] { try { const value = JSON.parse(raw); return Array.isArray(value) ? value : []; } catch { return []; } }
function parseList(raw: string): string[] { return listValue(parseArray(raw)); }
function listValue(value: unknown): string[] { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }
function criticIssues(evidence: Record<string, unknown>): Array<Record<string, unknown>> { const critique = evidence.critique; if (!critique || typeof critique !== 'object' || Array.isArray(critique)) return []; const issues = (critique as Record<string, unknown>).issues; return Array.isArray(issues) ? issues.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []; }
function hasEmptyBridges(raw: string): boolean { const bridges = parseArray(raw); if (!bridges.length) return false; return bridges.some((b) => { if (!b || typeof b !== 'object' || Array.isArray(b)) return true; const br = b as Record<string, unknown>; return !br.factor || !br.phenomenon; }); }
