'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Dialog, { ConfirmDialog } from './Dialog';

interface EndpointItem {
  id: string;
  displayName: string;
  remoteModelId: string;
  status: string;
  modelVersionId: string | null;
  runtimeBundleCount: number;
}

interface ConnectionItem {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  status: string;
  lastTestStatus: string;
  lastTestedAt: string | null;
  lastLatencyMs: number | null;
  lastErrorMessage: string;
  credential: {
    sourceType: string;
    envVarName: string;
    keyLastFour: string;
  } | null;
  endpoints: EndpointItem[];
  endpointCount: number;
  runtimeBundleCount: number;
}

interface ModelOption {
  id: string;
  tag: string;
}

const GROUPS = [
  ['ACTIVE', '可用'],
  ['ERROR', '连接异常'],
  ['DRAFT', '待测试'],
  ['DISABLED', '已停用'],
] as const;

export default function AIServiceManager({
  connections,
  models,
}: {
  connections: ConnectionItem[];
  models: ModelOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionItem | null>(null);
  const [credentialTarget, setCredentialTarget] = useState<ConnectionItem | null>(null);
  const [endpointTarget, setEndpointTarget] = useState<ConnectionItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConnectionItem | null>(null);
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({});
  const grouped = useMemo(
    () => Object.fromEntries(GROUPS.map(([status]) => [status, connections.filter((item) => item.status === status)])),
    [connections],
  );

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

  async function create(formData: FormData) {
    await call('/api/data-lab/ai-services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(formData.get('name') ?? ''),
        protocol: String(formData.get('protocol') ?? 'OPENAI_COMPATIBLE'),
        baseUrl: String(formData.get('baseUrl') ?? ''),
        credentialSource: String(formData.get('credentialSource') ?? 'ENV'),
        envVarName: String(formData.get('envVarName') ?? ''),
        apiKey: String(formData.get('apiKey') ?? ''),
      }),
    }, '服务连接已登记；请继续执行“测试连接”。');
    setCreateOpen(false);
  }

  async function test(connection: ConnectionItem, showModels = false) {
    const data = await call(`/api/data-lab/ai-services/${connection.id}/test`, { method: 'POST' }, '连接测试通过，服务已启用。');
    if (showModels) setAvailableModels((current) => ({ ...current, [connection.id]: data.modelIds ?? [] }));
  }

  async function updateConnection(formData: FormData) {
    if (!editing) return;
    await call(`/api/data-lab/ai-services/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(formData.get('name') ?? ''),
        baseUrl: String(formData.get('baseUrl') ?? ''),
      }),
    }, '连接信息已更新，需要重新测试后才能使用。');
    setEditing(null);
  }

  async function updateCredential(formData: FormData) {
    if (!credentialTarget) return;
    await call(`/api/data-lab/ai-services/${credentialTarget.id}/credential`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentialSource: String(formData.get('credentialSource') ?? 'ENV'),
        envVarName: String(formData.get('envVarName') ?? ''),
        apiKey: String(formData.get('apiKey') ?? ''),
      }),
    }, '访问密钥已更新；旧密钥不可查看，请重新测试连接。');
    setCredentialTarget(null);
  }

  async function createEndpoint(formData: FormData) {
    if (!endpointTarget) return;
    await call(`/api/data-lab/ai-services/${endpointTarget.id}/endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: String(formData.get('displayName') ?? ''),
        remoteModelId: String(formData.get('remoteModelId') ?? ''),
        modelVersionId: String(formData.get('modelVersionId') ?? '') || undefined,
      }),
    }, '模型 Endpoint 已登记，可在运行组合中选择。');
    setEndpointTarget(null);
  }

  async function stateAction(connection: ConnectionItem, action: 'DISABLE' | 'ENABLE') {
    await call(`/api/data-lab/ai-services/${connection.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }, action === 'DISABLE' ? '服务连接已停用，历史引用保留。' : '服务连接已恢复到待测试状态。');
  }

  async function remove() {
    if (!deleteTarget) return;
    await call(`/api/data-lab/ai-services/${deleteTarget.id}`, { method: 'DELETE' }, '未使用的草稿连接已删除。');
    setDeleteTarget(null);
  }

  return <div className="space-y-6">
    <section className="flex flex-wrap items-start justify-between gap-4 border bg-white p-5">
      <div><h2 className="font-semibold">服务连接</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">先登记 Base URL 与安全凭据，再测试连接并登记远程 model ID。密钥不会在页面、API 响应或日志中明文返回。</p></div>
      <button onClick={() => setCreateOpen(true)} className="bg-gray-950 px-4 py-2 text-sm text-white">新增服务连接</button>
    </section>

    {feedback && <p aria-live="polite" className={`border p-3 text-sm ${feedback.tone === 'success' ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>{feedback.text}</p>}

    {GROUPS.map(([status, label]) => <section key={status} className="space-y-3">
      <h2 className="font-semibold">{label}（{grouped[status]?.length ?? 0}）</h2>
      {(grouped[status] ?? []).map((connection) => <article key={connection.id} className="border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-xs text-gray-500">{connection.protocol} · {connection.credential?.sourceType === 'ENV' ? `环境变量 ${connection.credential.envVarName}` : '数据库加密凭据'}{connection.credential?.keyLastFour ? ` · 末四位 ${connection.credential.keyLastFour}` : ''}</div><h3 className="mt-1 font-semibold">{connection.name}</h3><p className="mt-1 break-all text-sm text-gray-700">{connection.baseUrl}</p></div>
          <span className={`px-2 py-1 text-xs ${status === 'ACTIVE' ? 'bg-green-100 text-green-800' : status === 'ERROR' ? 'bg-red-100 text-red-800' : 'bg-gray-100'}`}>{label}</span>
        </div>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <div className="border bg-gray-50 p-3"><b>最近连接测试</b><p className="mt-1 text-gray-600">{connection.lastTestedAt ? new Date(connection.lastTestedAt).toLocaleString('zh-CN') : '尚未测试'}{connection.lastLatencyMs !== null ? ` · ${connection.lastLatencyMs} ms` : ''}</p></div>
          <div className="border bg-gray-50 p-3"><b>Endpoint</b><p className="mt-1 text-gray-600">{connection.endpointCount} 个已登记</p></div>
          <div className="border bg-gray-50 p-3"><b>运行组合引用</b><p className="mt-1 text-gray-600">{connection.runtimeBundleCount} 个</p></div>
        </div>
        {connection.lastErrorMessage && <div className="mt-3 border border-red-200 bg-red-50 p-3 text-xs text-red-900"><b>为什么不能继续：</b>{connection.lastErrorMessage}<p className="mt-1">修复路径：核对连接信息与访问密钥，再重新测试服务可用性。</p></div>}
        {connection.endpoints.length > 0 && <details className="mt-3 border p-3"><summary className="cursor-pointer text-sm font-medium">查看已登记模型（{connection.endpoints.length}）</summary><div className="mt-3 space-y-2">{connection.endpoints.map((endpoint) => <div key={endpoint.id} className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 p-2 text-xs"><span><b>{endpoint.displayName}</b> · {endpoint.remoteModelId}{endpoint.modelVersionId ? ' · 已关联模型产物' : ' · 尚未关联模型产物'}</span><span>{endpoint.runtimeBundleCount} 个组合引用</span></div>)}</div></details>}
        {availableModels[connection.id] && <div className="mt-3 border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950"><b>服务返回的可用 model ID：</b><p className="mt-1 break-words">{availableModels[connection.id].join('、') || '服务可访问，但没有返回模型列表；可手工登记 model ID。'}</p><p className="mt-1">下一步：将需要在平台使用的 model ID 登记为 Endpoint。</p></div>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={pending || status === 'DISABLED'} onClick={() => test(connection)} className="bg-blue-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">测试连接</button>
          <button disabled={pending || status === 'DISABLED'} onClick={() => test(connection, true)} className="border border-blue-500 px-3 py-1.5 text-xs text-blue-700 disabled:opacity-40">查看可用模型</button>
          <button onClick={() => setEditing(connection)} className="border px-3 py-1.5 text-xs">编辑连接信息</button>
          <button onClick={() => setCredentialTarget(connection)} className="border px-3 py-1.5 text-xs">更新访问密钥</button>
          <button disabled={status !== 'ACTIVE'} onClick={() => setEndpointTarget(connection)} className="border px-3 py-1.5 text-xs disabled:opacity-40">关联可用模型</button>
          {status !== 'DISABLED' ? <button onClick={() => stateAction(connection, 'DISABLE')} className="border border-red-500 px-3 py-1.5 text-xs text-red-700">停用服务连接</button> : <button onClick={() => stateAction(connection, 'ENABLE')} className="bg-green-700 px-3 py-1.5 text-xs text-white">重新启用</button>}
          {connection.endpointCount === 0 && <button onClick={() => setDeleteTarget(connection)} className="border border-red-500 px-3 py-1.5 text-xs text-red-700">删除未使用连接</button>}
        </div>
      </article>)}
      {(grouped[status]?.length ?? 0) === 0 && <p className="border bg-white p-4 text-sm text-gray-500">当前没有{label}的服务连接。</p>}
    </section>)}

    <Dialog open={createOpen} title="新增服务连接" description="按“连接身份 → 地址 → 凭据 → 保存”登记。保存不会自动调用外部服务。" onClose={() => !pending && setCreateOpen(false)} maxWidth="max-w-2xl">
      <ServiceForm pending={pending} onSubmit={create} submitLabel="登记服务连接" />
    </Dialog>
    <Dialog open={Boolean(editing)} title="编辑连接信息" description="修改后连接会回到待测试状态，现有历史记录不变。" onClose={() => !pending && setEditing(null)}>
      {editing && <form action={updateConnection} className="space-y-3"><label className="block text-sm">显示名称<input name="name" required defaultValue={editing.name} className="mt-1 w-full border px-3 py-2" /></label><label className="block text-sm">Base URL<input name="baseUrl" required defaultValue={editing.baseUrl} className="mt-1 w-full border px-3 py-2" /></label><button disabled={pending} className="bg-gray-950 px-4 py-2 text-sm text-white">保存连接信息</button></form>}
    </Dialog>
    <Dialog open={Boolean(credentialTarget)} title="更新访问密钥" description="系统不会展示旧密钥。保存后必须重新测试连接。" onClose={() => !pending && setCredentialTarget(null)}>
      <CredentialFields pending={pending} action={updateCredential} submitLabel="更新访问密钥" />
    </Dialog>
    <Dialog open={Boolean(endpointTarget)} title="关联可用模型" description="登记远程 model ID，并可选关联一个不可变模型产物。" onClose={() => !pending && setEndpointTarget(null)}>
      <form action={createEndpoint} className="space-y-3">
        <label className="block text-sm">Endpoint 显示名称<input name="displayName" required placeholder="Qwen STEM 推理端点" className="mt-1 w-full border px-3 py-2" /></label>
        <label className="block text-sm">远程 model ID<input name="remoteModelId" required placeholder="Qwen3.5-35B-A3B" className="mt-1 w-full border px-3 py-2" /></label>
        <label className="block text-sm">关联模型产物（可稍后设置）<select name="modelVersionId" className="mt-1 w-full border px-3 py-2"><option value="">暂不关联</option>{models.map((model) => <option key={model.id} value={model.id}>{model.tag}</option>)}</select></label>
        <button disabled={pending} className="bg-gray-950 px-4 py-2 text-sm text-white">登记模型 Endpoint</button>
      </form>
    </Dialog>
    <ConfirmDialog open={Boolean(deleteTarget)} title="删除未使用连接" description={`将永久删除连接“${deleteTarget?.name ?? ''}”及其凭据记录。`} consequence="仅无 Endpoint 引用的连接允许删除。此操作不能撤销。" confirmLabel="确认删除" danger pending={pending} onClose={() => setDeleteTarget(null)} onConfirm={remove} />
  </div>;
}

function ServiceForm({ pending, onSubmit, submitLabel }: { pending: boolean; onSubmit: (data: FormData) => void; submitLabel: string }) {
  return <form action={onSubmit} className="space-y-4">
    <div className="grid gap-2 text-xs sm:grid-cols-4"><span className="border-b-2 border-gray-900 pb-2">1. 连接身份</span><span className="border-b-2 border-gray-300 pb-2">2. 服务地址</span><span className="border-b-2 border-gray-300 pb-2">3. 安全凭据</span><span className="border-b-2 border-gray-300 pb-2">4. 保存</span></div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">显示名称<input name="name" required placeholder="校内 Qwen 推理服务" className="mt-1 w-full border px-3 py-2" /></label><label className="text-sm">协议<select name="protocol" className="mt-1 w-full border px-3 py-2"><option value="OPENAI_COMPATIBLE">OpenAI Compatible</option><option value="DEEPSEEK_COMPATIBLE">DeepSeek Compatible</option></select></label></div>
    <label className="block text-sm">Base URL<input name="baseUrl" required placeholder="https://llm.example.edu/v1" className="mt-1 w-full border px-3 py-2" /><span className="mt-1 block text-xs text-gray-500">填写 API 根地址，不要包含 /chat/completions，不要在地址中写密钥。</span></label>
    <CredentialFields pending={pending} submitLabel={submitLabel} embedded />
  </form>;
}

function CredentialFields({ pending, action, submitLabel, embedded = false }: { pending: boolean; action?: (data: FormData) => void; submitLabel: string; embedded?: boolean }) {
  const [source, setSource] = useState('ENV');
  const fields = <><label className="block text-sm">密钥来源<select name="credentialSource" value={source} onChange={(event) => setSource(event.target.value)} className="mt-1 w-full border px-3 py-2"><option value="ENV">环境变量引用</option><option value="ENCRYPTED_DB">数据库加密凭据</option></select></label>{source === 'ENV' ? <label className="block text-sm">环境变量名称<input name="envVarName" required placeholder="QWEN_API_KEY" className="mt-1 w-full border px-3 py-2" /></label> : <label className="block text-sm">新访问密钥<input name="apiKey" type="password" required autoComplete="new-password" className="mt-1 w-full border px-3 py-2" /><span className="mt-1 block text-xs text-gray-500">使用服务器主密钥 AES-GCM 加密；保存后不可查看。</span></label>}<button disabled={pending} className="bg-gray-950 px-4 py-2 text-sm text-white">{submitLabel}</button></>;
  return embedded ? fields : <form action={action} className="space-y-3">{fields}</form>;
}
