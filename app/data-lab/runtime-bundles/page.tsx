import { redirect } from 'next/navigation';
import RuntimeBundleManager from '@/app/components/dataLab/RuntimeBundleManager';
import {
  ensureDataLabRuntimeRegistry,
  dataLabModelIterationOverview,
  listRuntimeRolesAndBundles,
  runtimeBundleOptions,
} from '@/app/lib/dataLab/runtimeRegistry';
import { getCurrentUser } from '@/app/lib/session';

export default async function RuntimeBundlesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  await ensureDataLabRuntimeRegistry(user);
  const [{ roles, bundles }, options, overview] = await Promise.all([
    listRuntimeRolesAndBundles(),
    runtimeBundleOptions(),
    dataLabModelIterationOverview(),
  ]);
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">运行组合</h1><p className="mt-1 text-sm text-muted">把模型产物、服务 Endpoint、Prompt 策略、合同和生成参数组成一个不可变版本。只有通过实际调用与兼容性评测的组合，才能绑定角色或进入部署。</p><p className="mt-2 border border-warning/40 bg-warning/8 p-3 text-xs leading-5 text-body-strong"><b>角色默认组合只用于后续批次或部署表单预选，不直接获得生产流量。</b>正式 Tutor 的新会话只按通过门禁的 ACTIVE 生产部署切换；Guest 与 Extractor 当前仍使用 .env。</p></header>
    {overview.activeDeployment && <div className="border border-info/40 bg-info/8 p-4 text-sm leading-6 text-body-strong"><b>当前生产路由：</b>{overview.activeDeployment.runtimeBundle ? `${overview.activeDeployment.runtimeBundle.name} v${overview.activeDeployment.runtimeBundle.version} · ${overview.activeDeployment.runtimeBundle.modelVersion.tag}` : `${overview.activeDeployment.modelVersion.tag} · 环境模型基线`} · 灰度 {overview.activeDeployment.rolloutPercent}%</div>}
    <RuntimeBundleManager
      roles={roles.map((role) => ({
        roleKey: role.roleKey,
        displayName: role.displayName,
        description: role.description,
        enabled: role.enabled,
        defaultRuntimeBundle: role.defaultRuntimeBundle,
      }))}
      bundles={bundles.map((bundle) => ({
        id: bundle.id,
        name: bundle.name,
        version: bundle.version,
        status: bundle.status,
        roleKey: bundle.roleKey,
        tutorContractVersion: bundle.tutorContractVersion,
        stageContractVersion: bundle.stageContractVersion,
        extractorVersion: bundle.extractorVersion,
        generationParamsJson: bundle.generationParamsJson,
        compatibilityReportJson: bundle.compatibilityReportJson,
        legacy: bundle.legacy,
        modelVersion: {
          id: bundle.modelVersion.id,
          tag: bundle.modelVersion.tag,
          modelFamily: bundle.modelVersion.modelFamily,
          verificationStatus: bundle.modelVersion.verificationStatus,
          trainedPromptPolicyVersionId: bundle.modelVersion.trainedPromptPolicyVersionId,
        },
        endpoint: {
          id: bundle.endpoint.id,
          displayName: bundle.endpoint.displayName,
          remoteModelId: bundle.endpoint.remoteModelId,
          status: bundle.endpoint.status,
          connection: {
            name: bundle.endpoint.connection.name,
            status: bundle.endpoint.connection.status,
            baseUrl: bundle.endpoint.connection.baseUrl,
          },
        },
        promptPolicyVersion: {
          id: bundle.promptPolicyVersion.id,
          version: bundle.promptPolicyVersion.version,
          displayName: bundle.promptPolicyVersion.displayName,
          status: bundle.promptPolicyVersion.status,
        },
        compatibilityStatus: bundle.promptCompatibilities[0]?.status ?? null,
        counts: {
          traces: bundle._count.generationTraces,
          deployments: bundle._count.deployments,
          evaluations: bundle._count.evaluationsAsA + bundle._count.evaluationsAsB,
        },
      }))}
      options={{
        models: options.models.map((model) => ({ id: model.id, tag: model.tag, modelFamily: model.modelFamily, verificationStatus: model.verificationStatus })),
        endpoints: options.endpoints.map((endpoint) => ({
          id: endpoint.id,
          displayName: endpoint.displayName,
          remoteModelId: endpoint.remoteModelId,
          status: endpoint.status,
          modelVersionId: endpoint.modelVersionId,
          connectionName: endpoint.connection.name,
          connectionStatus: endpoint.connection.status,
        })),
        prompts: options.prompts.map((prompt) => ({
          id: prompt.id,
          version: prompt.version,
          displayName: prompt.displayName,
          status: prompt.status,
          tutorContractVersion: prompt.tutorContractVersion,
          stageContractVersion: prompt.stageContractVersion,
          extractorVersion: prompt.extractorVersion,
        })),
        roles: options.roles.map((role) => ({ roleKey: role.roleKey, displayName: role.displayName })),
      }}
    />
  </div>;
}
