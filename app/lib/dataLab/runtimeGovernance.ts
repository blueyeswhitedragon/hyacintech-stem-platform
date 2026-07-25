import { createHash } from 'crypto';

export const PROVIDER_CONNECTION_STATUSES = ['DRAFT', 'ACTIVE', 'ERROR', 'DISABLED'] as const;
export const PROMPT_POLICY_STATUSES = ['DRAFT', 'CANDIDATE', 'APPROVED', 'SUPERSEDED', 'DISABLED'] as const;
export const RUNTIME_BUNDLE_STATUSES = [
  'DRAFT',
  'PENDING_COMPATIBILITY',
  'COMPATIBLE',
  'INCOMPATIBLE',
  'AVAILABLE',
  'DEPLOYED',
  'DISABLED',
] as const;
export const PROMPT_COMPATIBILITY_STATUSES = ['PENDING', 'PASS', 'FAIL'] as const;

export type ProviderConnectionStatus = (typeof PROVIDER_CONNECTION_STATUSES)[number];
export type PromptPolicyStatus = (typeof PROMPT_POLICY_STATUSES)[number];
export type RuntimeBundleStatus = (typeof RUNTIME_BUNDLE_STATUSES)[number];

export interface PromptPolicyManifest {
  version: string;
  rendererVersion: string;
  visibleStateVersion: string;
  focusPlannerVersion: string;
  semanticValidatorVersion: string;
  fallbackVersion: string;
  contracts: {
    tutor: string;
    stage: string;
    extractor: string;
    extractorPrompt: string;
  };
  sourceCommit: string;
  behaviorSpecSha256: string;
}

export interface RuntimeConsistencyInput {
  roleKey: string;
  model: {
    id: string;
    status: string;
    verificationStatus: string;
    trainedPromptPolicyVersionId?: string | null;
  };
  endpoint: {
    status: string;
    connectionStatus: string;
    modelVersionId?: string | null;
  };
  prompt: {
    id: string;
    status: string;
    tutorContractVersion: string;
    stageContractVersion: string;
    extractorVersion: string;
  };
  contracts: {
    tutor: string;
    stage: string;
    extractor: string;
  };
}

export interface RuntimeConsistencyReport {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  checks: Array<{ code: string; ok: boolean; detail: string }>;
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function promptManifestSha256(manifest: PromptPolicyManifest): string {
  return sha256Text(stableJson(manifest));
}

export function normalizeServiceBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Base URL 必填');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Base URL 必须是完整的 http:// 或 https:// 地址');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Base URL 只支持 http:// 或 https://');
  if (parsed.username || parsed.password) throw new Error('Base URL 不能包含用户名或密码');
  if (parsed.search || parsed.hash) throw new Error('Base URL 不能包含查询参数或锚点');
  return trimmed;
}

export function inferModelFamily(provider: string, remoteModelId: string): string {
  const value = `${provider} ${remoteModelId}`.toLowerCase();
  if (value.includes('qwen')) return 'qwen';
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('gpt') || value.includes('openai')) return 'openai';
  if (value.includes('claude') || value.includes('anthropic')) return 'anthropic';
  if (value.includes('gemini')) return 'gemini';
  return remoteModelId.trim().split(/[/:_-]/)[0]?.toLowerCase() || provider.trim().toLowerCase() || 'unknown';
}

export function evaluateRuntimeConsistency(input: RuntimeConsistencyInput): RuntimeConsistencyReport {
  const checks: RuntimeConsistencyReport['checks'] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const add = (code: string, ok: boolean, detail: string, severity: 'BLOCK' | 'WARN' = 'BLOCK') => {
    checks.push({ code, ok, detail });
    if (!ok) (severity === 'BLOCK' ? blockers : warnings).push(detail);
  };

  add('ROLE_PRESENT', Boolean(input.roleKey.trim()), '请选择运行组合的用途角色');
  add('MODEL_ACTIVE', !['RETIRED', 'BLOCKED'].includes(input.model.status), '模型产物已停用或被阻断');
  add('ENDPOINT_ACTIVE', input.endpoint.status === 'ACTIVE', '服务 Endpoint 尚未启用或连接测试未通过');
  add('CONNECTION_ACTIVE', input.endpoint.connectionStatus === 'ACTIVE', 'AI 服务连接当前不可用');
  add(
    'ENDPOINT_MODEL_MATCH',
    !input.endpoint.modelVersionId || input.endpoint.modelVersionId === input.model.id,
    'Endpoint 已绑定到另一个模型产物，请重新选择或修正关联',
  );
  add('PROMPT_APPROVED', input.prompt.status === 'APPROVED', 'Prompt 策略尚未批准用于新运行组合');
  add(
    'TUTOR_CONTRACT_MATCH',
    input.contracts.tutor === input.prompt.tutorContractVersion,
    `Tutor 合同不一致：组合为 ${input.contracts.tutor}，Prompt 要求 ${input.prompt.tutorContractVersion}`,
  );
  add(
    'STAGE_CONTRACT_MATCH',
    input.contracts.stage === input.prompt.stageContractVersion,
    `Stage 合同不一致：组合为 ${input.contracts.stage}，Prompt 要求 ${input.prompt.stageContractVersion}`,
  );
  add(
    'EXTRACTOR_CONTRACT_MATCH',
    input.contracts.extractor === input.prompt.extractorVersion,
    `Extractor 版本不一致：组合为 ${input.contracts.extractor}，Prompt 要求 ${input.prompt.extractorVersion}`,
  );
  add(
    'MODEL_LINEAGE_VERIFIED',
    input.model.verificationStatus !== 'LEGACY_UNVERIFIED',
    '模型权重身份仍是“历史待核验”，组合可保存但不能直接部署',
    'WARN',
  );
  if (input.model.trainedPromptPolicyVersionId && input.model.trainedPromptPolicyVersionId !== input.prompt.id) {
    add(
      'TRAINED_PROMPT_CHANGED',
      false,
      '当前 Prompt 与训练时 Prompt 不同，必须完成独立兼容性评测',
      'WARN',
    );
  }
  return { ok: blockers.length === 0, blockers, warnings, checks };
}

export function runtimeBundleChangeSummary(current: {
  modelVersionId: string;
  endpointId: string;
  promptPolicyVersionId: string;
} | null, candidate: {
  modelVersionId: string;
  endpointId: string;
  promptPolicyVersionId: string;
}) {
  if (!current) return { kind: 'INITIAL_DEPLOYMENT', modelChanged: true, promptChanged: true, endpointChanged: true };
  const modelChanged = current.modelVersionId !== candidate.modelVersionId;
  const promptChanged = current.promptPolicyVersionId !== candidate.promptPolicyVersionId;
  const endpointChanged = current.endpointId !== candidate.endpointId;
  const kind = modelChanged && promptChanged
    ? 'MODEL_AND_PROMPT'
    : modelChanged
      ? 'MODEL_ONLY'
      : promptChanged
        ? 'PROMPT_ONLY'
        : endpointChanged
          ? 'ENDPOINT_MIGRATION'
          : 'NO_RUNTIME_CHANGE';
  return { kind, modelChanged, promptChanged, endpointChanged };
}
