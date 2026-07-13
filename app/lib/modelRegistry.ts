import { db } from '@/app/lib/db';
import { validateConfig } from '@/app/lib/llm/provider';

export const PROMPT_POLICY_VERSION = 'stem-six-phase-v1';
export const CHAT_CONTRACT_VERSION = 'chat-contract-v1';

export const MODEL_VERSION_STATUSES = [
  'DRAFT',
  'TRAINED',
  'EVALUATED',
  'ELIGIBLE',
  'DEPLOYED',
  'RETIRED',
  'BLOCKED',
] as const;

export type ModelVersionStatus = (typeof MODEL_VERSION_STATUSES)[number];

export interface RuntimeModelIdentity {
  tag: string;
  provider: string;
  externalModelId: string;
  promptPolicyVersion: string;
  contractVersion: string;
}

function cleanTag(value: string): string {
  return value.trim().replace(/\s+/g, '-').slice(0, 120);
}

export function getRuntimeModelIdentity(): RuntimeModelIdentity | null {
  const config = validateConfig();
  if (!config.valid || !config.provider || !config.model) return null;

  const configuredTag = process.env.LLM_MODEL_TAG?.trim();
  return {
    tag: cleanTag(configuredTag || `${config.provider}:${config.model}`),
    provider: config.provider,
    externalModelId: config.model,
    promptPolicyVersion: PROMPT_POLICY_VERSION,
    contractVersion: CHAT_CONTRACT_VERSION,
  };
}

/**
 * Idempotently registers the model selected by the current environment. The first
 * registered runtime model also becomes the production baseline. API keys are
 * never read into or persisted by this function.
 */
export async function ensureRuntimeModelVersion() {
  const identity = getRuntimeModelIdentity();
  if (!identity) throw new Error('当前 LLM 配置无效，无法登记运行时模型版本');

  return db.$transaction(async (tx) => {
    const existing = await tx.modelVersion.findUnique({ where: { tag: identity.tag } });
    if (
      existing &&
      (existing.provider !== identity.provider ||
        existing.externalModelId !== identity.externalModelId)
    ) {
      throw new Error(
        `模型标签 ${identity.tag} 已绑定到其他 provider/model；请设置唯一的 LLM_MODEL_TAG`
      );
    }

    const model =
      existing ??
      (await tx.modelVersion.create({
        data: {
          ...identity,
          status: 'DEPLOYED',
        },
      }));

    const activeDeployment = await tx.modelDeployment.findFirst({
      where: { environment: 'PRODUCTION', status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
    if (!activeDeployment) {
      await tx.modelDeployment.create({
        data: {
          modelVersionId: model.id,
          environment: 'PRODUCTION',
          rolloutPercent: 100,
          status: 'ACTIVE',
          startedAt: new Date(),
        },
      });
    }

    return model;
  });
}

export async function registerModelVersion(input: {
  tag: string;
  provider: string;
  externalModelId: string;
  parentModelVersionId?: string;
  trainingRunId?: string;
  status?: string;
  createdById: string;
}) {
  const tag = cleanTag(input.tag);
  const provider = input.provider.trim();
  const externalModelId = input.externalModelId.trim();
  const status = input.status ?? 'DRAFT';
  if (!tag || !provider || !externalModelId) {
    throw new Error('tag、provider、externalModelId 必填');
  }
  if (!MODEL_VERSION_STATUSES.includes(status as ModelVersionStatus)) {
    throw new Error('模型状态不合法');
  }

  return db.$transaction(async (tx) => {
    if (input.parentModelVersionId) {
      const parent = await tx.modelVersion.findUnique({
        where: { id: input.parentModelVersionId },
        select: { id: true },
      });
      if (!parent) throw new Error('父模型版本不存在');
    }
    if (input.trainingRunId) {
      const run = await tx.trainingRun.findUnique({
        where: { id: input.trainingRunId },
        select: { id: true },
      });
      if (!run) throw new Error('训练任务不存在');
    }

    const model = await tx.modelVersion.create({
      data: {
        tag,
        provider,
        externalModelId,
        parentModelVersionId: input.parentModelVersionId || null,
        trainingRunId: input.trainingRunId || null,
        promptPolicyVersion: PROMPT_POLICY_VERSION,
        contractVersion: CHAT_CONTRACT_VERSION,
        status,
        createdById: input.createdById,
      },
    });
    await tx.dataLabAuditLog.create({
      data: {
        actorId: input.createdById,
        action: 'MODEL_VERSION_REGISTERED',
        entityType: 'ModelVersion',
        entityId: model.id,
        payloadJson: JSON.stringify({
          tag,
          provider,
          externalModelId,
          parentModelVersionId: input.parentModelVersionId || null,
          trainingRunId: input.trainingRunId || null,
          status,
        }),
      },
    });
    return model;
  });
}

export function listModelVersions() {
  return db.modelVersion.findMany({
    include: {
      parent: { select: { id: true, tag: true } },
      trainingRun: { select: { id: true, name: true } },
      createdBy: { select: { displayName: true } },
      _count: { select: { generationTraces: true, children: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export function listModelDeployments() {
  return db.modelDeployment.findMany({
    include: {
      modelVersion: { select: { id: true, tag: true } },
      previousModelVersion: { select: { id: true, tag: true } },
      createdBy: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function modelTraceCoverageSummary() {
  const [complete, legacy, traces] = await Promise.all([
    db.conversation.count({ where: { traceCoverage: 'COMPLETE' } }),
    db.conversation.count({ where: { traceCoverage: 'LEGACY_UNVERIFIED' } }),
    db.generationTrace.count(),
  ]);
  return { complete, legacy, traces };
}
