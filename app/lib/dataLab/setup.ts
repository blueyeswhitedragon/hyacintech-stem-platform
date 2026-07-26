import 'server-only';
import { db } from '@/app/lib/db';
import { validateConfig } from '@/app/lib/llm/provider';
import { getRuntimeModelIdentity } from '@/app/lib/modelRegistry';
import { evaluateSetupReadiness } from '@/app/lib/dataLab/setupStatus';

export async function getDataLabSetupStatus() {
  const llm = validateConfig();
  const runtimeIdentity = getRuntimeModelIdentity();
  const [adminCount, runtimeModel, serviceCount, encryptedCredentialCount, activeDeployment] = await Promise.all([
    db.user.count({ where: { role: 'admin', isActive: true } }),
    runtimeIdentity
      ? db.modelVersion.findUnique({ where: { tag: runtimeIdentity.tag }, select: { id: true } })
      : Promise.resolve(null),
    db.providerConnection.count({
      where: {
        status: 'ACTIVE',
        lastTestStatus: 'PASS',
        endpoints: { some: { status: 'ACTIVE', lastTestStatus: 'PASS' } },
      },
    }),
    db.providerCredential.count({ where: { sourceType: 'ENCRYPTED_DB' } }),
    db.modelDeployment.findFirst({
      where: { environment: 'PRODUCTION', status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        rolloutPercent: true,
        modelVersion: { select: { tag: true } },
        runtimeBundle: { select: { id: true, name: true, version: true } },
      },
    }),
  ]);
  return {
    ...evaluateSetupReadiness({
      llm,
      sessionSecret: process.env.SESSION_SECRET,
      timeoutValue: process.env.LLM_TIMEOUT_MS,
      credentialMaster: process.env.DATA_LAB_CREDENTIAL_MASTER_KEY,
      encryptedCredentialCount,
      administratorCount: adminCount,
      runtimeModelRegistered: Boolean(runtimeModel),
      activeProductionDeployment: Boolean(activeDeployment),
      testedAiServiceCount: serviceCount,
    }),
    providerIssues: llm.issues,
    activeDeployment,
  };
}
