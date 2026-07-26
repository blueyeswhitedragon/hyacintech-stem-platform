import { redirect } from 'next/navigation';
import PromptPolicyManager from '@/app/components/dataLab/PromptPolicyManager';
import {
  ensureDataLabRuntimeRegistry,
  listPromptPolicies,
} from '@/app/lib/dataLab/runtimeRegistry';
import { getCurrentUser } from '@/app/lib/session';

export default async function PromptPoliciesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  await ensureDataLabRuntimeRegistry(user);
  const policies = await listPromptPolicies();
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">Prompt 策略</h1><p className="mt-1 text-sm text-muted">这里管理动态注入机制及其合同，不管理模型密钥。批准策略后，可把它与模型产物和 Endpoint 组成运行组合；旧版本永远不会被覆盖。</p></header>
    <PromptPolicyManager policies={policies.map((policy) => ({
      id: policy.id,
      version: policy.version,
      displayName: policy.displayName,
      status: policy.status,
      revision: policy.revision,
      builtIn: policy.builtIn,
      defaultForDataLab: policy.defaultForDataLab,
      rendererVersion: policy.rendererVersion,
      visibleStateVersion: policy.visibleStateVersion,
      focusPlannerVersion: policy.focusPlannerVersion,
      semanticValidatorVersion: policy.semanticValidatorVersion,
      fallbackVersion: policy.fallbackVersion,
      tutorContractVersion: policy.tutorContractVersion,
      stageContractVersion: policy.stageContractVersion,
      extractorVersion: policy.extractorVersion,
      extractorPromptVersion: policy.extractorPromptVersion,
      sourceCommit: policy.sourceCommit,
      manifestSha256: policy.manifestSha256,
      manifestJson: policy.manifestJson,
      compatibilityJson: policy.compatibilityJson,
      createdAt: policy.createdAt.toISOString(),
      approvedAt: policy.approvedAt?.toISOString() ?? null,
      revisionOf: policy.revisionOf,
      counts: {
        cases: policy._count.cases,
        trainingRuns: policy._count.trainingRuns,
        runtimeBundles: policy._count.runtimeBundles,
        trainedModels: policy._count.trainedModels,
      },
    }))} />
  </div>;
}
