'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Dialog, { ConfirmDialog } from './Dialog';
import { dataLabValueLabel } from '@/app/lib/dataLab/labels';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select, Textarea } from '@/app/components/ui/Field';

interface RoleItem {
  roleKey: string;
  displayName: string;
  description: string;
  enabled: boolean;
  defaultRuntimeBundle: { id: string; name: string; version: number; status: string } | null;
}

interface BundleItem {
  id: string;
  name: string;
  version: number;
  status: string;
  roleKey: string;
  tutorContractVersion: string;
  stageContractVersion: string;
  extractorVersion: string;
  generationParamsJson: string;
  compatibilityReportJson: string;
  legacy: boolean;
  modelVersion: { id: string; tag: string; modelFamily: string; verificationStatus: string; trainedPromptPolicyVersionId: string | null };
  endpoint: { id: string; displayName: string; remoteModelId: string; status: string; connection: { name: string; status: string; baseUrl: string } };
  promptPolicyVersion: { id: string; version: string; displayName: string; status: string };
  compatibilityStatus: string | null;
  counts: { traces: number; deployments: number; evaluations: number };
}

interface OptionData {
  models: Array<{ id: string; tag: string; modelFamily: string; verificationStatus: string }>;
  endpoints: Array<{ id: string; displayName: string; remoteModelId: string; status: string; modelVersionId: string | null; connectionName: string; connectionStatus: string }>;
  prompts: Array<{ id: string; version: string; displayName: string; status: string; tutorContractVersion: string; stageContractVersion: string; extractorVersion: string }>;
  roles: Array<{ roleKey: string; displayName: string }>;
}

const GROUPS = [
  ['DRAFT', '草稿'],
  ['PENDING_COMPATIBILITY', '待兼容性评测'],
  ['COMPATIBLE', '兼容性通过'],
  ['INCOMPATIBLE', '不兼容'],
  ['AVAILABLE', '可部署'],
  ['DEPLOYED', '已部署'],
  ['DISABLED', '已停用'],
] as const;

const initialForm = { name: '', roleKey: '', modelVersionId: '', endpointId: '', promptPolicyVersionId: '', generationParams: '{"temperature":0.3,"maxTokens":1200}' };

export default function RuntimeBundleManager({
  roles,
  bundles,
  options,
}: {
  roles: RoleItem[];
  bundles: BundleItem[];
  options: OptionData;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState(initialForm);
  const [consistency, setConsistency] = useState<{ ok: boolean; blockers: string[]; warnings: string[]; checks: Array<{ code: string; ok: boolean; detail: string }> } | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState<BundleItem | null>(null);
  const [disableTarget, setDisableTarget] = useState<BundleItem | null>(null);
  const [defaultTarget, setDefaultTarget] = useState<{ role: RoleItem; bundle: BundleItem } | null>(null);
  const grouped = useMemo(
    () => Object.fromEntries(GROUPS.map(([status]) => [status, bundles.filter((bundle) => bundle.status === status)])),
    [bundles],
  );
  const selectedEndpoint = options.endpoints.find((item) => item.id === form.endpointId);
  const selectedModel = options.models.find((item) => item.id === form.modelVersionId);

  async function call(url: string, init: RequestInit, success: string) {
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch(url, init);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '操作失败');
      setFeedback({ tone: 'success', text: success });
      router.refresh();
      return data;
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      setPending(false);
    }
  }

  function payload() {
    return {
      roleKey: form.roleKey,
      modelVersionId: form.modelVersionId,
      endpointId: form.endpointId,
      promptPolicyVersionId: form.promptPolicyVersionId,
    };
  }

  async function preview() {
    const data = await call('/api/data-lab/runtime-bundles/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    }, '配置一致性检查完成。');
    setConsistency(data);
  }

  async function create() {
    let generationParams: unknown;
    try { generationParams = JSON.parse(form.generationParams); } catch { setFeedback({ tone: 'error', text: '生成参数必须是合法 JSON。' }); return; }
    const data = await call('/api/data-lab/runtime-bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, ...payload(), generationParams }),
    }, '运行组合草稿已创建，所选模型、Endpoint、Prompt 与合同已经冻结到该版本。');
    setConsistency(data.report);
    setForm(initialForm);
  }

  async function action(bundle: BundleItem, value: 'CHECK' | 'TEST' | 'EVALUATE_COMPATIBILITY' | 'MARK_AVAILABLE' | 'DISABLE') {
    const labels = {
      CHECK: '配置一致性已重新检查。',
      TEST: '实际调用探针通过，响应结构和延迟已记录。',
      EVALUATE_COMPATIBILITY: '兼容性评测已完成，证据已保存。',
      MARK_AVAILABLE: '运行组合已标记为可用。',
      DISABLE: '运行组合已停用，历史引用保留。',
    };
    await call(`/api/data-lab/runtime-bundles/${bundle.id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: value }),
    }, labels[value]);
  }

  async function setDefault(role: RoleItem, bundleId: string) {
    await call(`/api/data-lab/runtime-roles/${role.roleKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundleId }),
    }, `${role.displayName} 的未来任务默认组合已更新；已有任务不受影响。`);
  }

  function copy(bundle: BundleItem) {
    setForm({
      name: bundle.name,
      roleKey: bundle.roleKey,
      modelVersionId: bundle.modelVersion.id,
      endpointId: bundle.endpoint.id,
      promptPolicyVersionId: bundle.promptPolicyVersion.id,
      generationParams: bundle.generationParamsJson,
    });
    setConsistency(null);
    document.getElementById('create-runtime-bundle')?.scrollIntoView({ behavior: 'smooth' });
  }

  return <div className="space-y-6">
    <section className="border border-hairline bg-canvas p-5"><h2 className="font-semibold">角色默认绑定</h2><p className="mt-1 text-sm text-muted">角色数量来自数据库。修改默认只影响未来批次或新会话；已经冻结的案例和已固定旧会话不会被切换。</p><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{roles.map((role) => <div key={role.roleKey} className="border border-hairline bg-surface-soft p-3"><div className="flex justify-between gap-2"><b className="text-sm">{role.displayName}</b><span className="text-xs text-muted">{role.enabled ? '启用' : '停用'}</span></div><p className="mt-1 min-h-10 text-xs leading-5 text-muted">{role.description}</p><label className="mt-2 block text-xs">未来任务默认组合<Select value={role.defaultRuntimeBundle?.id ?? ''} onChange={(event) => { const bundle = bundles.find((item) => item.id === event.target.value); if (bundle) setDefaultTarget({ role, bundle }); }} className="mt-1"><option value="">尚未绑定</option>{bundles.filter((bundle) => bundle.roleKey === role.roleKey && ['AVAILABLE', 'DEPLOYED'].includes(bundle.status)).map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name} v{bundle.version}</option>)}</Select></label></div>)}</div></section>

    <section id="create-runtime-bundle" className="scroll-mt-4 border border-hairline bg-canvas p-5"><div><h2 className="font-semibold">创建运行组合</h2><p className="mt-1 text-sm text-muted">实际可调用、可评测、可部署的单位。保存会创建不可覆盖的新版本。</p></div><div className="mt-4 grid gap-2 text-xs sm:grid-cols-5"><span className="border-b-2 border-ink pb-2">1. 用途角色</span><span className="border-b-2 border-hairline pb-2">2. 模型产物</span><span className="border-b-2 border-hairline pb-2">3. 服务 Endpoint</span><span className="border-b-2 border-hairline pb-2">4. Prompt 与合同</span><span className="border-b-2 border-hairline pb-2">5. 检查并保存</span></div><div className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="text-sm">组合名称<Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Qwen STEM Tutor" className="mt-1" /></label>
      <label className="text-sm">用途角色<Select value={form.roleKey} onChange={(event) => { setForm({ ...form, roleKey: event.target.value }); setConsistency(null); }} className="mt-1"><option value="">请选择</option>{options.roles.map((role) => <option key={role.roleKey} value={role.roleKey}>{role.displayName}</option>)}</Select></label>
      <label className="text-sm">模型产物<Select value={form.modelVersionId} onChange={(event) => { setForm({ ...form, modelVersionId: event.target.value }); setConsistency(null); }} className="mt-1"><option value="">请选择</option>{options.models.map((model) => <option key={model.id} value={model.id}>{model.tag} · {model.modelFamily || '家族待核验'}</option>)}</Select></label>
      <label className="text-sm">服务 Endpoint<Select value={form.endpointId} onChange={(event) => { setForm({ ...form, endpointId: event.target.value }); setConsistency(null); }} className="mt-1"><option value="">请选择</option>{options.endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.displayName} · {endpoint.connectionName} · {dataLabValueLabel(endpoint.status)}</option>)}</Select></label>
      <label className="text-sm">Prompt 策略<Select value={form.promptPolicyVersionId} onChange={(event) => { setForm({ ...form, promptPolicyVersionId: event.target.value }); setConsistency(null); }} className="mt-1"><option value="">请选择</option>{options.prompts.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.displayName} · {dataLabValueLabel(prompt.status)}</option>)}</Select></label>
      <label className="text-sm">生成参数 JSON<Textarea value={form.generationParams} onChange={(event) => setForm({ ...form, generationParams: event.target.value })} className="mt-1 min-h-20 font-mono" /></label>
    </div>
    {selectedModel && selectedEndpoint && selectedEndpoint.modelVersionId && selectedEndpoint.modelVersionId !== selectedModel.id && <div className="mt-3 border border-error/40 bg-error/8 p-3 text-sm text-body-strong"><b>为什么不能继续：</b>所选 Endpoint 已绑定到另一个模型产物。请修改“模型产物”或回到“AI 服务”修正 Endpoint 关联。</div>}
    {consistency && <div className={`mt-4 border border-hairline p-4 ${consistency.ok ? 'border-success/40 bg-success/8' : 'border-error/40 bg-error/8'}`}><b className="text-sm">{consistency.ok ? '配置一致，可以保存草稿' : '配置存在阻断'}</b>{consistency.blockers.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-error">{consistency.blockers.map((item) => <li key={item}>{item}</li>)}</ul>}{consistency.warnings.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[#8a6a0f]">{consistency.warnings.map((item) => <li key={item}>{item}</li>)}</ul>}</div>}
    <div className="mt-4 flex flex-wrap gap-2"><button disabled={pending || !form.roleKey || !form.modelVersionId || !form.endpointId || !form.promptPolicyVersionId} onClick={preview} className={buttonClass('secondary', 'md')}>检查配置一致性</button><button disabled={pending || !consistency?.ok || !form.name.trim()} onClick={create} className={buttonClass('primary', 'md')}>保存运行组合草稿</button></div></section>

    {feedback && <p aria-live="polite" className={`border border-hairline p-3 text-sm ${feedback.tone === 'success' ? 'border-success/40 bg-success/8 text-body-strong' : 'border-error/40 bg-error/8 text-body-strong'}`}>{feedback.text}</p>}

    {GROUPS.map(([status, label]) => <section key={status} className="space-y-3"><h2 className="font-semibold">{label}（{grouped[status]?.length ?? 0}）</h2>{(grouped[status] ?? []).map((bundle) => <article key={bundle.id} className="border border-hairline bg-canvas p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs text-muted">{roles.find((role) => role.roleKey === bundle.roleKey)?.displayName ?? bundle.roleKey} · 第 {bundle.version} 版 · {bundle.legacy ? 'Legacy 包装' : '完整运行组合'}</div><h3 className="mt-1 font-semibold">{bundle.name}</h3><p className="mt-1 text-sm text-muted">{bundle.modelVersion.tag} + {bundle.promptPolicyVersion.version}</p></div><span className={`px-2 py-1 text-xs ${status === 'AVAILABLE' || status === 'DEPLOYED' ? 'bg-success/10 text-body-strong' : status === 'INCOMPATIBLE' ? 'bg-error/10 text-body-strong' : 'bg-surface-card'}`}>{label}</span></div>
      <div className="mt-4 grid gap-3 text-xs md:grid-cols-3"><div className="border border-hairline bg-surface-soft p-3"><b>模型产物</b><p className="mt-1">{bundle.modelVersion.tag}<br />家族 {bundle.modelVersion.modelFamily || '待核验'}<br />{dataLabValueLabel(bundle.modelVersion.verificationStatus)}</p></div><div className="border border-hairline bg-surface-soft p-3"><b>服务 Endpoint</b><p className="mt-1">{bundle.endpoint.displayName}<br />{bundle.endpoint.connection.name} · {dataLabValueLabel(bundle.endpoint.connection.status)}<br />{bundle.endpoint.remoteModelId} · {dataLabValueLabel(bundle.endpoint.status)}</p></div><div className="border border-hairline bg-surface-soft p-3"><b>Prompt 与合同</b><p className="mt-1">{bundle.promptPolicyVersion.version}<br />{bundle.tutorContractVersion}<br />{bundle.stageContractVersion}</p></div></div>
      {status === 'DRAFT' && <div className="mt-3 border border-warning/40 bg-warning/8 p-3 text-xs text-body-strong"><b>为什么不能继续：</b>配置一致性尚未通过。“检查配置一致性”会列出 Endpoint、模型、Prompt 和合同中的具体阻断；修复后请创建新版组合。</div>}
      {status === 'INCOMPATIBLE' && <div className="mt-3 border border-error/40 bg-error/8 p-3 text-xs text-body-strong"><b>为什么不能继续：</b>模型 × Prompt 兼容性评测未通过。评测证据会列出失败项；修复配置后请创建组合副本。</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={pending || status === 'DISABLED'} onClick={() => action(bundle, 'TEST')} className={buttonClass('secondary', 'sm')}>测试实际调用</button>
        <button disabled={pending || status === 'DISABLED'} onClick={() => action(bundle, 'CHECK')} className={buttonClass('secondary', 'sm')}>检查配置一致性</button>
        {['PENDING_COMPATIBILITY', 'INCOMPATIBLE'].includes(status) && <button disabled={pending} onClick={() => action(bundle, 'EVALUATE_COMPATIBILITY')} className={buttonClass('secondary', 'sm')}>开始兼容性评测</button>}
        <button onClick={() => setEvidenceTarget(bundle)} className={buttonClass('secondary', 'sm')}>查看证据与历史影响</button>
        {status === 'COMPATIBLE' && <button disabled={pending} onClick={() => action(bundle, 'MARK_AVAILABLE')} className={buttonClass('primary', 'sm')}>标记为可用组合</button>}
        {status === 'AVAILABLE' && <button disabled={pending} onClick={() => { const role = roles.find((item) => item.roleKey === bundle.roleKey); if (role) setDefaultTarget({ role, bundle }); }} className={buttonClass('primary', 'sm')}>设为此角色默认</button>}
        <button onClick={() => copy(bundle)} className={buttonClass('secondary', 'sm')}>创建组合副本</button>
        {!['DEPLOYED', 'DISABLED'].includes(status) && <button onClick={() => setDisableTarget(bundle)} className={buttonClass('danger', 'sm')}>停用运行组合</button>}
      </div><p className="mt-3 text-right text-xs text-muted-soft">{bundle.counts.evaluations} 次评测 · {bundle.counts.deployments} 次部署 · {bundle.counts.traces} 条生成轨迹</p>
    </article>)}{(grouped[status]?.length ?? 0) === 0 && <p className="border border-hairline bg-canvas p-4 text-sm text-muted">当前没有{label}运行组合。</p>}</section>)}

    <Dialog open={Boolean(evidenceTarget)} title={`运行组合证据与历史影响 · ${evidenceTarget?.name ?? ''}`} description="证据只读；修改模型、Prompt、Endpoint 或参数必须创建组合副本。" onClose={() => setEvidenceTarget(null)} maxWidth="max-w-3xl">{evidenceTarget && <div className="space-y-3"><div className="grid gap-2 text-xs sm:grid-cols-3"><div className="border border-hairline p-3"><b>兼容状态</b><p>{evidenceTarget.compatibilityStatus ? dataLabValueLabel(evidenceTarget.compatibilityStatus) : '尚未评测'}</p></div><div className="border border-hairline p-3"><b>历史影响</b><p>{evidenceTarget.counts.traces} 条轨迹、{evidenceTarget.counts.deployments} 次部署</p></div><div className="border border-hairline p-3"><b>当前角色</b><p>{roles.find((role) => role.roleKey === evidenceTarget.roleKey)?.displayName}</p></div></div><pre className="max-h-96 overflow-auto whitespace-pre-wrap border border-hairline bg-surface-dark p-3 text-xs text-on-dark">{JSON.stringify(JSON.parse(evidenceTarget.compatibilityReportJson), null, 2)}</pre></div>}</Dialog>
    <ConfirmDialog open={Boolean(defaultTarget)} title="更新角色默认运行组合" description={`${defaultTarget?.role.displayName ?? ''} → ${defaultTarget?.bundle.name ?? ''} v${defaultTarget?.bundle.version ?? ''}。`} consequence="只影响今后新建的 Data Lab 批次与明确读取该登记的流程；已冻结案例、生成轨迹和已固定会话不会切换。学生端生产路由部署记录控制。" confirmLabel="确认更新默认组合" pending={pending} onClose={() => setDefaultTarget(null)} onConfirm={async () => { if (defaultTarget) await setDefault(defaultTarget.role, defaultTarget.bundle.id); setDefaultTarget(null); }} />
    <ConfirmDialog open={Boolean(disableTarget)} title="停用运行组合" description={`将禁止新任务引用“${disableTarget?.name ?? ''} v${disableTarget?.version ?? ''}”。`} consequence="已固定任务、生成轨迹和评测记录保持不变；角色默认或已部署组合会被阻断。" confirmLabel="确认停用" danger pending={pending} onClose={() => setDisableTarget(null)} onConfirm={async () => { if (disableTarget) await action(disableTarget, 'DISABLE'); setDisableTarget(null); }} />
  </div>;
}
