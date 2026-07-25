import { redirect } from 'next/navigation';
import RuntimeBundleManager from '@/app/components/dataLab/RuntimeBundleManager';
import {
  ensureDataLabRuntimeRegistry,
  listRuntimeRolesAndBundles,
  runtimeBundleOptions,
} from '@/app/lib/dataLab/runtimeRegistry';
import { getCurrentUser } from '@/app/lib/session';

export default async function RuntimeBundlesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  await ensureDataLabRuntimeRegistry(user);
  const [{ roles, bundles }, options] = await Promise.all([
    listRuntimeRolesAndBundles(),
    runtimeBundleOptions(),
  ]);
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">运行组合</h1><p className="mt-1 text-sm text-gray-500">把模型产物、服务 Endpoint、Prompt 策略、合同和生成参数组成一个不可变版本。只有通过实际调用与兼容性评测的组合，才能绑定角色或进入部署。</p></header>
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
