'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TutorLanguageEditor from '@/app/components/dataLab/TutorLanguageEditor';
import {
  REVIEW_DECISION_LABELS,
  REVIEW_POLICY_LABELS,
  SUBMISSION_MODE_LABELS,
  TRIGGER_TYPE_LABELS,
  TUTOR_CASE_ISSUE_LABELS,
  TUTOR_SPLIT_LABELS,
  dataLabStatusLabel,
  warningCodeLabel,
} from '@/app/lib/dataLab/labels';
import {
  TUTOR_WARNING_CORRECTED_CATEGORIES,
  TUTOR_WARNING_CORRECTED_CATEGORY_LABELS,
  TUTOR_WARNING_DETECTOR_VERDICTS,
  TUTOR_WARNING_DETECTOR_VERDICT_LABELS,
  TUTOR_WARNING_FINAL_RELATION_LABELS,
  TUTOR_WARNING_SEVERITIES,
  TUTOR_WARNING_SEVERITY_LABELS,
  type TutorWarningCorrectedCategory,
  type TutorWarningDetectorVerdict,
  type TutorWarningFinalRelation,
  type TutorWarningSeverity,
} from '@/app/lib/dataLab/bootstrap/warningClosure';

type ReviewType = 'EDIT' | 'CONFIRM';
type ConfirmDecision = 'CONFIRM' | 'RETURN_TUTOR' | 'RETURN_CASE' | 'REJECT';
type SubmissionMode = 'HUMAN' | 'AI_ASSISTED_HUMAN_SUBMIT' | 'AI_DIRECT_ADMIN_AUTHORIZED';

type CaseIssueCategory = keyof typeof TUTOR_CASE_ISSUE_LABELS;

interface CandidateView {
  id: string;
  slot: string;
  provider?: string;
  modelFamily?: string;
  externalModelId?: string;
  normalizedOutput: string;
  deterministicCheck: unknown;
  critique: unknown;
}

interface WarningView {
  id: string;
  code: string;
  severity: 'error' | 'warning';
  message: string;
  evidence?: string;
  candidateId: string;
  candidateSlot: string;
  source: 'DETERMINISTIC' | 'CRITIC';
  computedFinalRelation?: TutorWarningFinalRelation;
}

interface ReviewPayload {
  task: { id: string; leaseExpiresAt: string };
  case: {
    id: string;
    phase: number;
    triggerType: string;
    studentMessage: string;
    history: unknown;
    visibleFacts: { allowedFocusIds?: string[]; focusDescriptions?: Record<string, string> } & Record<string, unknown>;
    privateReviewSpec?: unknown;
    split: string;
    revision: number;
    revisionOfId?: string | null;
    reviewPolicy: 'HUMAN_ANNOTATOR_REQUIRED' | 'AI_DIRECT_TO_REVIEWER';
  };
  candidates: CandidateView[];
  firstReview?: {
    draft: { finalOutput?: unknown };
    decision: string;
    selectedCandidateId?: string | null;
    reason: string;
    submissionMode: SubmissionMode;
    warningIds: string[];
    returnReason?: string;
    reviewerProposedOutput?: unknown;
  };
  warnings: WarningView[];
}

interface WarningClosureDraft {
  detectorVerdict: TutorWarningDetectorVerdict | '';
  correctedCategory: TutorWarningCorrectedCategory | '';
  finalSeverity: TutorWarningSeverity | '';
  candidateSeverity: TutorWarningSeverity | '';
  note: string;
}

const EMPTY_CLOSURE: WarningClosureDraft = { detectorVerdict: '', correctedCategory: '', finalSeverity: '', candidateSeverity: '', note: '' };

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value ?? '');
}

function parseOutput(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw)); } catch { return raw; }
}

function candidateOutput(candidate?: CandidateView): string {
  if (!candidate?.normalizedOutput) return '';
  try { return pretty(JSON.parse(candidate.normalizedOutput)); } catch { return candidate.normalizedOutput; }
}

function draftOutput(value: unknown): string {
  return value ? pretty(value) : '';
}

function readableHistory(value: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const content = typeof item.content === 'string' ? item.content : typeof item.value === 'string' ? item.value : '';
    if (!content) return [];
    return [{ role: String(item.role ?? item.from ?? 'unknown'), content }];
  });
}

function formatRemaining(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function closureComplete(relation: TutorWarningFinalRelation | undefined, closure: WarningClosureDraft | undefined) {
  if (!closure?.detectorVerdict) return false;
  if (closure.detectorVerdict === 'MISCLASSIFIED' && !closure.correctedCategory) return false;
  return relation !== 'PRESENT_IN_FINAL'
    || closure.detectorVerdict === 'FALSE_POSITIVE'
    || Boolean(closure.finalSeverity);
}

export default function TutorReviewWorkbench({ type }: { type: ReviewType }) {
  const router = useRouter();
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [decision, setDecision] = useState(type === 'EDIT' ? 'SELECT_A' : 'CONFIRM');
  const [selectedId, setSelectedId] = useState('');
  const [rejectedId, setRejectedId] = useState('');
  const [finalOutput, setFinalOutput] = useState('');
  const [reason, setReason] = useState('');
  const [preferenceReason, setPreferenceReason] = useState('');
  const [submissionMode, setSubmissionMode] = useState<SubmissionMode>('HUMAN');
  const [closures, setClosures] = useState<Record<string, WarningClosureDraft>>({});
  const [caseIssueCategories, setCaseIssueCategories] = useState<CaseIssueCategory[]>([]);
  const [suggestedStudentMessage, setSuggestedStudentMessage] = useState('');
  const [liveRelations, setLiveRelations] = useState<Record<string, TutorWarningFinalRelation>>({});
  const [finalPreviewError, setFinalPreviewError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const allowedFocusIds = payload?.case.visibleFacts.allowedFocusIds ?? [];
  const focusDescriptions = payload?.case.visibleFacts.focusDescriptions;

  async function claim() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/data-lab/tutor-reviews/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '领取失败');
      if (!data.payload) {
        setPayload(null);
        setMessage('当前没有可领取任务');
        return;
      }
      const claimed = data.payload as ReviewPayload;
      const firstCandidate = claimed.candidates[0];
      setPayload(claimed);
      setDecision(type === 'EDIT' ? claimed.firstReview?.decision || 'SELECT_A' : 'CONFIRM');
      setSelectedId(claimed.firstReview?.selectedCandidateId ?? firstCandidate?.id ?? '');
      setFinalOutput(claimed.firstReview?.draft.finalOutput ? draftOutput(claimed.firstReview.draft.finalOutput) : candidateOutput(firstCandidate));
      setClosures(Object.fromEntries(claimed.warnings.map((warning) => [warning.id, { ...EMPTY_CLOSURE }])));
      setReason('');
      setRejectedId('');
      setPreferenceReason('');
      setSubmissionMode(claimed.firstReview?.submissionMode ?? 'HUMAN');
      setCaseIssueCategories([]);
      setSuggestedStudentMessage(claimed.case.studentMessage);
      setLiveRelations(Object.fromEntries(claimed.warnings.filter((warning) => warning.computedFinalRelation).map((warning) => [warning.id, warning.computedFinalRelation!])))
      setFinalPreviewError(null);
      setNow(Date.now());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  async function renewLease() {
    if (!payload) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/data-lab/tutor-reviews/${payload.task.id}`, { method: 'PATCH' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '续租失败');
      setPayload((current) => current ? { ...current, task: { ...current.task, leaseExpiresAt: data.leaseExpiresAt } } : current);
      setNow(Date.now());
      setMessage('租约已延长 30 分钟。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (!payload) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [payload]);

  useEffect(() => {
    if (type !== 'CONFIRM' || !payload || !finalOutput.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/data-lab/tutor-reviews/${payload.task.id}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finalOutput: parseOutput(finalOutput) }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '最终稿预检失败');
        setLiveRelations(data.relations ?? {});
        setFinalPreviewError(data.finalCheck?.ok ? null : `最终稿存在硬错误：${(data.finalCheck?.issues ?? []).filter((item: { severity?: string }) => item.severity === 'error').map((item: { message?: string }) => item.message).filter(Boolean).join('；')}`);
      } catch (error) {
        if (!controller.signal.aborted) setFinalPreviewError(error instanceof Error ? error.message : String(error));
      }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [type, payload, finalOutput]);

  function choose(candidate: CandidateView) {
    setSelectedId(candidate.id);
    setFinalOutput(candidateOutput(candidate));
    setDecision(candidate.slot === 'A' ? 'SELECT_A' : 'SELECT_B');
  }

  function updateClosure(warningId: string, patch: Partial<WarningClosureDraft>) {
    setClosures((current) => ({ ...current, [warningId]: { ...(current[warningId] ?? EMPTY_CLOSURE), ...patch } }));
  }

  function toggleCaseIssue(category: CaseIssueCategory) {
    setCaseIssueCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }

  async function submit() {
    if (!payload) return;
    setPending(true);
    setMessage(null);
    try {
      const warningClosures = Object.fromEntries(Object.entries(closures).filter(([, closure]) => closure.detectorVerdict).map(([warningId, closure]) => [warningId, {
        detectorVerdict: closure.detectorVerdict,
        ...(closure.correctedCategory ? { correctedCategory: closure.correctedCategory } : {}),
        ...(closure.finalSeverity ? { finalSeverity: closure.finalSeverity } : {}),
        ...(closure.candidateSeverity ? { candidateSeverity: closure.candidateSeverity } : {}),
        ...(closure.note.trim() ? { note: closure.note.trim() } : {}),
      }]));
      const body = type === 'EDIT'
        ? {
            type,
            decision,
            selectedCandidateId: selectedId || undefined,
            finalOutput: parseOutput(finalOutput),
            reason,
            preferenceRejectedCandidateId: rejectedId || undefined,
            preferenceReason,
            submissionMode,
            ...(decision === 'RETURN_CASE' ? { caseIssue: { categories: caseIssueCategories, suggestedStudentMessage, note: reason } } : {}),
          }
        : {
            type,
            decision,
            reason,
            finalOutput: parseOutput(finalOutput),
            warningClosures,
            ...(decision === 'RETURN_CASE' ? { caseIssue: { categories: caseIssueCategories, suggestedStudentMessage, note: reason } } : {}),
          };
      const response = await fetch(`/api/data-lab/tutor-reviews/${payload.task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '提交失败');
      setMessage(`提交完成：${dataLabStatusLabel(data.status)}`);
      setPayload(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  const guide = <ol className="grid gap-2 border-y bg-white p-3 text-sm sm:grid-cols-4">
    {(type === 'EDIT'
      ? ['领取一条任务', '比较候选并形成草稿', '记录选择或修改理由', '提交给定稿人']
      : ['领取一条任务', '核对案例与导师回复', '逐条处理自动信号', '通过定稿或分类退回']
    ).map((step, index) => <li key={step} className="flex items-center gap-2"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-950 text-xs text-white">{index + 1}</span><span>{step}</span></li>)}
  </ol>;

  if (!payload) {
    return (
      <div className="space-y-4">
        {guide}
        <div className="rounded-xl border bg-white p-6">
          <h2 className="font-semibold">{type === 'EDIT' ? '导师草稿初审队列' : '正式定稿队列'}</h2>
          <p className="mt-2 text-sm text-gray-500">
            {type === 'EDIT'
              ? '领取后比较两个匿名候选，形成一份可定稿的导师回复，并写清判断依据。'
              : '领取后独立核对学生案例、导师回复和自动检测信号，再决定定稿或退回。'}
          </p>
          <button type="button" disabled={pending} onClick={claim} className="mt-4 bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">领取下一条</button>
          {message && <p className="mt-3 rounded bg-gray-50 p-3 text-sm text-gray-700">{message} 若队列为空，请稍后刷新；管理员可在概览查看上游案例是否已生成或完成前一审。</p>}
        </div>
      </div>
    );
  }

  const unresolvedWarningCount = payload.warnings.filter((warning) => !closureComplete(liveRelations[warning.id] ?? warning.computedFinalRelation, closures[warning.id])).length;
  const confirmDecision = decision as ConfirmDecision;
  const originalReviewerDraft = draftOutput(payload.firstReview?.draft.finalOutput);
  const history = readableHistory(payload.case.history);
  const leaseRemaining = new Date(payload.task.leaseExpiresAt).getTime() - now;
  const leaseExpired = leaseRemaining <= 0;
  const leaseWarning = !leaseExpired && leaseRemaining <= 5 * 60 * 1000;
  const reviewerChanged = type === 'CONFIRM' && parseOutput(finalOutput) !== parseOutput(originalReviewerDraft);
  const caseReturnBlocked = decision === 'RETURN_CASE' && caseIssueCategories.length === 0;
  const editBlockedReason = type === 'EDIT'
    ? !reason.trim()
      ? '请填写初审理由。'
      : caseReturnBlocked
        ? '请至少勾选一个案例问题类别。'
        : rejectedId && !preferenceReason.trim()
          ? '选择未采用候选后，请填写两者的比较理由。'
          : ['SELECT_A', 'SELECT_B'].includes(decision) && !selectedId
            ? '请先选择一个候选。'
            : !finalOutput.trim()
              ? '导师草稿不能为空。'
              : ''
    : '';
  const confirmationBlocked = type === 'CONFIRM' && (
    !reason.trim()
    || (confirmDecision === 'CONFIRM' && unresolvedWarningCount > 0)
    || caseReturnBlocked
    || (confirmDecision === 'CONFIRM' && Boolean(finalPreviewError))
    || leaseExpired
  );
  const submitLabel = type === 'EDIT'
    ? '提交导师初审'
    : confirmDecision === 'CONFIRM'
      ? reviewerChanged ? '修改后通过并定稿' : '通过并定稿'
      : confirmDecision === 'RETURN_TUTOR'
        ? '退回标注员修订'
        : confirmDecision === 'RETURN_CASE'
          ? '提交管理员处理案例'
          : '拒绝案例';

  const candidateSection = (
    <section className="grid gap-4 xl:grid-cols-2">
      {payload.candidates.map((candidate) => {
        const isDraftSource = payload.firstReview?.selectedCandidateId === candidate.id;
        const isSelected = type === 'EDIT' && selectedId === candidate.id;
        return (
          <article key={candidate.id} className={`rounded-xl border bg-white p-4 ${isSelected || isDraftSource ? 'border-blue-500 ring-1 ring-blue-200' : ''}`}>
            <div className="flex flex-wrap justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">候选 {candidate.slot}</h3>
                {isDraftSource && <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800">建议稿来源</span>}
              </div>
              {type === 'EDIT' && <span className="text-xs text-gray-500">{candidate.modelFamily} · {candidate.externalModelId}</span>}
            </div>
            <div className="mt-3">
              <TutorLanguageEditor raw={candidate.normalizedOutput} allowedFocusIds={allowedFocusIds} focusDescriptions={focusDescriptions} editable={false} compact title={`候选 ${candidate.slot}`} />
            </div>
            <details className="mt-3 text-xs"><summary className="cursor-pointer">确定性检查</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{pretty(candidate.deterministicCheck)}</pre></details>
            <details className="mt-2 text-xs"><summary className="cursor-pointer">交叉检查</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{pretty(candidate.critique)}</pre></details>
            {type === 'EDIT' && <button type="button" disabled={leaseExpired} onClick={() => choose(candidate)} className="mt-3 border px-3 py-1.5 text-xs disabled:opacity-40">选择 {candidate.slot} 作为草稿</button>}
          </article>
        );
      })}
    </section>
  );

  return (
    <div className="space-y-4">
      {guide}
      {payload.firstReview?.returnReason && type === 'EDIT' && <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <h2 className="font-semibold">这条导师回复被退回修改</h2>
        <p className="mt-2 whitespace-pre-wrap leading-6">{payload.firstReview.returnReason}</p>
        {Boolean(payload.firstReview.reviewerProposedOutput) && <details className="mt-3"><summary className="cursor-pointer font-medium">查看定稿人的建议稿</summary><div className="mt-2"><TutorLanguageEditor raw={draftOutput(payload.firstReview.reviewerProposedOutput)} allowedFocusIds={allowedFocusIds} focusDescriptions={focusDescriptions} editable={false} compact title="定稿人建议稿" /></div></details>}
        <p className="mt-2 text-xs">下方已恢复你上次提交的草稿，可在此基础上继续修改。</p>
      </section>}
      <section className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm ${leaseExpired ? 'border-red-300 bg-red-50 text-red-900' : leaseWarning ? 'border-amber-300 bg-amber-50 text-amber-950' : 'bg-white'}`}>
        <div><b>{leaseExpired ? '租约已过期' : `剩余处理时间 ${formatRemaining(leaseRemaining)}`}</b><p className="mt-1 text-xs">{leaseExpired ? '编辑区已锁定。返回队列并重新领取后才能继续。' : leaseWarning ? '剩余不足 5 分钟，请续租后再继续编辑。' : '租约用于避免同一任务被多人同时修改。'}</p></div>
        <button type="button" disabled={pending || leaseExpired} onClick={renewLease} className="border border-current px-3 py-1.5 text-xs disabled:opacity-40">续租 30 分钟</button>
      </section>
      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <div className="text-xs text-gray-500">阶段 {payload.case.phase} · {TUTOR_SPLIT_LABELS[payload.case.split] ?? '用途待确认'} · {TRIGGER_TYPE_LABELS[payload.case.triggerType] ?? '触发方式待确认'} · 第 {payload.case.revision} 版</div>
            <h2 className="mt-1 font-semibold">{payload.case.triggerType === 'SYSTEM_TRIGGER' ? '系统触发案例' : '学生情景'}</h2>
          </div>
          <div className="text-right text-xs text-gray-500"><div>本次占用至 {new Date(payload.task.leaseExpiresAt).toLocaleTimeString('zh-CN')}</div><div className="mt-1">初审策略：{REVIEW_POLICY_LABELS[payload.case.reviewPolicy]}</div></div>
        </div>
        <p className="mt-3 rounded bg-gray-50 p-3 text-sm leading-6">{payload.case.studentMessage || '（本案例没有学生消息）'}</p>
        {history.length > 0 && <details className="mt-3 rounded border p-3 text-sm"><summary className="cursor-pointer font-medium">查看此前对话（{history.length} 条）</summary><div className="mt-3 space-y-2">{history.map((entry, index) => <div key={`${entry.role}-${index}`} className={`rounded p-3 ${entry.role === 'assistant' || entry.role === 'gpt' ? 'bg-blue-50' : 'bg-gray-50'}`}><div className="text-xs font-medium text-gray-500">{entry.role === 'assistant' || entry.role === 'gpt' ? '导师' : entry.role === 'system' ? '平台状态' : '学生'}</div><p className="mt-1 whitespace-pre-wrap leading-6">{entry.content}</p></div>)}</div></details>}
        <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">学生可见事实</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-gray-950 p-3 text-gray-100">{pretty(payload.case.visibleFacts)}</pre></details>
        {type === 'EDIT' && <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium text-amber-800">私有审核规范（不会进入导师模型提示词）</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-amber-50 p-3">{pretty(payload.case.privateReviewSpec)}</pre></details>}
      </section>

      {type === 'EDIT' ? candidateSection : <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-medium">查看两个原始候选、交叉检查和确定性检查</summary><div className="mt-4">{candidateSection}</div></details>}

      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">{type === 'EDIT' ? '标注员建议稿' : 'AI 或标注员建议稿与定稿人最终稿'}</h3>
            {type === 'CONFIRM' && <p className="mt-1 text-xs text-gray-500">草稿来源：{SUBMISSION_MODE_LABELS[payload.firstReview?.submissionMode ?? 'HUMAN']}。定稿人可修改任意结构化字段后直接通过。</p>}
          </div>
          {type === 'CONFIRM' && reviewerChanged && <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800">将记录为定稿人修改后通过</span>}
        </div>
        <div className="mt-3"><TutorLanguageEditor raw={finalOutput} onChange={(raw) => { setFinalOutput(raw); if (type === 'EDIT' && ['SELECT_A', 'SELECT_B'].includes(decision)) setDecision('EDIT'); }} allowedFocusIds={allowedFocusIds} focusDescriptions={focusDescriptions} editable={!leaseExpired} title={type === 'EDIT' ? '导师初审草稿' : '定稿人最终草稿'} /></div>
        {type === 'CONFIRM' && <details className="mt-3 rounded bg-gray-50 p-3 text-xs"><summary className="cursor-pointer font-medium">查看 AI 或标注员初筛说明</summary><p className="mt-2 whitespace-pre-wrap text-gray-600">{payload.firstReview?.reason}</p></details>}
      </section>

      {payload.warnings.length > 0 ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 className="font-semibold text-amber-950">自动检测信号</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-amber-900">机器标签只是信号，不是既定结论。定稿人可确认、部分确认、纠正类别或标记误报；与最终稿的关系由平台自动计算。</p></div>
            {type === 'CONFIRM' && <button type="button" onClick={() => { const index = payload.warnings.findIndex((warning) => !closureComplete(liveRelations[warning.id] ?? warning.computedFinalRelation, closures[warning.id])); if (index >= 0) document.getElementById(`warning-${index + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} className={`rounded px-2 py-1 text-xs font-medium ${unresolvedWarningCount === 0 ? 'bg-green-100 text-green-800' : 'bg-amber-200 text-amber-950'}`}>已处理 {payload.warnings.length - unresolvedWarningCount}/{payload.warnings.length}</button>}
          </div>
          <fieldset disabled={leaseExpired} className="mt-3 space-y-3 disabled:opacity-70">
            {payload.warnings.map((warning, warningIndex) => {
              const closure = closures[warning.id] ?? EMPTY_CLOSURE;
              const relation = liveRelations[warning.id] ?? warning.computedFinalRelation;
              return (
                <article id={`warning-${warningIndex + 1}`} key={warning.id} className="scroll-mt-24 rounded-lg border border-amber-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <b className="text-amber-950">第 {warningIndex + 1} 条 · {warningCodeLabel(warning.code.replace(/^CRITIQUE_/, '').toLowerCase()) === '其他自动检测信号' ? warningCodeLabel(warning.code) : warningCodeLabel(warning.code.replace(/^CRITIQUE_/, '').toLowerCase())}</b>
                    <span className="rounded bg-gray-100 px-2 py-0.5">候选 {warning.candidateSlot}</span>
                    <span className="rounded bg-gray-100 px-2 py-0.5">{warning.source === 'CRITIC' ? '交叉检查' : '确定性检查'}</span>
                    {type === 'CONFIRM' && relation && <span className={`rounded px-2 py-0.5 ${relation === 'PRESENT_IN_FINAL' ? 'bg-red-100 text-red-800' : relation === 'REMOVED_BY_EDIT' ? 'bg-green-100 text-green-800' : 'bg-violet-100 text-violet-800'}`}>{TUTOR_WARNING_FINAL_RELATION_LABELS[relation]} · 系统随编辑实时计算</span>}
                  </div>
                  <p className="mt-2 text-sm">{warning.message}</p>
                  {warning.evidence && <p className="mt-1 break-words text-xs text-gray-600">定位：{warning.evidence}</p>}
                  {type === 'CONFIRM' && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="text-xs font-medium">机器分类是否正确
                        <select disabled={leaseExpired} value={closure.detectorVerdict} onChange={(event) => updateClosure(warning.id, { detectorVerdict: event.target.value as TutorWarningDetectorVerdict | '' })} className="mt-1 block w-full border bg-white px-3 py-2 text-sm font-normal disabled:bg-gray-100">
                          <option value="">请选择</option>{TUTOR_WARNING_DETECTOR_VERDICTS.map((item) => <option key={item} value={item}>{TUTOR_WARNING_DETECTOR_VERDICT_LABELS[item]}</option>)}
                        </select>
                      </label>
                      {closure.detectorVerdict === 'MISCLASSIFIED' && <label className="text-xs font-medium">实际问题类别
                        <select value={closure.correctedCategory} onChange={(event) => updateClosure(warning.id, { correctedCategory: event.target.value as TutorWarningCorrectedCategory | '' })} className="mt-1 block w-full border bg-white px-3 py-2 text-sm font-normal"><option value="">请选择</option>{TUTOR_WARNING_CORRECTED_CATEGORIES.map((item) => <option key={item} value={item}>{TUTOR_WARNING_CORRECTED_CATEGORY_LABELS[item]}</option>)}</select>
                      </label>}
                      {relation === 'PRESENT_IN_FINAL' && closure.detectorVerdict && closure.detectorVerdict !== 'FALSE_POSITIVE' ? <label className="text-xs font-medium">对最终稿的严重程度（必填）
                        <select value={closure.finalSeverity} onChange={(event) => updateClosure(warning.id, { finalSeverity: event.target.value as TutorWarningSeverity | '' })} className="mt-1 block w-full border bg-white px-3 py-2 text-sm font-normal"><option value="">请选择</option>{TUTOR_WARNING_SEVERITIES.map((item) => <option key={item} value={item}>{TUTOR_WARNING_SEVERITY_LABELS[item]}</option>)}</select>
                      </label> : relation && relation !== 'PRESENT_IN_FINAL' ? <label className="text-xs font-medium">原候选问题强度（可选）
                        <select value={closure.candidateSeverity} onChange={(event) => updateClosure(warning.id, { candidateSeverity: event.target.value as TutorWarningSeverity | '' })} className="mt-1 block w-full border bg-white px-3 py-2 text-sm font-normal"><option value="">不评价</option>{TUTOR_WARNING_SEVERITIES.map((item) => <option key={item} value={item}>{TUTOR_WARNING_SEVERITY_LABELS[item]}</option>)}</select>
                      </label> : null}
                      <label className="text-xs font-medium md:col-span-2">人工说明（建议填写）
                        <input value={closure.note} onChange={(event) => updateClosure(warning.id, { note: event.target.value })} placeholder="例如：真正的问题是过度推进，而不是多个独立问句" className="mt-1 block w-full border bg-white px-3 py-2 text-sm font-normal" />
                      </label>
                    </div>
                  )}
                </article>
              );
            })}
          </fieldset>
        </section>
      ) : type === 'CONFIRM' ? <section className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">本案例没有自动检测信号，仍需独立审核学生案例和最终导师回复。</section> : null}

      <fieldset disabled={leaseExpired} className="rounded-xl border bg-white p-4 disabled:bg-gray-50">
        {type === 'EDIT' ? (
          <>
            <label className="text-sm">初审决定
              <select value={['REGENERATE', 'REGRESSION', 'NEGATIVE', 'REJECT'].includes(decision) ? '' : decision} onChange={(event) => setDecision(event.target.value)} className="mt-1 block w-full border px-3 py-2"><option value="SELECT_A">{REVIEW_DECISION_LABELS.SELECT_A}</option><option value="SELECT_B">{REVIEW_DECISION_LABELS.SELECT_B}</option><option value="MERGE">{REVIEW_DECISION_LABELS.MERGE}</option><option value="EDIT">{REVIEW_DECISION_LABELS.EDIT}</option><option value="RETURN_CASE">{REVIEW_DECISION_LABELS.RETURN_CASE}</option>{['REGENERATE', 'REGRESSION', 'NEGATIVE', 'REJECT'].includes(decision) && <option value="">已选择高级治理动作</option>}</select>
            </label>
            {decision === 'RETURN_CASE' && <div className="mt-3 rounded border border-violet-200 bg-violet-50 p-3"><div className="text-sm font-medium text-violet-950">学生案例质量问题</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(TUTOR_CASE_ISSUE_LABELS).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={caseIssueCategories.includes(key as CaseIssueCategory)} onChange={() => toggleCaseIssue(key as CaseIssueCategory)} className="mt-1" /><span>{label}</span></label>)}</div><label className="mt-3 block text-sm">建议学生问题改写（管理员审批后才会生效）<textarea value={suggestedStudentMessage} onChange={(event) => setSuggestedStudentMessage(event.target.value)} className="mt-1 min-h-24 w-full border bg-white p-3" /></label></div>}
            <details className="mt-3 rounded border bg-gray-50 p-3"><summary className="cursor-pointer text-sm font-medium">高级：训练治理与草稿来源</summary><div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm">高级治理动作<select value={['REGENERATE', 'REGRESSION', 'NEGATIVE', 'REJECT'].includes(decision) ? decision : ''} onChange={(event) => { if (event.target.value) setDecision(event.target.value); }} className="mt-1 block w-full border bg-white px-3 py-2"><option value="">不使用高级动作</option><option value="REGENERATE">{REVIEW_DECISION_LABELS.REGENERATE}</option><option value="REGRESSION">{REVIEW_DECISION_LABELS.REGRESSION}</option><option value="NEGATIVE">{REVIEW_DECISION_LABELS.NEGATIVE}</option><option value="REJECT">{REVIEW_DECISION_LABELS.REJECT}</option></select></label>
              <label className="text-sm">草稿形成方式<select value={submissionMode} onChange={(event) => setSubmissionMode(event.target.value as SubmissionMode)} className="mt-1 block w-full border bg-white px-3 py-2"><option value="HUMAN">{SUBMISSION_MODE_LABELS.HUMAN}</option><option value="AI_ASSISTED_HUMAN_SUBMIT">{SUBMISSION_MODE_LABELS.AI_ASSISTED_HUMAN_SUBMIT}</option>{payload.case.reviewPolicy === 'AI_DIRECT_TO_REVIEWER' && <option value="AI_DIRECT_ADMIN_AUTHORIZED">{SUBMISSION_MODE_LABELS.AI_DIRECT_ADMIN_AUTHORIZED}</option>}</select></label>
              <label className="text-sm">未采用候选（可选）<select value={rejectedId} onChange={(event) => setRejectedId(event.target.value)} className="mt-1 block w-full border bg-white px-3 py-2"><option value="">不生成偏好对</option>{payload.candidates.filter((candidate) => candidate.id !== selectedId).map((candidate) => <option key={candidate.id} value={candidate.id}>候选 {candidate.slot}</option>)}</select></label>
              <label className="text-sm">采用稿优于未采用稿的理由<textarea value={preferenceReason} onChange={(event) => setPreferenceReason(event.target.value)} disabled={!rejectedId} className="mt-1 min-h-20 w-full border bg-white p-2 disabled:bg-gray-100" /></label>
            </div></details>
          </>
        ) : (
          <>
            <label className="text-sm">正式人工审核决定
              <select value={decision} onChange={(event) => setDecision(event.target.value)} className="mt-1 block w-full border px-3 py-2"><option value="CONFIRM">通过（若草稿已修改，将记录为修改后通过）</option><option value="RETURN_TUTOR">退回标注员修订导师回复</option><option value="RETURN_CASE">提交管理员处理学生案例</option><option value="REJECT">拒绝案例</option></select>
            </label>
            {confirmDecision === 'RETURN_CASE' && <div className="mt-3 rounded border border-violet-200 bg-violet-50 p-3"><div className="text-sm font-medium text-violet-950">案例质量问题</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(TUTOR_CASE_ISSUE_LABELS).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={caseIssueCategories.includes(key as CaseIssueCategory)} onChange={() => toggleCaseIssue(key as CaseIssueCategory)} className="mt-1" /><span>{label}</span></label>)}</div><label className="mt-3 block text-sm">建议学生问题改写（管理员审批后才会生效）<textarea value={suggestedStudentMessage} onChange={(event) => setSuggestedStudentMessage(event.target.value)} className="mt-1 min-h-24 w-full border bg-white p-3" /></label></div>}
          </>
        )}
        <label className="mt-3 block text-sm">{type === 'CONFIRM' ? '正式人工审核理由（必填）' : '导师初审理由（必填）'}
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder={type === 'CONFIRM' ? '说明为什么可以定稿、需要修订导师回复，或学生案例本身有什么问题。' : '说明选择、合并、编辑或重新生成的依据。'} className="mt-1 min-h-24 w-full border p-3" />
        </label>
        <button type="button" disabled={pending || leaseExpired || Boolean(editBlockedReason) || confirmationBlocked || caseReturnBlocked} onClick={submit} className="mt-4 bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">{submitLabel}</button>
        {editBlockedReason && <p className="mt-2 text-sm text-amber-800">{editBlockedReason}</p>}
        {type === 'CONFIRM' && finalPreviewError && <p className="mt-3 text-sm text-red-700">{finalPreviewError}</p>}
        {type === 'CONFIRM' && confirmDecision === 'CONFIRM' && unresolvedWarningCount > 0 && <span className="ml-3 text-sm text-amber-800">还有 {unresolvedWarningCount} 条自动信号未完成必要判断</span>}
        {message && <span className="ml-3 text-sm text-gray-600">{message}</span>}
      </fieldset>
    </div>
  );
}
