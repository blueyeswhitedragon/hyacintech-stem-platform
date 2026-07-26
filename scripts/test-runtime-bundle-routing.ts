#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import { db } from '../app/lib/db';
import { ensureStudentConversation } from '../app/lib/conversation';
import { ensureDataLabRuntimeRegistry } from '../app/lib/dataLab/runtimeRegistry';
import { resolveConversationModel } from '../app/lib/deployment';
import type { SessionUser } from '../app/lib/session';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

async function main() {
  console.log('RuntimeBundle conversation routing:');
  const suffix = randomUUID();
  const apiKeyName = `ROUTING_TEST_API_KEY_${suffix.replaceAll('-', '_').toUpperCase()}`;
  process.env[apiKeyName] = 'runtime-routing-test-key';

  let originalDeployment: Awaited<ReturnType<typeof db.modelDeployment.findFirstOrThrow>> | null = null;
  let runtimeDeploymentId: string | null = null;
  let connectionId: string | null = null;
  let endpointId: string | null = null;
  let bundleId: string | null = null;
  let assignmentId: string | null = null;
  const conversationIds: string[] = [];

  try {
    const admin = await db.user.findFirstOrThrow({ where: { role: 'admin', isActive: true } });
    const adminUser: SessionUser = {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: 'admin',
    };
    const member = await db.classMember.findFirstOrThrow({
      include: { student: true, class: true },
    });
    await ensureDataLabRuntimeRegistry(adminUser);
    const prompt = await db.promptPolicyVersion.findFirstOrThrow({
      where: { status: 'APPROVED', defaultForDataLab: true },
      orderBy: { createdAt: 'desc' },
    });
    originalDeployment = await db.modelDeployment.findFirstOrThrow({
      where: { environment: 'PRODUCTION', status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
    const baseline = await db.modelVersion.findUniqueOrThrow({
      where: { id: originalDeployment.modelVersionId },
    });

    const connection = await db.providerConnection.create({
      data: {
        name: `routing-provider-${suffix}`,
        protocol: baseline.provider === 'deepseek' ? 'DEEPSEEK_COMPATIBLE' : 'OPENAI_COMPATIBLE',
        baseUrl: 'https://routing-test.invalid/v1',
        status: 'ACTIVE',
        lastTestStatus: 'PASS',
        createdById: admin.id,
        credential: {
          create: {
            sourceType: 'ENV',
            envVarName: apiKeyName,
            updatedById: admin.id,
          },
        },
      },
    });
    connectionId = connection.id;
    const endpoint = await db.modelEndpoint.create({
      data: {
        connectionId: connection.id,
        displayName: `Routing endpoint ${suffix}`,
        remoteModelId: baseline.externalModelId,
        modelVersionId: baseline.id,
        status: 'ACTIVE',
        lastTestStatus: 'PASS',
        createdById: admin.id,
      },
    });
    endpointId = endpoint.id;
    const bundle = await db.runtimeBundle.create({
      data: {
        name: `routing-bundle-${suffix}`,
        roleKey: 'FORMAL_TUTOR',
        status: 'DEPLOYED',
        modelVersionId: baseline.id,
        endpointId: endpoint.id,
        promptPolicyVersionId: prompt.id,
        tutorContractVersion: prompt.tutorContractVersion,
        stageContractVersion: prompt.stageContractVersion,
        extractorVersion: prompt.extractorVersion,
        createdById: admin.id,
      },
    });
    bundleId = bundle.id;

    await db.modelDeployment.update({
      where: { id: originalDeployment.id },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
    const runtimeDeployment = await db.modelDeployment.create({
      data: {
        modelVersionId: baseline.id,
        previousModelVersionId: originalDeployment.modelVersionId,
        runtimeBundleId: bundle.id,
        previousRuntimeBundleId: originalDeployment.runtimeBundleId,
        environment: 'PRODUCTION',
        rolloutPercent: 100,
        status: 'ACTIVE',
        startedAt: new Date(),
        createdById: admin.id,
      },
    });
    runtimeDeploymentId = runtimeDeployment.id;

    const assignment = await db.assignment.create({
      data: {
        classId: member.classId,
        title: `Runtime routing ${suffix}`,
      },
    });
    assignmentId = assignment.id;
    const created = await ensureStudentConversation(assignment.id, member.studentId);
    if (!created.ok) throw new Error(`创建测试会话失败：${created.error}`);
    conversationIds.push(created.conversationId);
    const beforeResolution = await db.conversation.findUniqueOrThrow({
      where: { id: created.conversationId },
      select: { deployedModelVersionId: true, deployedRuntimeBundleId: true },
    });
    check(
      '正式新会话创建时保持未固定，等待 ACTIVE 部署分桶',
      beforeResolution.deployedModelVersionId === null && beforeResolution.deployedRuntimeBundleId === null,
    );

    const resolved = await resolveConversationModel(created.conversationId);
    const afterResolution = await db.conversation.findUniqueOrThrow({
      where: { id: created.conversationId },
      select: { deployedModelVersionId: true, deployedRuntimeBundleId: true },
    });
    check('100% RuntimeBundle 部署固定到新会话', afterResolution.deployedRuntimeBundleId === bundle.id);
    check('RuntimeBundle 同时固定模型版本', afterResolution.deployedModelVersionId === baseline.id);
    check('解析结果携带 RuntimeBundle 身份', 'runtimeBundleId' in resolved && resolved.runtimeBundleId === bundle.id);
    check(
      '解析结果使用 Endpoint 远程模型与凭据',
      'runtimeConfig' in resolved
        && resolved.runtimeConfig.model === baseline.externalModelId
        && resolved.runtimeConfig.apiKey === process.env[apiKeyName],
    );

    const pinned = await db.conversation.create({
      data: {
        userId: member.studentId,
        deployedModelVersionId: baseline.id,
      },
    });
    conversationIds.push(pinned.id);
    const pinnedResolved = await resolveConversationModel(pinned.id);
    const pinnedAfter = await db.conversation.findUniqueOrThrow({
      where: { id: pinned.id },
      select: { deployedRuntimeBundleId: true },
    });
    check('已有模型固定会话不被 RuntimeBundle 部署改绑', pinnedAfter.deployedRuntimeBundleId === null);
    check('已有模型固定会话仍返回原模型', pinnedResolved.id === baseline.id && !('runtimeBundleId' in pinnedResolved));
  } finally {
    if (assignmentId) await db.studentAssignment.deleteMany({ where: { assignmentId } });
    if (conversationIds.length > 0) {
      await db.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    }
    if (assignmentId) await db.assignment.deleteMany({ where: { id: assignmentId } });
    if (runtimeDeploymentId) await db.modelDeployment.deleteMany({ where: { id: runtimeDeploymentId } });
    if (originalDeployment) {
      await db.modelDeployment.updateMany({
        where: { id: originalDeployment.id },
        data: { status: 'ACTIVE', endedAt: originalDeployment.endedAt },
      });
    }
    if (bundleId) await db.runtimeBundle.deleteMany({ where: { id: bundleId } });
    if (endpointId) await db.modelEndpoint.deleteMany({ where: { id: endpointId } });
    if (connectionId) await db.providerConnection.deleteMany({ where: { id: connectionId } });
    delete process.env[apiKeyName];
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
