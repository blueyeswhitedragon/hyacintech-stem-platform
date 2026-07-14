import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireUser } from '@/app/lib/auth';
import { db } from '@/app/lib/db';
import { getConversationForUser } from '@/app/lib/conversation';
import { canAdvance } from '@/app/lib/stageAdvance';
import { checkBlacklistedKeywords, getPromptForPhase, type PromptContext } from '@/app/prompts';
import { PhaseEnum } from '@/app/models/types';
import { callLLMWithTrace } from '@/app/lib/llm/chat';
import { classifyError } from '@/app/lib/llm/errors';
import { resolveConversationModel } from '@/app/lib/deployment';
import type { RuntimeModelIdentity } from '@/app/lib/modelRegistry';
import { persistGenerationTurn } from '@/app/lib/generationTrace';
import { buildAssistantTransitionMessage, buildStage4TransitionResult } from '@/app/lib/stageTransition';
import { buildPriorSummary } from '@/app/lib/reportSummary';
import { extractStageData } from '@/app/lib/stageExtraction';

const STAGE2_TRANSITION_TRIGGER = '系统触发：学生已确认选题。请发送阶段2方案设计的开场，只推进第一个方案缺口。';
const STAGE4_TRANSITION_TRIGGER = '系统触发：学生已完成数据收集。请读取已提交的数据表，并发送阶段4的数据分析开场。';
const STAGE5_BOOTSTRAP_TRIGGER = '系统触发：学生已完成数据分析。请依据前序结构化状态生成阶段5报告框架。';

// POST /api/conversations/[id]/advance —— 学生点按钮推进阶段（带 gating）
// body: { to: number }
export async function POST(req: Request, ctx: RouteContext<'/api/conversations/[id]/advance'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;

  let body: { to?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  if (typeof body.to !== 'number') {
    return NextResponse.json({ error: '缺少目标阶段 to' }, { status: 400 });
  }

  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) {
    return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  }

  const check = canAdvance(conv.currentStage, body.to, conv.stageData, {
    safetyQuizCompleted: conv.safetyQuizCompleted,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  // 1→2：助手主动承接已确认选题，不再用可见伪用户消息触发。
  if (conv.currentStage === 1 && body.to === 2) {
    if (checkBlacklistedKeywords(STAGE2_TRANSITION_TRIGGER)) {
      return NextResponse.json({ error: '系统过渡提示触发安全规则' }, { status: 500 });
    }
    try {
      const priorSummary = buildPriorSummary(conv.stageData);
      const promptContext: PromptContext = {
        styleFamily: conv.styleFamily,
        stylePolicyVersion: conv.stylePolicyVersion,
        priorSummary,
        triggerType: 'STAGE_TRANSITION',
      };
      const systemPrompt = getPromptForPhase(PhaseEnum.PlanDesign, promptContext);
      const modelVersion = await resolveConversationModel(conversationId);
      const modelIdentity: RuntimeModelIdentity = {
        tag: modelVersion.tag,
        provider: modelVersion.provider,
        externalModelId: modelVersion.externalModelId,
        promptPolicyVersion: modelVersion.promptPolicyVersion,
        contractVersion: modelVersion.contractVersion,
      };
      const llmResult = await callLLMWithTrace(systemPrompt, STAGE2_TRANSITION_TRIGGER, conv.messages, {
        stage: 2,
        triggerType: 'STAGE_TRANSITION',
        visibleContext: JSON.stringify({ stageData: conv.stageData, priorSummary }),
      }, { provider: modelVersion.provider, model: modelVersion.externalModelId });
      const transitionMessage = buildAssistantTransitionMessage(llmResult.response, uuidv4());
      await persistGenerationTurn({
        conversationId,
        studentAssignmentId: conv.studentAssignmentId,
        currentStage: 1,
        nextStage: 2,
        traceStage: 2,
        triggerType: 'STAGE_TRANSITION',
        updatedMessages: [...conv.messages, transitionMessage],
        stageData: conv.stageData,
        stageDataChanged: false,
        userMessageId: uuidv4(),
        assistantMessageId: transitionMessage.id,
        userMessage: STAGE2_TRANSITION_TRIGGER,
        systemPrompt,
        response: llmResult.response,
        modelVersionId: modelVersion.id,
        modelIdentity,
        styleFamily: conv.styleFamily,
        stylePolicyVersion: conv.stylePolicyVersion,
        generationParams: llmResult.trace.generationParams,
        contractCheck: llmResult.trace.contractCheck,
      });
      return NextResponse.json({ currentStage: 2, stageData: conv.stageData, transitionMessage });
    } catch (error) {
      console.error('阶段1→2过渡生成失败:', error);
      const classified = classifyError(error);
      return NextResponse.json({ error: classified.error, message: classified.detail }, { status: classified.status });
    }
  }

  // 3→4 必须先生成并原子持久化 AI 主动分析开场；生成失败时仍停留在阶段3，允许重试。
  if (conv.currentStage === 3 && body.to === 4) {
    const blockedKeyword = checkBlacklistedKeywords(STAGE4_TRANSITION_TRIGGER);
    if (blockedKeyword) {
      return NextResponse.json({ error: '系统过渡提示触发安全规则' }, { status: 500 });
    }

    try {
      const rows = conv.stageData.stage3?.rows ?? [];
      const schema = conv.stageData.stage2?.schema;
      const promptContext: PromptContext = {
        styleFamily: conv.styleFamily,
        stylePolicyVersion: conv.stylePolicyVersion,
        dataRows: rows,
        dataSchema: schema,
        triggerType: 'STAGE_TRANSITION',
      };
      const systemPrompt = getPromptForPhase(PhaseEnum.DataAnalysis, promptContext);
      const modelVersion = await resolveConversationModel(conversationId);
      const modelIdentity: RuntimeModelIdentity = {
        tag: modelVersion.tag,
        provider: modelVersion.provider,
        externalModelId: modelVersion.externalModelId,
        promptPolicyVersion: modelVersion.promptPolicyVersion,
        contractVersion: modelVersion.contractVersion,
      };
      const visibleContext = JSON.stringify({ schema, rows, rowNumbers: rows.map((_, index) => index + 1) });
      const llmResult = await callLLMWithTrace(
        systemPrompt,
        STAGE4_TRANSITION_TRIGGER,
        conv.messages,
        {
          stage: 4,
          triggerType: 'STAGE_TRANSITION',
          visibleContext,
        },
        { provider: modelVersion.provider, model: modelVersion.externalModelId },
      );
      const response = llmResult.response;
      const { stageData, transitionMessage } = buildStage4TransitionResult(
        conv.stageData,
        response,
        uuidv4(),
      );

      await persistGenerationTurn({
        conversationId,
        studentAssignmentId: conv.studentAssignmentId,
        currentStage: 3,
        nextStage: 4,
        traceStage: 4,
        triggerType: 'STAGE_TRANSITION',
        updatedMessages: [...conv.messages, transitionMessage],
        stageData,
        stageDataChanged: true,
        userMessageId: uuidv4(),
        assistantMessageId: transitionMessage.id,
        userMessage: STAGE4_TRANSITION_TRIGGER,
        systemPrompt,
        response,
        modelVersionId: modelVersion.id,
        modelIdentity,
        styleFamily: conv.styleFamily,
        stylePolicyVersion: conv.stylePolicyVersion,
        generationParams: llmResult.trace.generationParams,
        contractCheck: llmResult.trace.contractCheck,
      });

      return NextResponse.json({
        currentStage: 4,
        stageData,
        transitionMessage,
      });
    } catch (error) {
      console.error('阶段3→4过渡生成失败:', error);
      const classified = classifyError(error);
      return NextResponse.json(
        { error: classified.error, message: classified.detail },
        { status: classified.status },
      );
    }
  }

  // 4→5：报告框架由系统触发并以助手主动消息出现，不写入伪用户消息。
  if (conv.currentStage === 4 && body.to === 5) {
    if (checkBlacklistedKeywords(STAGE5_BOOTSTRAP_TRIGGER)) {
      return NextResponse.json({ error: '系统过渡提示触发安全规则' }, { status: 500 });
    }
    try {
      const priorSummary = buildPriorSummary(conv.stageData);
      const promptContext: PromptContext = {
        styleFamily: conv.styleFamily,
        stylePolicyVersion: conv.stylePolicyVersion,
        priorSummary,
        triggerType: 'REPORT_BOOTSTRAP',
      };
      const systemPrompt = getPromptForPhase(PhaseEnum.ResultsFormation, promptContext);
      const modelVersion = await resolveConversationModel(conversationId);
      const modelIdentity: RuntimeModelIdentity = {
        tag: modelVersion.tag,
        provider: modelVersion.provider,
        externalModelId: modelVersion.externalModelId,
        promptPolicyVersion: modelVersion.promptPolicyVersion,
        contractVersion: modelVersion.contractVersion,
      };
      const llmResult = await callLLMWithTrace(systemPrompt, STAGE5_BOOTSTRAP_TRIGGER, conv.messages, {
        stage: 5,
        triggerType: 'REPORT_BOOTSTRAP',
        visibleContext: JSON.stringify({ stageData: conv.stageData, priorSummary }),
      }, { provider: modelVersion.provider, model: modelVersion.externalModelId });
      const { stageData } = extractStageData(5, llmResult.response, conv.stageData);
      const transitionMessage = buildAssistantTransitionMessage(llmResult.response, uuidv4());
      await persistGenerationTurn({
        conversationId,
        studentAssignmentId: conv.studentAssignmentId,
        currentStage: 4,
        nextStage: 5,
        traceStage: 5,
        triggerType: 'REPORT_BOOTSTRAP',
        updatedMessages: [...conv.messages, transitionMessage],
        stageData,
        stageDataChanged: true,
        userMessageId: uuidv4(),
        assistantMessageId: transitionMessage.id,
        userMessage: STAGE5_BOOTSTRAP_TRIGGER,
        systemPrompt,
        response: llmResult.response,
        modelVersionId: modelVersion.id,
        modelIdentity,
        styleFamily: conv.styleFamily,
        stylePolicyVersion: conv.stylePolicyVersion,
        generationParams: llmResult.trace.generationParams,
        contractCheck: llmResult.trace.contractCheck,
      });
      return NextResponse.json({ currentStage: 5, stageData, transitionMessage });
    } catch (error) {
      console.error('阶段4→5报告初始化失败:', error);
      const classified = classifyError(error);
      return NextResponse.json({ error: classified.error, message: classified.detail }, { status: classified.status });
    }
  }

  const advanced = await db.studentAssignment.updateMany({
    where: { id: conv.studentAssignmentId, currentStage: conv.currentStage },
    data: { currentStage: body.to },
  });
  if (advanced.count !== 1) {
    return NextResponse.json({ error: '阶段已变化，请刷新后重试' }, { status: 409 });
  }
  return NextResponse.json({ currentStage: body.to, stageData: conv.stageData });
}
