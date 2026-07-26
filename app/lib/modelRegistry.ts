import { db } from '@/app/lib/db';
import { validateConfig } from '@/app/lib/llm/provider';
import { TUTOR_LANGUAGE_CONTRACT_VERSION, TUTOR_LANGUAGE_PROMPT_VERSION } from '@/app/lib/tutorLanguage';
import { inferModelFamily } from '@/app/lib/dataLab/runtimeGovernance';
import type { LLMProviderConfig } from '@/app/lib/llm/types';

export const PROMPT_POLICY_VERSION = TUTOR_LANGUAGE_PROMPT_VERSION;
export const CHAT_CONTRACT_VERSION = TUTOR_LANGUAGE_CONTRACT_VERSION;

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
  runtimeBundleId?: string;
  runtimeConfig?: LLMProviderConfig;
}

function cleanTag(value: string): string {
  return value.trim().replace(/\s+/g, '-').slice(0, 120);
}

export function getRuntimeModelIdentity(): RuntimeModelIdentity | null {
  const config = validateConfig();
  if (!config.valid || !config.provider || !config.model) return null;

  const configuredTag = process.env.LLM_MODEL_TAG?.trim();
  const baseTag = configuredTag || `${config.provider}:${config.model}`;
  return {
    tag: cleanTag(`${baseTag}:${PROMPT_POLICY_VERSION}`),
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
        existing.externalModelId !== identity.externalModelId ||
        existing.promptPolicyVersion !== identity.promptPolicyVersion ||
        existing.contractVersion !== identity.contractVersion)
    ) {
      throw new Error(
        `模型标签 ${identity.tag} 已绑定到其他 provider/model/prompt contract；请设置唯一的 LLM_MODEL_TAG`
      );
    }

    const activeDeployment = await tx.modelDeployment.findFirst({
      where: { environment: 'PRODUCTION', status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
    const model =
      existing ??
      (await tx.modelVersion.create({
        data: {
          ...identity,
          status: activeDeployment ? 'DRAFT' : 'DEPLOYED',
        },
      }));

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
    } else if (
      activeDeployment.modelVersionId !== model.id &&
      process.env.PROMOTE_RUNTIME_PROMPT_BASELINE === 'true'
    ) {
      await tx.modelDeployment.update({
        where: { id: activeDeployment.id },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
      await tx.modelDeployment.create({
        data: {
          modelVersionId: model.id,
          previousModelVersionId: activeDeployment.modelVersionId,
          environment: 'PRODUCTION',
          rolloutPercent: 100,
          status: 'ACTIVE',
          startedAt: new Date(),
          gateReportJson: JSON.stringify({
            reason: 'PROMPT_CONTRACT_BASELINE_PROMOTION',
            promptPolicyVersion: identity.promptPolicyVersion,
            contractVersion: identity.contractVersion,
          }),
        },
      });
      await tx.modelVersion.update({ where: { id: model.id }, data: { status: 'DEPLOYED' } });
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
  artifactKind?: string;
  modelFamily?: string;
  checkpointId?: string;
  weightsSha256?: string;
  parameterScale?: string;
  architecture?: string;
  verificationStatus?: string;
  metadata?: unknown;
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
    const run = input.trainingRunId
      ? await tx.trainingRun.findUnique({
        where: { id: input.trainingRunId },
        include: { promptPolicyVersion: true },
      })
      : null;
    if (input.trainingRunId) {
      if (!run) throw new Error('训练任务不存在');
      if (status === 'TRAINED' && run.status !== 'SUCCEEDED') throw new Error('只有已成功的训练任务可以登记训练产物');
    }
    const modelFamily = input.modelFamily?.trim() || inferModelFamily(provider, externalModelId);
    const checkpointId = input.checkpointId?.trim() ?? '';
    const weightsSha256 = input.weightsSha256?.trim().toLowerCase() ?? '';
    if (weightsSha256 && !/^[a-f0-9]{64}$/.test(weightsSha256)) throw new Error('权重 SHA-256 必须是 64 位十六进制字符串');
    const verificationStatus = input.verificationStatus?.trim()
      || (checkpointId || weightsSha256 ? 'VERIFIED_IDENTITY' : 'EXTERNAL_ALIAS_UNVERIFIED');

    const model = await tx.modelVersion.create({
      data: {
        tag,
        provider,
        externalModelId,
        parentModelVersionId: input.parentModelVersionId || null,
        trainingRunId: input.trainingRunId || null,
        trainedPromptPolicyVersionId: run?.promptPolicyVersionId ?? null,
        promptPolicyVersion: run?.promptPolicyVersion?.version ?? PROMPT_POLICY_VERSION,
        contractVersion: run?.promptPolicyVersion?.tutorContractVersion ?? CHAT_CONTRACT_VERSION,
        artifactKind: input.artifactKind?.trim() || (run ? 'FINE_TUNED' : 'BASE'),
        modelFamily,
        checkpointId,
        weightsSha256,
        parameterScale: input.parameterScale?.trim() ?? '',
        architecture: input.architecture?.trim() ?? '',
        verificationStatus,
        metadataJson: JSON.stringify(input.metadata ?? {}),
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
          trainedPromptPolicyVersionId: run?.promptPolicyVersionId ?? null,
          artifactKind: input.artifactKind?.trim() || (run ? 'FINE_TUNED' : 'BASE'),
          modelFamily,
          checkpointId,
          weightsSha256,
          verificationStatus,
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
      trainingRun: { select: { id: true, name: true, status: true, externalTaskId: true, createdAt: true, release: { select: { id: true, version: true } } } },
      trainedPromptPolicy: { select: { id: true, version: true, displayName: true } },
      endpoints: { select: { id: true, displayName: true, remoteModelId: true, status: true, connection: { select: { name: true } } } },
      createdBy: { select: { displayName: true } },
      _count: { select: { generationTraces: true, children: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function disableModelVersion(input: { id: string; actorId: string }) {
  const model = await db.modelVersion.findUnique({
    where: { id: input.id },
    include: {
      runtimeBundles: { where: { status: { in: ['AVAILABLE', 'DEPLOYED'] } } },
      deployments: { where: { status: 'ACTIVE' } },
    },
  });
  if (!model) throw new Error('模型产物不存在');
  if (model.deployments.length || model.runtimeBundles.some((bundle) => bundle.status === 'DEPLOYED')) {
    throw new Error('该模型仍在生产部署中，请先回滚或切换运行组合');
  }
  return db.$transaction(async (tx) => {
    await tx.runtimeBundle.updateMany({
      where: { modelVersionId: model.id, status: { not: 'DEPLOYED' } },
      data: { status: 'DISABLED' },
    });
    const updated = await tx.modelVersion.update({ where: { id: model.id }, data: { status: 'BLOCKED' } });
    await tx.dataLabAuditLog.create({
      data: {
        actorId: input.actorId,
        action: 'MODEL_VERSION_DISABLED',
        entityType: 'ModelVersion',
        entityId: model.id,
        payloadJson: JSON.stringify({ disabledRuntimeBundleIds: model.runtimeBundles.map((bundle) => bundle.id) }),
      },
    });
    return updated;
  });
}

export function listModelDeployments() {
  return db.modelDeployment.findMany({
    include: {
      modelVersion: { select: { id: true, tag: true } },
      previousModelVersion: { select: { id: true, tag: true } },
      runtimeBundle: { include: { modelVersion: true, promptPolicyVersion: true, endpoint: true } },
      previousRuntimeBundle: { include: { modelVersion: true, promptPolicyVersion: true, endpoint: true } },
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

export function listGenerationTraceLineage(input: { query?: string; take?: number } = {}) {
  const query = input.query?.trim();
  return db.generationTrace.findMany({
    where: query ? {
      OR: [
        { id: { contains: query } },
        { conversationId: { contains: query } },
        { assistantMessageId: { contains: query } },
        { userMessageId: { contains: query } },
        { modelTagSnapshot: { contains: query } },
        { promptVersion: { contains: query } },
      ],
    } : undefined,
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Math.max(1, input.take ?? 100)),
    include: {
      conversation: {
        select: {
          id: true,
          traceCoverage: true,
          user: { select: { username: true, displayName: true } },
          studentAssignment: { select: { assignment: { select: { title: true, class: { select: { name: true } } } } } },
          deployedModelVersion: { select: { id: true, tag: true } },
          deployedRuntimeBundle: { select: { id: true, name: true, version: true } },
        },
      },
      modelVersion: {
        select: {
          id: true,
          tag: true,
          trainingRun: { select: { id: true, name: true, release: { select: { id: true, version: true } } } },
        },
      },
      runtimeBundle: {
        select: {
          id: true,
          name: true,
          version: true,
          endpoint: { select: { displayName: true, remoteModelId: true } },
          promptPolicyVersion: { select: { version: true } },
        },
      },
      productionCandidate: { select: { id: true, status: true, convertedTutorTurnCaseId: true } },
    },
  });
}
