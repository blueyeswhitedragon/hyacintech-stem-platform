import { redirect } from 'next/navigation';
import CaseGenerationManager from '@/app/components/dataLab/CaseGenerationManager';
import { approvedTopicCardCoverage, calibrationQualityReport, listTutorCases, minTopicCardRequirement, smokeQualityReport, structuralCaseCoverage, trialQualityReport, type TutorCaseProfile } from '@/app/lib/dataLab/bootstrap/service';
import { getCurrentUser } from '@/app/lib/session';
import { ensureDataLabRuntimeRegistry, listRuntimeRolesAndBundles, listPromptPolicies } from '@/app/lib/dataLab/runtimeRegistry';

export default async function CaseGenerationPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  await ensureDataLabRuntimeRegistry(user);
  const [cases, smoke, calibration, trial, topicCoverage, caseCoverage, runtimeData, promptPolicies] = await Promise.all([
    listTutorCases(),
    smokeQualityReport(),
    calibrationQualityReport(),
    trialQualityReport(),
    approvedTopicCardCoverage(),
    structuralCaseCoverage(),
    listRuntimeRolesAndBundles(),
    listPromptPolicies(),
  ]);
  const profiles: TutorCaseProfile[] = ['SMOKE_6', 'CALIBRATION_12', 'TRIAL_36', 'FULL_180', 'EVAL_80'];
  const topicRequirements = Object.fromEntries(profiles.map((profile) => [profile, minTopicCardRequirement(profile)]));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">案例批次</h1>
        <p className="mt-1 text-sm text-muted">从 6 条冒烟验证开始逐级扩产；每一级完成双审并通过质量门禁后，下一层才会解锁。</p>
      </div>
      <CaseGenerationManager
        cases={cases}
        smoke={smoke}
        calibration={calibration}
        trial={trial}
        topicCoverage={topicCoverage}
        caseCoverage={caseCoverage}
        topicRequirements={topicRequirements}
        runtimeBundles={runtimeData.bundles.filter((bundle) => ['AVAILABLE', 'DEPLOYED'].includes(bundle.status)).map((bundle) => ({
          id: bundle.id,
          name: bundle.name,
          version: bundle.version,
          roleKey: bundle.roleKey,
          modelTag: bundle.modelVersion.tag,
          family: bundle.modelVersion.modelFamily,
          endpointName: bundle.endpoint.displayName,
          promptVersion: bundle.promptPolicyVersion.version,
        }))}
        runtimeDefaults={{
          candidateA: runtimeData.roles.find((role) => role.roleKey === 'DATA_LAB_CANDIDATE_A')?.defaultRuntimeBundle?.id ?? null,
          candidateB: runtimeData.roles.find((role) => role.roleKey === 'DATA_LAB_CANDIDATE_B')?.defaultRuntimeBundle?.id ?? null,
        }}
        promptPolicies={promptPolicies.filter((policy) => policy.status === 'APPROVED').map((policy) => ({
          id: policy.id,
          version: policy.version,
          displayName: policy.displayName,
          defaultForDataLab: policy.defaultForDataLab,
        }))}
      />
    </div>
  );
}
