#!/usr/bin/env tsx
import { randomUUID } from 'crypto';
import { db } from '../app/lib/db';
import {
  buildGenerationTraceData,
  persistGenerationTurn,
  type GenerationTraceInput,
} from '../app/lib/generationTrace';
import {
  CHAT_CONTRACT_VERSION,
  PROMPT_POLICY_VERSION,
} from '../app/lib/modelRegistry';
import type { Message } from '../app/models/types';

let passed = 0;
let failed = 0;

function check(condition: unknown, label: string) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

async function main() {
  const suffix = randomUUID();
  const student = await db.user.findFirst({ where: { role: 'student' } });
  if (!student) throw new Error('缺少测试学生');

  const model = await db.modelVersion.create({
    data: {
      tag: `trace-test-${suffix}`,
      provider: 'test',
      externalModelId: 'deterministic-test-model',
      promptPolicyVersion: PROMPT_POLICY_VERSION,
      contractVersion: CHAT_CONTRACT_VERSION,
      status: 'DRAFT',
    },
  });
  const conversation = await db.conversation.create({
    data: {
      userId: student.id,
      messages: '[]',
      stageData: '{}',
      traceCoverage: 'COMPLETE',
    },
  });

  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const secretLikeStudentText = `学生实验内容-${suffix}`;
  const messages: Message[] = [
    { id: userMessageId, role: 'user', content: secretLikeStudentText },
    { id: assistantMessageId, role: 'assistant', content: '请先明确控制变量。' },
  ];
  const input: GenerationTraceInput = {
    conversationId: conversation.id,
    studentAssignmentId: 'unused-without-stage-change',
    currentStage: 2,
    nextStage: 2,
    updatedMessages: messages,
    stageData: { roundCounts: { 2: 1 } },
    stageDataChanged: true,
    userMessageId,
    assistantMessageId,
    userMessage: secretLikeStudentText,
    systemPrompt: '阶段2系统提示词',
    response: {
      dialogue: '请先明确控制变量。',
      next_action_type: 'text_input',
      phase_complete: false,
    },
    modelVersionId: model.id,
    modelIdentity: {
      tag: model.tag,
      provider: model.provider,
      externalModelId: model.externalModelId,
      promptPolicyVersion: model.promptPolicyVersion,
      contractVersion: model.contractVersion,
    },
    styleFamily: 'evidence_analyst',
    stylePolicyVersion: 'style-v1',
    generationParams: { temperature: 0.3, successfulAttempt: 1 },
    contractCheck: { ok: true, repairs: [] },
  };

  const traceData = buildGenerationTraceData(input);
  check(traceData.requestMessageSha256.length === 64, '请求只保存 SHA-256 指纹');
  check(
    !JSON.stringify(traceData).includes(secretLikeStudentText),
    '轨迹数据不保存原始学生请求内容'
  );
  check(traceData.promptSha256.length === 64, '系统提示词保存 SHA-256 指纹');
  check(traceData.systemPromptSnapshot === '阶段2系统提示词', '轨迹保存完整生产 system prompt 供训练上下文追溯');
  check(traceData.triggerType === 'USER_MESSAGE', '普通教学轮次默认标记 USER_MESSAGE');

  await persistGenerationTurn(input);
  const [storedConversation, storedTrace] = await Promise.all([
    db.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    db.generationTrace.findUniqueOrThrow({ where: { assistantMessageId } }),
  ]);
  check(storedConversation.messages === JSON.stringify(messages), '消息与轨迹在同一事务落库');
  check(storedTrace.modelVersionId === model.id, '轨迹关联稳定模型版本');
  check(storedTrace.styleFamily === 'evidence_analyst', '轨迹固化目标风格');
  check(storedTrace.systemPromptSnapshot === '阶段2系统提示词', '数据库轨迹持久化完整 system prompt');

  let duplicateRejected = false;
  try {
    await persistGenerationTurn({
      ...input,
      updatedMessages: [
        ...messages,
        { id: randomUUID(), role: 'assistant', content: '不应被保存' },
      ],
    });
  } catch {
    duplicateRejected = true;
  }
  const afterRejected = await db.conversation.findUniqueOrThrow({
    where: { id: conversation.id },
  });
  check(duplicateRejected, '重复 assistantMessageId 被不可变约束拒绝');
  check(
    afterRejected.messages === JSON.stringify(messages),
    '轨迹写入失败时消息更新同步回滚'
  );
  check(
    (await db.generationTrace.count({ where: { conversationId: conversation.id } })) === 1,
    '同一导师回复只能拥有一条生成轨迹'
  );

  const legacyConversation = await db.conversation.create({
    data: { userId: student.id, messages: '[]', stageData: '{}' },
  });
  check(
    legacyConversation.traceCoverage === 'LEGACY_UNVERIFIED',
    '未显式建立追踪覆盖的历史式会话默认隔离'
  );

  await db.generationTrace.deleteMany({ where: { conversationId: conversation.id } });
  await db.conversation.delete({ where: { id: legacyConversation.id } });
  await db.conversation.delete({ where: { id: conversation.id } });
  await db.modelVersion.delete({ where: { id: model.id } });

  console.log(`\nGeneration trace tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
