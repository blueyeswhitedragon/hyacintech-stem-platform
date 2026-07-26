import type { ConfigValidation } from '@/app/lib/llm/types';

export function configuredSecret(value: string | undefined) {
  const secret = value?.trim() ?? '';
  return secret.length >= 32 && !/please-change|change-me|placeholder/i.test(secret);
}

export function effectiveTutorTimeoutMs(value: string | undefined) {
  if (value === undefined || value.trim() === '') return 180_000;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export interface SetupReadinessInput {
  llm: ConfigValidation;
  sessionSecret: string | undefined;
  timeoutValue: string | undefined;
  credentialMaster: string | undefined;
  encryptedCredentialCount: number;
  administratorCount: number;
  runtimeModelRegistered: boolean;
  activeProductionDeployment: boolean;
  testedAiServiceCount: number;
}

export function evaluateSetupReadiness(input: SetupReadinessInput) {
  const effectiveTimeoutMs = effectiveTutorTimeoutMs(input.timeoutValue);
  const credentialMasterRequired = input.encryptedCredentialCount > 0;
  const checks = {
    database: true,
    sessionSecret: configuredSecret(input.sessionSecret),
    provider: input.llm.valid,
    timeout: effectiveTimeoutMs >= 180_000,
    credentialMaster: !credentialMasterRequired || configuredSecret(input.credentialMaster),
    administrator: input.administratorCount > 0,
    runtimeModel: input.runtimeModelRegistered,
    productionDeployment: input.activeProductionDeployment,
    aiService: input.testedAiServiceCount > 0,
  };
  const teachingReady = [
    checks.database,
    checks.sessionSecret,
    checks.provider,
    checks.timeout,
    checks.runtimeModel,
    checks.productionDeployment,
  ].every(Boolean);
  const dataLabReady = teachingReady
    && checks.credentialMaster
    && checks.administrator
    && checks.aiService;
  return {
    checks,
    teachingReady,
    dataLabReady,
    allReady: dataLabReady,
    effectiveTimeoutMs,
    credentialMasterRequired,
  };
}
