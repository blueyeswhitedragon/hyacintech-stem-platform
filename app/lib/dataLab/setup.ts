import 'server-only';
import { db } from '@/app/lib/db';
import { validateConfig } from '@/app/lib/llm/provider';

function configuredSecret(value: string | undefined) {
  const secret = value?.trim() ?? '';
  return secret.length >= 32 && !/please-change|change-me|placeholder/i.test(secret);
}

export async function getDataLabSetupStatus() {
  const llm = validateConfig();
  const [adminCount, modelCount, serviceCount] = await Promise.all([
    db.user.count({ where: { role: 'admin', isActive: true } }),
    db.modelVersion.count(),
    db.providerConnection.count({
      where: {
        status: 'ACTIVE',
        lastTestStatus: 'PASS',
        endpoints: { some: { status: 'ACTIVE', lastTestStatus: 'PASS' } },
      },
    }),
  ]);
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 0);
  const checks = {
    database: true,
    sessionSecret: configuredSecret(process.env.SESSION_SECRET),
    provider: llm.valid,
    timeout: Number.isFinite(timeoutMs) && timeoutMs >= 180_000,
    credentialMaster: configuredSecret(process.env.DATA_LAB_CREDENTIAL_MASTER_KEY),
    administrator: adminCount > 0,
    runtimeModel: modelCount > 0,
    aiService: serviceCount > 0,
  };
  return { checks, allReady: Object.values(checks).every(Boolean), providerIssues: llm.issues };
}
