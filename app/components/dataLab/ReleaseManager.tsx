'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import { dataLabValueLabel } from '@/app/lib/dataLab/labels';

interface ReleaseTurn {
  id: string;
  label: string;
  phase: number;
  eligible: boolean;
  provenance: string;
  reviewerEditType: string;
  cohort: {
    promptVersion: string;
    tutorContractVersion: string;
    stageContractVersion: string;
    extractorVersion: string;
  };
  preview: {
    system: string;
    human: string;
    gpt: string;
  };
  blockers: string[];
}

export default function ReleaseManager({ turns }: { turns: ReleaseTurn[] }) {
  const router = useRouter();
  const [version, setVersion] = useState('');
  const eligible = turns.filter((turn) => turn.eligible);
  const ineligible = turns.filter((turn) => !turn.eligible);
  const [selected, setSelected] = useState<string[]>(eligible.map((turn) => turn.id));
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [pending, setPending] = useState(false);
  const [confirmingCreate, setConfirmingCreate] = useState(false);
  const [showIneligible, setShowIneligible] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const selectedTurns = turns.filter((turn) => selected.includes(turn.id));
  const cohortKeys = [...new Set(selectedTurns.map((turn) => JSON.stringify(turn.cohort)))];
  const cohortConflict = cohortKeys.length > 1;
  const previewTurn = selectedTurns[0];

  async function create() {
    setPending(true); setMessage(null);
    try {
      const response = await fetch('/api/data-lab/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, finalizedTutorTurnIds: selected }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '创建失败');
      setMessageTone('success'); setMessage(`数据版本已冻结：监督微调数据 ${data.summary.training} 条，偏好对 ${data.summary.preference} 条。`); setVersion(''); router.refresh();
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }

  return <section className="rounded-xl border bg-white p-4">
    <h2 className="font-semibold">从已定稿的导师回合创建数据版本</h2>
    <p className="mt-1 text-xs text-gray-500">选择具备训练资格的数据并冻结为不可修改版本。导出只包含导师教学语言；平台状态、确认书和结构化产物不会写入模型训练目标。</p>

    <div className="mt-3 grid gap-2 rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950 sm:grid-cols-4">
      <div>Prompt<br /><b>{previewTurn?.cohort.promptVersion ?? '等待选择'}</b></div>
      <div>Tutor 合同<br /><b>{previewTurn?.cohort.tutorContractVersion ?? '等待选择'}</b></div>
      <div>Stage 合同<br /><b>{previewTurn?.cohort.stageContractVersion ?? '等待选择'}</b></div>
      <div>Extractor<br /><b>{previewTurn?.cohort.extractorVersion ?? '等待选择'}</b></div>
    </div>
    {cohortConflict && <p className="mt-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">不能继续：所选条目来自不同 Prompt 或合同 cohort。取消勾选冲突条目，确保上方四项完全一致。</p>}

    <label className="mt-3 block max-w-md text-sm">版本号<input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="tutor-language-v1-2026-07" className="mt-1 w-full border px-3 py-2" /></label>

    <div className="mt-4 max-h-72 space-y-2 overflow-auto rounded border p-3">
      {eligible.length === 0 && <div className="space-y-2 text-sm text-gray-600">
        <p className="font-medium">暂无可进入训练的数据。</p>
        <p className="text-xs leading-relaxed">冒烟/校准/试验阶段的数据只用于验证流程质量（标记为 MONITORING_ONLY），不会出现在可选列表。等正式集 180 条完成双审后，合格的定稿将出现在这里。</p>
      </div>}
      {eligible.map((turn) => <label key={turn.id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={selected.includes(turn.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, turn.id] : selected.filter((id) => id !== turn.id))} />
        <span>阶段 {turn.phase} · {turn.label} · {dataLabValueLabel(turn.provenance)} · 定稿人{dataLabValueLabel(turn.reviewerEditType)}</span>
      </label>)}
      {ineligible.length > 0 && <details open={showIneligible} onToggle={(e) => setShowIneligible((e.target as HTMLDetailsElement).open)} className="mt-3 border-t pt-3">
        <summary className="cursor-pointer text-xs font-medium text-gray-500">不可选条目（{ineligible.length} 条流程验证数据）</summary>
        <div className="mt-2 space-y-1">{ineligible.map((turn) => <div key={turn.id} className="text-xs text-gray-400">阶段 {turn.phase} · {turn.label} · {dataLabValueLabel(turn.provenance)}{turn.blockers.length ? ` · 阻断：${turn.blockers.join('、')}` : ''}</div>)}</div>
      </details>}
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => setShowPreview((value) => !value)} disabled={!previewTurn} className="border border-blue-700 px-4 py-2 text-sm text-blue-800 disabled:opacity-40">预览 ShareGPT 样例</button>
      <button onClick={() => setConfirmingCreate(true)} disabled={pending || !version.trim() || selected.length === 0 || cohortConflict} className="bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40">创建并冻结数据版本</button>
      {message && <span aria-live="polite" className={`text-sm ${messageTone === 'success' ? 'text-green-700' : 'text-red-700'}`}>{message}</span>}
    </div>
    {showPreview && previewTurn && <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-3">
      <div className="text-xs font-medium text-blue-950">预览第 1 条所选数据：system / human / gpt</div>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-gray-950 p-3 text-xs text-gray-100">{JSON.stringify({ conversations: [{ from: 'system', value: previewTurn.preview.system }, { from: 'human', value: previewTurn.preview.human }, { from: 'gpt', value: previewTurn.preview.gpt }] }, null, 2)}</pre>
    </div>}

    <ConfirmDialog open={confirmingCreate} title="创建并冻结数据版本" description={`将 ${selected.length} 条已定稿数据写入版本"${version}"。`} consequence="冻结后不能增删条目或修改内容；如需调整，必须创建新的版本。" confirmLabel="确认创建并冻结" pending={pending} onClose={() => setConfirmingCreate(false)} onConfirm={async () => { await create(); setConfirmingCreate(false); }} />
  </section>;
}

export function ReleaseArtifactCard({ release }: {
  release: {
    id: string;
    version: string;
    status: string;
    itemCount: number;
    trainingRunCount: number;
    kinds: string[];
    cohort: Record<string, unknown>;
    summary: Record<string, unknown>;
    checksums: Record<string, string | null>;
  };
}) {
  const [message, setMessage] = useState('');
  async function copyChecksums() {
    await navigator.clipboard.writeText(JSON.stringify(release.checksums, null, 2));
    setMessage('文件校验值已复制。');
  }
  return <article className="border bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-medium">{release.version}</h3><p className="mt-1 text-xs text-gray-500">{dataLabValueLabel(release.status)} · {release.itemCount} 条数据 · 已登记 {release.trainingRunCount} 次外部训练</p></div>
      {release.status === 'DRAFT' && <FreezeReleaseButton id={release.id} />}
    </div>
    <details className="mt-3 rounded border bg-gray-50 p-3 text-xs">
      <summary className="cursor-pointer font-medium">查看 cohort 与发布摘要</summary>
      <pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify({ trainingCohort: release.cohort, summary: release.summary }, null, 2)}</pre>
    </details>
    {release.status === 'FROZEN' && <div className="mt-4 grid gap-2 md:grid-cols-2">
      {release.kinds.map((kind) => {
        const labels: Record<string, string> = { training: '下载 ShareGPT 训练集', preference: '下载偏好数据', manifest: '下载发布清单' };
        return <a key={kind} href={`/api/data-lab/releases/${release.id}/export/${kind}`} className="border p-3 hover:border-blue-500"><b className="text-sm">{labels[kind] ?? `下载 ${kind} 数据`}</b><span className="ml-2 text-xs text-gray-400">{kind}.json</span></a>;
      })}
    </div>}
    {release.status === 'FROZEN' && <div className="mt-3 flex items-center gap-3"><button type="button" onClick={copyChecksums} className="border px-3 py-2 text-xs">复制文件校验值</button><span aria-live="polite" className="text-xs text-green-700">{message}</span></div>}
  </article>;
}

export function FreezeReleaseButton({ id }: { id: string }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null); const [confirming, setConfirming] = useState(false);
  async function freeze() { setPending(true); setError(null); try { const response = await fetch(`/api/data-lab/releases/${id}/freeze`, { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '冻结失败'); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setPending(false); } }
  return <div><button onClick={() => setConfirming(true)} disabled={pending} className="border border-gray-900 px-3 py-1 text-xs">{pending ? '冻结中…' : '冻结草稿版本'}</button>{error && <div className="mt-1 text-xs text-red-600">{error}</div>}<ConfirmDialog open={confirming} title="冻结草稿版本" description="将这个尚未冻结的历史版本转为正式交付版本。" consequence="冻结后内容不可修改，只能通过新建版本继续调整。" confirmLabel="确认冻结" pending={pending} onClose={() => setConfirming(false)} onConfirm={async () => { await freeze(); setConfirming(false); }} /></div>;
}
