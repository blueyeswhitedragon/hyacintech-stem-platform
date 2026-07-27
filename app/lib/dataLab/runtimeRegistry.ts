// Server entrypoint: only route handlers and Server Components import this module.
import { createHash } from 'crypto';
import { db } from '@/app/lib/db';
import type { SessionUser } from '@/app/lib/session';
import {
  DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION,
  sanitizeTutorVisibleFacts,
  TUTOR_BEHAVIOR_SPEC,
  TUTOR_BEHAVIOR_SPEC_V2_3,
  TUTOR_LANGUAGE_CONTRACT_VERSION,
  TUTOR_LANGUAGE_PROMPT_V1,
  TUTOR_LANGUAGE_PROMPT_V2_3,
  TUTOR_LANGUAGE_PROMPT_VERSIONS,
  TUTOR_SEMANTIC_VALIDATOR_VERSION,
  buildTutorLanguagePrompt,
  type TutorLanguagePromptVersion,
} from '@/app/lib/tutorLanguage';
import {
  EXTRACTOR_PROMPT_VERSION,
  EXTRACTOR_VERSION,
} from '@/app/lib/stateExtractor';
import { STAGE_CONTRACT_VERSION } from '@/app/lib/stageContract';
import {
  credentialLastFourForEnv,
  encryptProviderCredential,
  resolveProviderCredential,
} from './providerCredentials';
import {
  evaluateRuntimeConsistency,
  inferModelFamily,
  normalizeServiceBaseUrl,
  promptManifestSha256,
  sha256Text,
  type PromptPolicyManifest,
} from './runtimeGovernance';
import { parseLlmJsonObject } from '@/app/lib/llm/jsonRepair';

const BUILT_IN_PROMPTS = [
  {
    version: TUTOR_LANGUAGE_PROMPT_V1,
    displayName: 'Tutor Prompt V1（当前生产）',
    behaviorSpec: TUTOR_BEHAVIOR_SPEC,
    defaultForDataLab: false,
  },
  {
    version: TUTOR_LANGUAGE_PROMPT_V2_3,
    displayName: 'Tutor Prompt V2.3（Data Lab）',
    behaviorSpec: TUTOR_BEHAVIOR_SPEC_V2_3,
    defaultForDataLab: true,
  },
] as const;

const INITIAL_RUNTIME_ROLES = [
  ['FORMAL_TUTOR', '正式 Tutor', '正式 Tutor 的部署候选；实际流量由 ACTIVE 生产部署控制'],
  ['GUEST_TUTOR', '体验模式 Tutor', '预留的体验模式候选；当前 Guest 运行仍由 .env 控制'],
  ['EXTRACTOR', 'Extractor', '提取器候选登记；当前运行仍由 .env 控制'],
  ['DATA_LAB_CANDIDATE_A', 'Data Lab 候选 A', '双候选数据生产的候选 A'],
  ['DATA_LAB_CANDIDATE_B', 'Data Lab 候选 B', '双候选数据生产的候选 B'],
  ['CRITIC', 'Critic', '候选输出的交叉检查'],
  ['AI_CURATOR', 'AI Curator', '平台内 AI 初审草稿'],
  ['SIMULATED_STUDENT', '模拟学生', '离线六阶段评测的学生模拟器'],
] as const;

function sourceCommit(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.trim()
    || process.env.GIT_COMMIT_SHA?.trim()
    || 'working-tree';
}

function manifestForPrompt(input: typeof BUILT_IN_PROMPTS[number]): PromptPolicyManifest {
  return {
    version: input.version,
    rendererVersion: `tutor-renderer:${input.version}`,
    visibleStateVersion: 'tutor-visible-state-v2',
    focusPlannerVersion: 'server-focus-planner-v2',
    semanticValidatorVersion: TUTOR_SEMANTIC_VALIDATOR_VERSION,
    fallbackVersion: 'deterministic-tutor-fallback-v2',
    contracts: {
      tutor: TUTOR_LANGUAGE_CONTRACT_VERSION,
      stage: STAGE_CONTRACT_VERSION,
      extractor: EXTRACTOR_VERSION,
      extractorPrompt: EXTRACTOR_PROMPT_VERSION,
    },
    sourceCommit: sourceCommit(),
    behaviorSpecSha256: sha256Text(input.behaviorSpec),
  };
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function truncateError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
}

async function audit(actorId: string, action: string, entityType: string, entityId: string, payload: unknown = {}) {
  await db.dataLabAuditLog.create({
    data: { actorId, action, entityType, entityId, payloadJson: JSON.stringify(payload) },
  });
}

export async function ensureDataLabRuntimeRegistry(user?: Pick<SessionUser, 'id'>) {
  for (const definition of BUILT_IN_PROMPTS) {
    const manifest = manifestForPrompt(definition);
    const existing = await db.promptPolicyVersion.findUnique({ where: { version: definition.version } });
    if (existing) {
      const saved = parseObject(existing.manifestJson);
      if (saved.behaviorSpecSha256 !== manifest.behaviorSpecSha256
        || existing.rendererVersion !== manifest.rendererVersion
        || existing.tutorContractVersion !== manifest.contracts.tutor
        || existing.stageContractVersion !== manifest.contracts.stage
        || existing.extractorVersion !== manifest.contracts.extractor) {
        throw new Error(`内置 Prompt ${definition.version} 的代码内容已变化；请创建新版本，不能覆盖历史策略`);
      }
      continue;
    }
    await db.promptPolicyVersion.create({
      data: {
        version: definition.version,
        displayName: definition.displayName,
        status: 'APPROVED',
        rendererVersion: manifest.rendererVersion,
        visibleStateVersion: manifest.visibleStateVersion,
        focusPlannerVersion: manifest.focusPlannerVersion,
        semanticValidatorVersion: manifest.semanticValidatorVersion,
        fallbackVersion: manifest.fallbackVersion,
        tutorContractVersion: manifest.contracts.tutor,
        stageContractVersion: manifest.contracts.stage,
        extractorVersion: manifest.contracts.extractor,
        extractorPromptVersion: manifest.contracts.extractorPrompt,
        sourceCommit: manifest.sourceCommit,
        manifestJson: JSON.stringify(manifest),
        manifestSha256: promptManifestSha256(manifest),
        compatibilityJson: JSON.stringify({
          supportedPhases: [1, 2, 3, 4, 5, 6],
          outputContract: TUTOR_LANGUAGE_CONTRACT_VERSION,
        }),
        builtIn: true,
        defaultForDataLab: definition.defaultForDataLab,
        approvedAt: new Date(),
        createdById: user?.id,
        approvedById: user?.id,
      },
    });
  }
  for (const [roleKey, displayName, description] of INITIAL_RUNTIME_ROLES) {
    await db.runtimeRoleBinding.upsert({
      where: { roleKey },
      update: { displayName, description },
      create: { roleKey, displayName, description },
    });
  }
}

export async function listPromptPolicies() {
  return db.promptPolicyVersion.findMany({
    orderBy: [{ defaultForDataLab: 'desc' }, { createdAt: 'desc' }],
    include: {
      revisionOf: { select: { id: true, version: true } },
      createdBy: { select: { displayName: true } },
      approvedBy: { select: { displayName: true } },
      _count: {
        select: {
          cases: true,
          trainingRuns: true,
          runtimeBundles: true,
          trainedModels: true,
        },
      },
    },
  });
}

export async function createPromptPolicyRevision(input: {
  sourceId: string;
  version: string;
  displayName?: string;
  user: SessionUser;
}) {
  const source = await db.promptPolicyVersion.findUnique({ where: { id: input.sourceId } });
  if (!source) throw new Error('来源 Prompt 策略不存在');
  const version = input.version.trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/i.test(version)) throw new Error('新版本号格式不合法');
  const manifest = {
    ...parseObject(source.manifestJson),
    version,
    sourceCommit: sourceCommit(),
    revisionOf: source.version,
  };
  const created = await db.promptPolicyVersion.create({
    data: {
      version,
      displayName: input.displayName?.trim() || `${source.displayName} 修订`,
      status: 'DRAFT',
      revision: source.revision + 1,
      revisionOfId: source.id,
      rendererVersion: source.rendererVersion,
      visibleStateVersion: source.visibleStateVersion,
      focusPlannerVersion: source.focusPlannerVersion,
      semanticValidatorVersion: source.semanticValidatorVersion,
      fallbackVersion: source.fallbackVersion,
      tutorContractVersion: source.tutorContractVersion,
      stageContractVersion: source.stageContractVersion,
      extractorVersion: source.extractorVersion,
      extractorPromptVersion: source.extractorPromptVersion,
      sourceCommit: sourceCommit(),
      manifestJson: JSON.stringify(manifest),
      manifestSha256: sha256Text(JSON.stringify(manifest)),
      compatibilityJson: source.compatibilityJson,
      createdById: input.user.id,
    },
  });
  await audit(input.user.id, 'PROMPT_POLICY_REVISION_CREATED', 'PromptPolicyVersion', created.id, {
    sourceId: source.id,
    sourceVersion: source.version,
  });
  return created;
}

export async function updatePromptPolicyStatus(input: {
  id: string;
  action: 'SUBMIT' | 'APPROVE' | 'SET_DEFAULT' | 'DISABLE';
  user: SessionUser;
}) {
  const policy = await db.promptPolicyVersion.findUnique({
    where: { id: input.id },
    include: { _count: { select: { runtimeBundles: true } } },
  });
  if (!policy) throw new Error('Prompt 策略不存在');
  if (input.action === 'SUBMIT') {
    if (policy.status !== 'DRAFT') throw new Error('只有草稿策略可以提交候选评测');
    return db.promptPolicyVersion.update({ where: { id: policy.id }, data: { status: 'CANDIDATE' } });
  }
  if (input.action === 'APPROVE') {
    if (!['DRAFT', 'CANDIDATE'].includes(policy.status)) throw new Error('当前状态不能批准');
    if (!TUTOR_LANGUAGE_PROMPT_VERSIONS.includes(policy.version as TutorLanguagePromptVersion)) {
      throw new Error('该策略尚未进入代码注册表，不能批准为可执行策略');
    }
    return db.promptPolicyVersion.update({
      where: { id: policy.id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedById: input.user.id },
    });
  }
  if (input.action === 'SET_DEFAULT') {
    if (policy.status !== 'APPROVED') throw new Error('只有已批准策略可以设为 Data Lab 默认');
    return db.$transaction(async (tx) => {
      await tx.promptPolicyVersion.updateMany({ where: { defaultForDataLab: true }, data: { defaultForDataLab: false } });
      return tx.promptPolicyVersion.update({ where: { id: policy.id }, data: { defaultForDataLab: true } });
    });
  }
  if (policy.defaultForDataLab) throw new Error('请先指定新的 Data Lab 默认 Prompt');
  const activeReferences = await db.runtimeBundle.count({
    where: { promptPolicyVersionId: policy.id, status: { in: ['AVAILABLE', 'DEPLOYED'] } },
  });
  if (activeReferences > 0) throw new Error(`仍有 ${activeReferences} 个可用或已部署运行组合引用此策略`);
  return db.promptPolicyVersion.update({ where: { id: policy.id }, data: { status: 'DISABLED' } });
}

export async function previewPromptPolicy(input: {
  id: string;
  phase: number;
  triggerType: string;
  visibleFacts: unknown;
  allowedFocusIds: string[];
  focusDescriptions?: Record<string, string>;
}) {
  const policy = await db.promptPolicyVersion.findUnique({ where: { id: input.id } });
  if (!policy) throw new Error('Prompt 策略不存在');
  if (!TUTOR_LANGUAGE_PROMPT_VERSIONS.includes(policy.version as TutorLanguagePromptVersion)) {
    throw new Error('该草稿尚未登记对应的代码 renderer，暂时不能执行动态预览');
  }
  if (!Number.isInteger(input.phase) || input.phase < 1 || input.phase > 6) throw new Error('阶段必须是 1–6');
  const focusIds = input.allowedFocusIds.map((value) => value.trim()).filter(Boolean);
  if (!focusIds.length) throw new Error('至少提供一个允许 focus');
  const context = {
    phase: input.phase,
    triggerType: input.triggerType.trim() || 'USER_MESSAGE',
    visibleFacts: input.visibleFacts,
    allowedFocusIds: focusIds,
    focusDescriptions: input.focusDescriptions ?? {},
  };
  const systemPrompt = buildTutorLanguagePrompt(context, policy.version as TutorLanguagePromptVersion);
  const baselines = ([TUTOR_LANGUAGE_PROMPT_V1, TUTOR_LANGUAGE_PROMPT_V2_3] as TutorLanguagePromptVersion[]).map((version) => {
    const rendered = buildTutorLanguagePrompt(context, version);
    return {
      version,
      promptSha256: sha256Text(rendered),
      changed: rendered !== systemPrompt,
      characterDelta: systemPrompt.length - rendered.length,
    };
  });
  return {
    input: { phase: context.phase, triggerType: context.triggerType },
    sanitizedVisibleFacts: sanitizeTutorVisibleFacts(input.visibleFacts),
    selectedFocus: focusIds[0],
    allowedFocusIds: focusIds,
    systemPrompt,
    promptSha256: sha256Text(systemPrompt),
    semanticValidatorVersion: policy.semanticValidatorVersion,
    fallbackVersion: policy.fallbackVersion,
    baselines,
  };
}

function validateCredentialInput(input: {
  credentialSource: string;
  envVarName?: string;
  apiKey?: string;
}) {
  if (!['ENV', 'ENCRYPTED_DB'].includes(input.credentialSource)) throw new Error('凭据来源不合法');
  if (input.credentialSource === 'ENV') {
    const name = input.envVarName?.trim() ?? '';
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('请输入合法的环境变量名称');
    return {
      sourceType: 'ENV',
      envVarName: name,
      encryptedValue: '',
      encryptionIv: '',
      encryptionAuthTag: '',
      keyLastFour: credentialLastFourForEnv(name),
    };
  }
  const encrypted = encryptProviderCredential(input.apiKey ?? '');
  return {
    sourceType: 'ENCRYPTED_DB',
    envVarName: '',
    ...encrypted,
  };
}

export async function createProviderConnection(input: {
  name: string;
  protocol?: string;
  baseUrl: string;
  credentialSource: string;
  envVarName?: string;
  apiKey?: string;
  capabilities?: unknown;
  user: SessionUser;
}) {
  const name = input.name.trim();
  if (!name) throw new Error('连接显示名称必填');
  const protocol = input.protocol?.trim() || 'OPENAI_COMPATIBLE';
  if (!['OPENAI_COMPATIBLE', 'DEEPSEEK_COMPATIBLE'].includes(protocol)) throw new Error('暂不支持该协议');
  const credential = validateCredentialInput(input);
  const connection = await db.providerConnection.create({
    data: {
      name,
      protocol,
      baseUrl: normalizeServiceBaseUrl(input.baseUrl),
      capabilitiesJson: JSON.stringify(input.capabilities ?? {}),
      createdById: input.user.id,
      credential: { create: { ...credential, updatedById: input.user.id } },
    },
  });
  await audit(input.user.id, 'PROVIDER_CONNECTION_CREATED', 'ProviderConnection', connection.id, {
    name,
    protocol,
    baseUrl: connection.baseUrl,
    credentialSource: credential.sourceType,
    envVarName: credential.envVarName,
  });
  return connection;
}

export async function updateProviderCredential(input: {
  connectionId: string;
  credentialSource: string;
  envVarName?: string;
  apiKey?: string;
  user: SessionUser;
}) {
  const connection = await db.providerConnection.findUnique({ where: { id: input.connectionId } });
  if (!connection) throw new Error('AI 服务连接不存在');
  const credential = validateCredentialInput(input);
  await db.providerCredential.upsert({
    where: { connectionId: connection.id },
    update: { ...credential, updatedById: input.user.id },
    create: { connectionId: connection.id, ...credential, updatedById: input.user.id },
  });
  await db.providerConnection.update({
    where: { id: connection.id },
    data: { status: 'DRAFT', lastTestStatus: 'NOT_TESTED', lastErrorCode: '', lastErrorMessage: '' },
  });
  await audit(input.user.id, 'PROVIDER_CREDENTIAL_UPDATED', 'ProviderConnection', connection.id, {
    credentialSource: credential.sourceType,
    envVarName: credential.envVarName,
  });
}

export async function updateProviderConnection(input: {
  id: string;
  name?: string;
  baseUrl?: string;
  capabilities?: unknown;
  action?: 'DISABLE' | 'ENABLE' | 'DELETE';
  user: SessionUser;
}) {
  const connection = await db.providerConnection.findUnique({
    where: { id: input.id },
    include: { _count: { select: { endpoints: true } } },
  });
  if (!connection) throw new Error('AI 服务连接不存在');
  if (input.action === 'DELETE') {
    if (connection._count.endpoints > 0) throw new Error('只有未被 Endpoint 引用的连接可以删除');
    await db.providerConnection.delete({ where: { id: connection.id } });
    await audit(input.user.id, 'PROVIDER_CONNECTION_DELETED', 'ProviderConnection', connection.id);
    return null;
  }
  if (input.action === 'DISABLE') {
    await db.providerConnection.update({ where: { id: connection.id }, data: { status: 'DISABLED' } });
    await db.modelEndpoint.updateMany({ where: { connectionId: connection.id }, data: { status: 'DISABLED' } });
    return null;
  }
  if (input.action === 'ENABLE') {
    await db.providerConnection.update({ where: { id: connection.id }, data: { status: 'DRAFT', lastTestStatus: 'NOT_TESTED' } });
    return null;
  }
  return db.providerConnection.update({
    where: { id: connection.id },
    data: {
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(input.baseUrl ? { baseUrl: normalizeServiceBaseUrl(input.baseUrl) } : {}),
      ...(input.capabilities !== undefined ? { capabilitiesJson: JSON.stringify(input.capabilities) } : {}),
      status: 'DRAFT',
      lastTestStatus: 'NOT_TESTED',
    },
  });
}

async function providerWithSecret(connectionId: string) {
  const connection = await db.providerConnection.findUnique({
    where: { id: connectionId },
    include: { credential: true },
  });
  if (!connection || !connection.credential) throw new Error('AI 服务连接或凭据不存在');
  if (connection.status === 'DISABLED') throw new Error('AI 服务连接已停用');
  return {
    connection,
    apiKey: resolveProviderCredential(connection.credential),
  };
}

export async function testProviderConnection(connectionId: string, user: SessionUser) {
  const started = Date.now();
  try {
    const { connection, apiKey } = await providerWithSecret(connectionId);
    const controller = new AbortController();
    const configuredTimeout = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
    const timeoutMs = Number.isFinite(configuredTimeout) ? Math.min(180_000, Math.max(5_000, configuredTimeout)) : 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let modelIds: string[];
    let probeModel: string;
    let probeModelSource: 'ENDPOINT' | 'FIRST_LISTED';
    try {
      const modelsResponse = await fetch(`${normalizeServiceBaseUrl(connection.baseUrl)}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!modelsResponse.ok) throw new Error(`模型列表返回 HTTP ${modelsResponse.status}`);
      const modelsJson = await modelsResponse.json() as { data?: Array<{ id?: unknown }> };
      modelIds = (modelsJson.data ?? []).map((item) => typeof item.id === 'string' ? item.id : '').filter(Boolean);
      if (modelIds.length === 0) throw new Error('模型列表为空，无法执行实际生成探针');
      const endpoint = await db.modelEndpoint.findFirst({
        where: { connectionId: connection.id, status: { not: 'DISABLED' } },
        select: { remoteModelId: true },
      });
      if (endpoint && modelIds.includes(endpoint.remoteModelId)) {
        probeModel = endpoint.remoteModelId;
        probeModelSource = 'ENDPOINT';
      } else {
        probeModel = modelIds[0];
        probeModelSource = 'FIRST_LISTED';
      }

      const probeResponse = await fetch(`${normalizeServiceBaseUrl(connection.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: probeModel,
          messages: [
            { role: 'system', content: '只返回合法 JSON 对象。' },
            { role: 'user', content: '返回 {"ok":true}。' },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 32,
        }),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!probeResponse.ok) throw new Error(`实际生成探针返回 HTTP ${probeResponse.status}`);
      const probeJson = await probeResponse.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = probeJson.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('实际生成探针未返回文本内容');
      const parsed = parseLlmJsonObject(content);
      if (parsed?.ok !== true) {
        throw new Error(`实际生成探针未返回 {"ok":true}（收到：${content.slice(0, 80)}）`);
      }
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - started;
    await db.providerConnection.update({
      where: { id: connection.id },
      data: {
        status: 'ACTIVE',
        lastTestedAt: new Date(),
        lastTestStatus: 'PASS',
        lastLatencyMs: latencyMs,
        lastErrorCode: '',
        lastErrorMessage: '',
      },
    });
    await audit(user.id, 'PROVIDER_CONNECTION_TESTED', 'ProviderConnection', connection.id, {
      ok: true,
      latencyMs,
      modelCount: modelIds.length,
      probeModel,
      probeModelSource,
    });
    return { ok: true, latencyMs, modelIds, probeModel };
  } catch (error) {
    const message = truncateError(error);
    await db.providerConnection.update({
      where: { id: connectionId },
      data: {
        status: 'ERROR',
        lastTestedAt: new Date(),
        lastTestStatus: 'FAIL',
        lastLatencyMs: Date.now() - started,
        lastErrorCode: error instanceof DOMException && error.name === 'AbortError' ? 'TIMEOUT' : 'CONNECTION_FAILED',
        lastErrorMessage: message,
      },
    }).catch(() => undefined);
    await audit(user.id, 'PROVIDER_CONNECTION_TESTED', 'ProviderConnection', connectionId, {
      ok: false,
      error: message,
    });
    throw new Error(`连接测试失败：${message}`);
  }
}

export async function listProviderConnections() {
  const connections = await db.providerConnection.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      credential: {
        select: { sourceType: true, envVarName: true, keyLastFour: true, updatedAt: true },
      },
      endpoints: {
        select: {
          id: true,
          displayName: true,
          remoteModelId: true,
          status: true,
          modelVersionId: true,
          _count: { select: { runtimeBundles: true } },
        },
      },
      _count: { select: { endpoints: true } },
    },
  });
  return connections.map((connection) => ({
    ...connection,
    runtimeBundleCount: connection.endpoints.reduce((total, endpoint) => total + endpoint._count.runtimeBundles, 0),
  }));
}

export async function createModelEndpoint(input: {
  connectionId: string;
  displayName: string;
  remoteModelId: string;
  modelVersionId?: string;
  capabilities?: unknown;
  user: SessionUser;
}) {
  const connection = await db.providerConnection.findUnique({ where: { id: input.connectionId } });
  if (!connection) throw new Error('AI 服务连接不存在');
  if (input.modelVersionId) {
    const model = await db.modelVersion.findUnique({ where: { id: input.modelVersionId } });
    if (!model) throw new Error('模型产物不存在');
  }
  const remoteModelId = input.remoteModelId.trim();
  if (!remoteModelId) throw new Error('远程 model ID 必填');
  const endpoint = await db.modelEndpoint.create({
    data: {
      connectionId: connection.id,
      displayName: input.displayName.trim() || remoteModelId,
      remoteModelId,
      modelVersionId: input.modelVersionId || null,
      capabilitiesJson: JSON.stringify(input.capabilities ?? {}),
      status: connection.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
      createdById: input.user.id,
    },
  });
  await audit(input.user.id, 'MODEL_ENDPOINT_CREATED', 'ModelEndpoint', endpoint.id, {
    connectionId: connection.id,
    remoteModelId,
    modelVersionId: input.modelVersionId || null,
  });
  return endpoint;
}

export async function linkModelEndpoint(input: {
  endpointId: string;
  modelVersionId: string;
  user: SessionUser;
}) {
  const [endpoint, model] = await Promise.all([
    db.modelEndpoint.findUnique({ where: { id: input.endpointId } }),
    db.modelVersion.findUnique({ where: { id: input.modelVersionId } }),
  ]);
  if (!endpoint || !model) throw new Error('Endpoint 或模型产物不存在');
  const updated = await db.modelEndpoint.update({
    where: { id: endpoint.id },
    data: { modelVersionId: model.id },
  });
  await audit(input.user.id, 'MODEL_ENDPOINT_LINKED', 'ModelEndpoint', endpoint.id, { modelVersionId: model.id });
  return updated;
}

export async function listRuntimeRolesAndBundles() {
  const [roles, bundles] = await Promise.all([
    db.runtimeRoleBinding.findMany({
      orderBy: [{ enabled: 'desc' }, { displayName: 'asc' }],
      include: {
        defaultRuntimeBundle: {
          select: { id: true, name: true, version: true, status: true },
        },
      },
    }),
    db.runtimeBundle.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        modelVersion: true,
        endpoint: { include: { connection: { select: { id: true, name: true, status: true, protocol: true, baseUrl: true } } } },
        promptPolicyVersion: true,
        createdBy: { select: { displayName: true } },
        promptCompatibilities: { orderBy: { updatedAt: 'desc' }, take: 1 },
        _count: {
          select: {
            generationTraces: true,
            deployments: true,
            evaluationsAsA: true,
            evaluationsAsB: true,
          },
        },
      },
    }),
  ]);
  return { roles, bundles };
}

export async function runtimeBundleOptions() {
  const [models, endpoints, prompts, roles] = await Promise.all([
    db.modelVersion.findMany({
      where: { status: { notIn: ['RETIRED', 'BLOCKED'] } },
      orderBy: { createdAt: 'desc' },
    }),
    db.modelEndpoint.findMany({
      orderBy: { createdAt: 'desc' },
      include: { connection: { select: { name: true, status: true } }, modelVersion: { select: { tag: true } } },
    }),
    db.promptPolicyVersion.findMany({
      where: { status: { in: ['APPROVED', 'CANDIDATE'] } },
      orderBy: [{ defaultForDataLab: 'desc' }, { createdAt: 'desc' }],
    }),
    db.runtimeRoleBinding.findMany({ where: { enabled: true }, orderBy: { displayName: 'asc' } }),
  ]);
  return { models, endpoints, prompts, roles };
}

async function consistencyForSelection(input: {
  roleKey: string;
  modelVersionId: string;
  endpointId: string;
  promptPolicyVersionId: string;
  tutorContractVersion?: string;
  stageContractVersion?: string;
  extractorVersion?: string;
}) {
  const [model, endpoint, prompt] = await Promise.all([
    db.modelVersion.findUnique({ where: { id: input.modelVersionId } }),
    db.modelEndpoint.findUnique({ where: { id: input.endpointId }, include: { connection: true } }),
    db.promptPolicyVersion.findUnique({ where: { id: input.promptPolicyVersionId } }),
  ]);
  if (!model || !endpoint || !prompt) throw new Error('模型、Endpoint 或 Prompt 策略不存在');
  const contracts = {
    tutor: input.tutorContractVersion || prompt.tutorContractVersion,
    stage: input.stageContractVersion || prompt.stageContractVersion,
    extractor: input.extractorVersion || prompt.extractorVersion,
  };
  return {
    model,
    endpoint,
    prompt,
    contracts,
    report: evaluateRuntimeConsistency({
      roleKey: input.roleKey,
      model,
      endpoint: { ...endpoint, connectionStatus: endpoint.connection.status },
      prompt,
      contracts,
    }),
  };
}

export async function previewRuntimeBundleConsistency(input: {
  roleKey: string;
  modelVersionId: string;
  endpointId: string;
  promptPolicyVersionId: string;
  tutorContractVersion?: string;
  stageContractVersion?: string;
  extractorVersion?: string;
}) {
  return (await consistencyForSelection(input)).report;
}

export async function createRuntimeBundle(input: {
  name: string;
  roleKey: string;
  modelVersionId: string;
  endpointId: string;
  promptPolicyVersionId: string;
  generationParams?: unknown;
  user: SessionUser;
}) {
  const name = input.name.trim();
  if (!name) throw new Error('运行组合名称必填');
  const role = await db.runtimeRoleBinding.findUnique({ where: { roleKey: input.roleKey } });
  if (!role || !role.enabled) throw new Error('用途角色不存在或已停用');
  const checked = await consistencyForSelection(input);
  const latest = await db.runtimeBundle.findFirst({ where: { name }, orderBy: { version: 'desc' } });
  const params = input.generationParams ?? {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('生成参数必须是 JSON 对象');
  const created = await db.runtimeBundle.create({
    data: {
      name,
      version: (latest?.version ?? 0) + 1,
      roleKey: input.roleKey,
      modelVersionId: checked.model.id,
      endpointId: checked.endpoint.id,
      promptPolicyVersionId: checked.prompt.id,
      tutorContractVersion: checked.contracts.tutor,
      stageContractVersion: checked.contracts.stage,
      extractorVersion: checked.contracts.extractor,
      generationParamsJson: JSON.stringify(params),
      compatibilityReportJson: JSON.stringify(checked.report),
      status: checked.report.ok ? 'PENDING_COMPATIBILITY' : 'DRAFT',
      createdById: input.user.id,
    },
  });
  await audit(input.user.id, 'RUNTIME_BUNDLE_CREATED', 'RuntimeBundle', created.id, {
    name,
    version: created.version,
    roleKey: input.roleKey,
    blockers: checked.report.blockers,
  });
  return { bundle: created, report: checked.report };
}

async function bundleWithRuntime(bundleId: string) {
  const bundle = await db.runtimeBundle.findUnique({
    where: { id: bundleId },
    include: {
      modelVersion: true,
      promptPolicyVersion: true,
      endpoint: { include: { connection: { include: { credential: true } } } },
    },
  });
  if (!bundle) throw new Error('运行组合不存在');
  const credential = bundle.endpoint.connection.credential;
  if (!credential) throw new Error('运行组合的服务连接缺少凭据');
  return {
    bundle,
    apiKey: resolveProviderCredential(credential),
  };
}

export async function resolveRuntimeBundleCallConfig(bundleId: string) {
  const { bundle, apiKey } = await bundleWithRuntime(bundleId);
  if (!['AVAILABLE', 'DEPLOYED', 'COMPATIBLE', 'PENDING_COMPATIBILITY'].includes(bundle.status)) {
    throw new Error(`运行组合当前状态 ${bundle.status} 不允许执行模型调用`);
  }
  return {
    runtimeBundleId: bundle.id,
    status: bundle.status,
    provider: bundle.endpoint.connection.protocol === 'DEEPSEEK_COMPATIBLE' ? 'deepseek' as const : 'openai' as const,
    apiKey,
    baseURL: bundle.endpoint.connection.baseUrl,
    model: bundle.endpoint.remoteModelId,
    tag: bundle.modelVersion.tag,
    family: bundle.modelVersion.modelFamily || inferModelFamily(bundle.endpoint.connection.name, bundle.endpoint.remoteModelId),
    promptPolicyVersionId: bundle.promptPolicyVersionId,
    promptVersion: bundle.promptPolicyVersion.version,
    tutorContractVersion: bundle.tutorContractVersion,
    stageContractVersion: bundle.stageContractVersion,
    extractorVersion: bundle.extractorVersion,
    generationParams: parseObject(bundle.generationParamsJson),
  };
}

async function runBundleProbe(bundleId: string) {
  const { bundle, apiKey } = await bundleWithRuntime(bundleId);
  const params = parseObject(bundle.generationParamsJson);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const started = Date.now();
  try {
    const response = await fetch(`${normalizeServiceBaseUrl(bundle.endpoint.connection.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: bundle.endpoint.remoteModelId,
        messages: [
          { role: 'system', content: '只输出一个 JSON 对象：{"ok":true}' },
          { role: 'user', content: '执行结构化输出探针。' },
        ],
        response_format: { type: 'json_object' },
        temperature: typeof params.temperature === 'number' ? params.temperature : 0,
        max_tokens: 80,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('服务没有返回有效 completion');
    // 转换网关（如 Anthropic→OpenAI）即便收到 response_format=json_object 仍可能包 Markdown 围栏，
    // 所以这里必须与正式调用链走同一套解析，否则可用网关会被探针误判为不兼容。
    const parsed = parseLlmJsonObject(content);
    if (!parsed) throw new Error(`模型未返回 JSON 对象（收到：${content.trim().slice(0, 80)}）`);
    return { ok: true, latencyMs: Date.now() - started, responseSha256: sha256Text(content) };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkRuntimeBundle(bundleId: string) {
  const bundle = await db.runtimeBundle.findUnique({ where: { id: bundleId } });
  if (!bundle) throw new Error('运行组合不存在');
  const checked = await consistencyForSelection({
    roleKey: bundle.roleKey,
    modelVersionId: bundle.modelVersionId,
    endpointId: bundle.endpointId,
    promptPolicyVersionId: bundle.promptPolicyVersionId,
    tutorContractVersion: bundle.tutorContractVersion,
    stageContractVersion: bundle.stageContractVersion,
    extractorVersion: bundle.extractorVersion,
  });
  await db.runtimeBundle.update({
    where: { id: bundle.id },
    data: {
      compatibilityReportJson: JSON.stringify(checked.report),
      status: checked.report.ok
        ? (bundle.status === 'DRAFT' ? 'PENDING_COMPATIBILITY' : bundle.status)
        : 'DRAFT',
    },
  });
  return checked.report;
}

export async function testRuntimeBundle(bundleId: string, user: SessionUser) {
  const result = await runBundleProbe(bundleId);
  const bundle = await db.runtimeBundle.findUniqueOrThrow({ where: { id: bundleId } });
  const report = {
    ...parseObject(bundle.compatibilityReportJson),
    liveProbe: { ...result, checkedAt: new Date().toISOString() },
  };
  await db.$transaction([
    db.runtimeBundle.update({ where: { id: bundleId }, data: { compatibilityReportJson: JSON.stringify(report) } }),
    db.modelEndpoint.update({
      where: { id: bundle.endpointId },
      data: { status: 'ACTIVE', lastTestedAt: new Date(), lastTestStatus: 'PASS', lastLatencyMs: result.latencyMs, lastErrorCode: '', lastErrorMessage: '' },
    }),
  ]);
  await audit(user.id, 'RUNTIME_BUNDLE_PROBED', 'RuntimeBundle', bundleId, result);
  return result;
}

export async function runRuntimeCompatibility(bundleId: string, user: SessionUser) {
  const bundle = await db.runtimeBundle.findUnique({ where: { id: bundleId } });
  if (!bundle) throw new Error('运行组合不存在');
  const deterministic = await checkRuntimeBundle(bundle.id);
  let status: 'PASS' | 'FAIL' = deterministic.ok ? 'PASS' : 'FAIL';
  let liveProbe: Record<string, unknown> | null = null;
  let failure = '';
  if (deterministic.ok) {
    try {
      liveProbe = await runBundleProbe(bundle.id);
    } catch (error) {
      status = 'FAIL';
      failure = truncateError(error);
    }
  }
  const evidence = {
    checkedAt: new Date().toISOString(),
    deterministic,
    liveProbe,
    failure,
  };
  await db.$transaction(async (tx) => {
    await tx.promptCompatibility.upsert({
      where: {
        promptPolicyVersionId_modelVersionId: {
          promptPolicyVersionId: bundle.promptPolicyVersionId,
          modelVersionId: bundle.modelVersionId,
        },
      },
      update: { runtimeBundleId: bundle.id, status, evidenceJson: JSON.stringify(evidence), checkedAt: new Date() },
      create: {
        promptPolicyVersionId: bundle.promptPolicyVersionId,
        modelVersionId: bundle.modelVersionId,
        runtimeBundleId: bundle.id,
        status,
        evidenceJson: JSON.stringify(evidence),
        checkedAt: new Date(),
      },
    });
    await tx.runtimeBundle.update({
      where: { id: bundle.id },
      data: {
        status: status === 'PASS' ? 'COMPATIBLE' : 'INCOMPATIBLE',
        compatibilityReportJson: JSON.stringify(evidence),
      },
    });
  });
  await audit(user.id, 'RUNTIME_COMPATIBILITY_EVALUATED', 'RuntimeBundle', bundle.id, { status, failure });
  return { status, evidence };
}

export async function updateRuntimeBundleStatus(input: {
  id: string;
  action: 'MARK_AVAILABLE' | 'DISABLE';
  user: SessionUser;
}) {
  const bundle = await db.runtimeBundle.findUnique({
    where: { id: input.id },
    include: { roleBindings: true, promptCompatibilities: { orderBy: { checkedAt: 'desc' }, take: 1 } },
  });
  if (!bundle) throw new Error('运行组合不存在');
  if (input.action === 'MARK_AVAILABLE') {
    if (bundle.status !== 'COMPATIBLE' || bundle.promptCompatibilities[0]?.status !== 'PASS') {
      throw new Error('只有兼容性评测通过的组合可以标记为可用');
    }
    return db.runtimeBundle.update({ where: { id: bundle.id }, data: { status: 'AVAILABLE' } });
  }
  if (bundle.status === 'DEPLOYED') throw new Error('已部署组合必须先回滚或退出生产流量');
  if (bundle.roleBindings.length) throw new Error('请先取消该组合的角色默认绑定');
  return db.runtimeBundle.update({ where: { id: bundle.id }, data: { status: 'DISABLED' } });
}

export async function setRuntimeRoleDefault(input: {
  roleKey: string;
  bundleId: string;
  user: SessionUser;
}) {
  const [role, bundle] = await Promise.all([
    db.runtimeRoleBinding.findUnique({ where: { roleKey: input.roleKey } }),
    db.runtimeBundle.findUnique({ where: { id: input.bundleId } }),
  ]);
  if (!role || !role.enabled) throw new Error('运行角色不存在或已停用');
  if (!bundle || !['AVAILABLE', 'DEPLOYED'].includes(bundle.status)) throw new Error('只能绑定可用或已部署的运行组合');
  if (bundle.roleKey !== role.roleKey) throw new Error('运行组合用途与角色不一致');
  const updated = await db.runtimeRoleBinding.update({
    where: { roleKey: role.roleKey },
    data: { defaultRuntimeBundleId: bundle.id, updatedById: input.user.id },
  });
  await audit(input.user.id, 'RUNTIME_ROLE_DEFAULT_CHANGED', 'RuntimeRoleBinding', role.id, {
    roleKey: role.roleKey,
    runtimeBundleId: bundle.id,
  });
  return updated;
}

export async function dataLabModelIterationOverview() {
  const [serviceAvailable, serviceErrors, prompt, pendingTrainingOutputs, pendingCompatibility, activeDeployment] = await Promise.all([
    db.providerConnection.count({ where: { status: 'ACTIVE' } }),
    db.providerConnection.count({ where: { status: 'ERROR' } }),
    db.promptPolicyVersion.findFirst({ where: { defaultForDataLab: true }, select: { version: true } }),
    db.trainingRun.count({ where: { status: 'SUCCEEDED', outputModelVersion: null } }),
    db.runtimeBundle.count({ where: { status: { in: ['DRAFT', 'PENDING_COMPATIBILITY', 'INCOMPATIBLE'] } } }),
    db.modelDeployment.findFirst({
      where: { environment: 'PRODUCTION', status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
      include: {
        runtimeBundle: {
          select: {
            name: true,
            version: true,
            promptPolicyVersion: { select: { version: true } },
            modelVersion: { select: { tag: true } },
          },
        },
        modelVersion: { select: { tag: true, promptPolicyVersion: true } },
      },
    }),
  ]);
  return { serviceAvailable, serviceErrors, prompt: prompt?.version ?? null, pendingTrainingOutputs, pendingCompatibility, activeDeployment };
}

export function modelFamilyForEndpoint(providerName: string, remoteModelId: string) {
  return inferModelFamily(providerName, remoteModelId);
}

export function hashPromptPreview(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export const CURRENT_DATA_LAB_PROMPT = DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION;
