'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/app/components/dataLab/Dialog';
import { DEPLOYMENT_OBSERVATION_META, gateFailureCategory, gateFailureLabel } from '@/app/lib/dataLab/labels';
import { buttonClass } from '@/app/components/ui/Button';
import { Input, Select } from '@/app/components/ui/Field';

interface RuntimeBundleOption {
  id: string;
  label: string;
  status: string;
  modelTag: string;
  modelVersionId: string;
  promptVersion: string;
  promptPolicyVersionId: string;
  endpointName: string;
  endpointId: string;
}

interface ActiveDeployment {
  id: string;
  runtimeBundleId: string | null;
  modelVersionId: string;
  rolloutPercent: number;
  previousRuntimeBundleId: string | null;
  previousModelVersionId: string | null;
  observationJson: string;
  startedAt: string;
}

const EMPTY_OBSERVATION = { sessions: 0, criticalErrors: 0, structureFailureRate: 0, baselineStructureFailureRate: 0, teacherRejectRate: 0, baselineTeacherRejectRate: 0, earlyTerminationRate: 0, baselineEarlyTerminationRate: 0 };

function parseObservation(value?: string) {
  try {
    const parsed = JSON.parse(value ?? '{}') as Record<string, unknown>;
    return {
      values: Object.fromEntries(Object.entries(EMPTY_OBSERVATION).map(([key, fallback]) => [key, typeof parsed[key] === 'number' ? parsed[key] : fallback])) as typeof EMPTY_OBSERVATION,
      promotionPaused: parsed.promotionPaused === true,
      recordedAt: typeof parsed.recordedAt === 'string' ? parsed.recordedAt : null,
    };
  } catch {
    return { values: { ...EMPTY_OBSERVATION }, promotionPaused: false, recordedAt: null };
  }
}

export default function DeploymentControls({ bundles, active, deploymentEnabled }: {
  bundles: RuntimeBundleOption[];
  active: ActiveDeployment | null;
  deploymentEnabled: boolean;
}) {
  const router = useRouter();
  const [bundleId, setBundleId] = useState(active?.runtimeBundleId ?? '');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmingDeploy, setConfirmingDeploy] = useState(false);
  const [confirmingRollback, setConfirmingRollback] = useState(false);
  const [observation, setObservation] = useState(() => parseObservation(active?.observationJson).values);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const selected = bundles.find((bundle) => bundle.id === bundleId);
  const current = bundles.find((bundle) => bundle.id === active?.runtimeBundleId);
  const legacyDeployment = Boolean(active && !active.runtimeBundleId);
  const rollbackTarget = legacyDeployment ? '上一模型版本' : '上一运行组合';
  const same = active?.runtimeBundleId === bundleId;
  const nextPercent = same ? active?.rolloutPercent === 10 ? 30 : active?.rolloutPercent === 30 ? 100 : null : 10;
  const savedObservation = parseObservation(active?.observationJson);
  const paused = active ? savedObservation.promotionPaused : false;
  const elapsedHours = active ? Math.max(0, (currentTime - new Date(active.startedAt).getTime()) / 3_600_000) : 0;
  const requiredHours = active?.rolloutPercent === 10 ? 48 : 72;
  const requiredSessions = active?.rolloutPercent === 10 ? 50 : 150;

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const change = useMemo(() => {
    if (!selected) return '等待选择候选运行组合';
    if (!current) return '首次运行组合部署';
    const model = current.modelVersionId !== selected.modelVersionId;
    const prompt = current.promptPolicyVersionId !== selected.promptPolicyVersionId;
    if (model && prompt) return '模型和 Prompt 同时变化';
    if (model) return '只换模型';
    if (prompt) return '只换 Prompt';
    if (current.endpointId !== selected.endpointId) return 'Endpoint 迁移';
    return '同一运行组合继续晋级';
  }, [current, selected]);

  async function action(url: string, body?: unknown) {
    setPending(true); setMessage('');
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '操作失败');
      router.refresh();
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setPending(false);
    }
  }

  async function calculateGate() {
    if (!bundleId) return;
    try {
      const data = await action(`/api/data-lab/runtime-bundles/${bundleId}/action`, { action: 'DEPLOYMENT_GATE' });
      const failures: string[] = Array.isArray(data.failures) ? data.failures.map(String) : [];
      const category = failures.some((failure) => gateFailureCategory(failure) === 'PRODUCT_INCOMPLETE') ? '产物不完整' : '质量未达标';
      setMessage(data.result === 'PASS' ? '部署资格已通过。' : `部署资格未通过（${category}）：${failures.map(gateFailureLabel).join('；')}`);
    } catch {}
  }

  async function promote() {
    if (!nextPercent) return;
    try {
      await action('/api/data-lab/deployments', { runtimeBundleId: bundleId, rolloutPercent: nextPercent });
      setMessage(`已进入 ${nextPercent}% 灰度；仅新会话按该比例路由，已有会话保持固定。`);
    } catch {}
  }

  async function saveObservation() {
    if (!active) return;
    try {
      await action(`/api/data-lab/deployments/${active.id}/observation`, observation);
      setMessage('线上观察指标已保存。');
    } catch {}
  }

  async function togglePause() {
    if (!active) return;
    try {
      await action(`/api/data-lab/deployments/${active.id}/pause`, { paused: !paused });
      setMessage(paused ? '已恢复晋级。' : '已暂停晋级；当前流量比例保持不变。');
    } catch {}
  }

  async function rollback() {
    if (!active) return;
    try {
      await action(`/api/data-lab/deployments/${active.id}/rollback`);
      setMessage('已回滚新会话的默认运行组合；此前固定的会话未被切换。');
    } catch {}
  }

  return <section className="rounded-lg border border-hairline bg-canvas p-4">
    <h2 className="font-semibold">灰度部署与回滚</h2>
    <p className="mt-1 text-xs text-muted">部署单位是模型 + Endpoint + Prompt + 合同 + 生成参数组成的运行组合。10% 和 30% 晋级还需要满足线上观察门槛。</p>
    {!deploymentEnabled && <p className="mt-3 border border-warning/40 bg-warning/8 p-3 text-sm text-body-strong"><b>部署变更已由环境开关关闭。</b>可继续查看记录和计算资格，但不能开始灰度、晋级、暂停、保存观察指标或回滚。需运维在环境中启用 <code>ENABLE_MODEL_DEPLOYMENT</code> 并重启服务。</p>}
    <div className="mt-3 grid gap-3 md:grid-cols-[2fr_1fr]">
      <label className="text-sm">候选运行组合<Select value={bundleId} onChange={(event) => setBundleId(event.target.value)} className="mt-1"><option value="">请选择</option>{bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.label}</option>)}</Select></label>
      <div className="border border-info/40 bg-info/8 p-3 text-sm text-body-strong"><div className="text-xs">本次差异</div><b>{change}</b></div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={pending || !bundleId} onClick={calculateGate} className={buttonClass('secondary', 'sm')}>计算部署资格</button>
      <button type="button" disabled={!deploymentEnabled || pending || !bundleId || !nextPercent || paused} onClick={() => setConfirmingDeploy(true)} className={buttonClass('primary', 'sm')}>{nextPercent === 10 ? '开始 10% 灰度' : nextPercent ? `晋级到 ${nextPercent}%` : '已完成 100%'}</button>
      {active && [10, 30].includes(active.rolloutPercent) && <button type="button" disabled={!deploymentEnabled || pending} onClick={togglePause} className={buttonClass('danger', 'sm')}>{paused ? '恢复晋级' : '暂停晋级'}</button>}
      <button type="button" disabled={!deploymentEnabled || pending || !active?.previousModelVersionId} onClick={() => setConfirmingRollback(true)} className={buttonClass('danger', 'sm')}>回滚到{rollbackTarget}</button>
    </div>
    {active && [10, 30].includes(active.rolloutPercent) && <details className="mt-4 rounded-md border border-hairline bg-surface-soft p-3">
      <summary className="cursor-pointer text-sm font-medium">记录 {active.rolloutPercent}% 线上观察指标</summary>
      <p className="mt-1 text-xs text-muted">{active.rolloutPercent}% 灰度已运行 {elapsedHours.toFixed(1)} / {requiredHours} 小时 · 已观察 {observation.sessions} / {requiredSessions} 会话。严重错误会阻断晋级。</p>
      {savedObservation.recordedAt && <p className="mt-1 text-xs text-muted">上次保存：{new Date(savedObservation.recordedAt).toLocaleString('zh-CN')}。再次保存会覆盖上一组指标值，不会清空未修改字段。</p>}
      <div className="mt-3 grid gap-3 md:grid-cols-4">{Object.entries(observation).map(([key, value]) => { const meta = DEPLOYMENT_OBSERVATION_META[key] ?? { label: key, unit: '' }; return <label key={key} className="text-xs font-medium">{meta.label}<span className="ml-1 font-normal text-muted">（{meta.unit}）</span><Input type="number" min="0" max={key === 'sessions' || key === 'criticalErrors' ? undefined : 1} step={key === 'sessions' || key === 'criticalErrors' ? 1 : 0.001} value={value} onChange={(event) => setObservation({ ...observation, [key]: Number(event.target.value) })} className="mt-1" /></label>; })}</div>
      <button type="button" disabled={!deploymentEnabled || pending} onClick={saveObservation} className={buttonClass('secondary', 'sm', 'mt-3')}>覆盖保存观察指标</button>
    </details>}
    {message && <p aria-live="polite" className={`mt-3 text-sm ${/失败|未通过|错误/.test(message) ? 'text-error' : 'text-[#2f7a43]'}`}>{message}</p>}
    <ConfirmDialog open={confirmingDeploy} title={nextPercent === 10 ? '开始灰度部署' : '晋级灰度部署'} description={`当前组合：${current?.label ?? '旧版环境配置'}；候选组合：${selected?.label ?? '未选择'}；变化：${change}。`} consequence={`仅影响部署后新建且尚未固定的会话，其中 ${nextPercent ?? 0}% 使用候选。已固定旧会话不会被静默切换。`} confirmLabel={nextPercent === 10 ? '确认开始 10% 灰度' : `确认晋级到 ${nextPercent}%`} pending={pending} onClose={() => setConfirmingDeploy(false)} onConfirm={async () => { await promote(); setConfirmingDeploy(false); }} />
    <ConfirmDialog open={confirmingRollback} title={`回滚到${rollbackTarget}`} description={legacyDeployment ? '当前为历史模型部署；将恢复上一模型版本供新会话使用。' : `当前组合：${current?.label ?? '未识别'}；将恢复上一运行组合供新会话使用。`} consequence="已固定旧会话继续使用原配置，不会被批量改写；回滚只改变之后的新会话路由。" confirmLabel="确认回滚新会话路由" pending={pending} onClose={() => setConfirmingRollback(false)} onConfirm={async () => { await rollback(); setConfirmingRollback(false); }} />
  </section>;
}
