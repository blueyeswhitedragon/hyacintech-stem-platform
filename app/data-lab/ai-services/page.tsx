import { redirect } from 'next/navigation';
import AIServiceManager from '@/app/components/dataLab/AIServiceManager';
import { listModelVersions } from '@/app/lib/modelRegistry';
import { listProviderConnections } from '@/app/lib/dataLab/runtimeRegistry';
import { configuredSecret } from '@/app/lib/dataLab/setupStatus';
import { getCurrentUser } from '@/app/lib/session';

export default async function AiServicesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const [connections, models] = await Promise.all([listProviderConnections(), listModelVersions()]);
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">AI 服务</h1><p className="mt-1 text-sm text-muted">这里管理“去哪里调用模型”和安全凭据。连接可用后，登记 Endpoint；下一步到“运行组合”把 Endpoint 与模型产物、Prompt 和合同配成可评测方案。</p></header>
    <div className="border border-info/40 bg-info/8 p-4 text-sm leading-6 text-body-strong">这里登记的连接直接供 Data Lab 案例生成、评测及已部署的正式 Tutor RuntimeBundle 使用。<b>Guest、Extractor、话题卡编译、报告评分和环境基线仍读取 <code>.env</code></b>；正式 Tutor 只有在组合通过门禁并形成 ACTIVE 部署后才切换。</div>
    <AIServiceManager
      connections={connections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        protocol: connection.protocol,
        baseUrl: connection.baseUrl,
        status: connection.status,
        lastTestStatus: connection.lastTestStatus,
        lastTestedAt: connection.lastTestedAt?.toISOString() ?? null,
        lastLatencyMs: connection.lastLatencyMs,
        lastErrorMessage: connection.lastErrorMessage,
        credential: connection.credential ? {
          sourceType: connection.credential.sourceType,
          envVarName: connection.credential.envVarName,
          keyLastFour: connection.credential.keyLastFour,
        } : null,
        endpoints: connection.endpoints.map((endpoint) => ({
          id: endpoint.id,
          displayName: endpoint.displayName,
          remoteModelId: endpoint.remoteModelId,
          status: endpoint.status,
          modelVersionId: endpoint.modelVersionId,
          runtimeBundleCount: endpoint._count.runtimeBundles,
        })),
        endpointCount: connection._count.endpoints,
        runtimeBundleCount: connection.runtimeBundleCount,
      }))}
      models={models.map((model) => ({ id: model.id, tag: model.tag }))}
      encryptedCredentialAvailable={configuredSecret(process.env.DATA_LAB_CREDENTIAL_MASTER_KEY)}
    />
  </div>;
}
