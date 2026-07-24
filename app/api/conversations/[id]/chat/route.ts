import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import { checkBlacklistedKeywords, getPromptForPhase, type PromptContext } from '@/app/prompts';
import { classifyError } from '@/app/lib/llm/errors';
import { callLLMWithTrace } from '@/app/lib/llm/chat';
import { persistGenerationTurn } from '@/app/lib/generationTrace';
import {
  type RuntimeModelIdentity,
} from '@/app/lib/modelRegistry';
import { resolveConversationModel } from '@/app/lib/deployment';
import { extractStageData } from '@/app/lib/stageExtraction';
import { resolveChatContractBranch, runNewTutorTurn } from '@/app/lib/tutorTurn';
import { buildPriorSummary } from '@/app/lib/reportSummary';
import { shouldNudgeConvergence } from '@/app/lib/pacing';
import { PhaseEnum, type Message } from '@/app/models/types';
import type { StageData } from '@/app/models/stageData';
import { studentVisibleStageData } from '@/app/lib/stageState';

function buildContext(stage: number, conv: {
  topicDirection: string | null;
  stageData: StageData;
  safetyQuizCompleted: boolean;
  styleFamily: import('@/app/lib/stylePolicy').StyleFamily;
  stylePolicyVersion: string;
}): PromptContext | undefined {
  const styleContext: PromptContext = {
    styleFamily: conv.styleFamily,
    stylePolicyVersion: conv.stylePolicyVersion,
    triggerType: 'USER_MESSAGE',
  };
  switch (stage) {
    case PhaseEnum.TopicSelection:
      return conv.topicDirection ? { ...styleContext, topicDirection: conv.topicDirection } : styleContext;
    case PhaseEnum.PlanDesign:
      return {
        ...styleContext,
        priorSummary: buildPriorSummary(conv.stageData),
      };
    case PhaseEnum.Execution:
      return {
        ...styleContext,
        priorSummary: buildPriorSummary(conv.stageData),
        ...(conv.safetyQuizCompleted
          ? {}
          : { needSafetyQuiz: true, triggerType: 'STAGE_ENTER' as const }),
      };
    case PhaseEnum.DataAnalysis:
      return {
        ...styleContext,
        dataRows: conv.stageData.stage3?.rows ?? [],
        dataSchema: conv.stageData.stage2?.schema,
      };
    case PhaseEnum.ResultsFormation:
      return {
        ...styleContext,
        priorSummary: buildPriorSummary(conv.stageData),
        triggerType: conv.stageData.stage5?.sections ? 'USER_MESSAGE' : 'REPORT_BOOTSTRAP',
      };
    case PhaseEnum.Reflection:
      return {
        ...styleContext,
        priorSummary: buildPriorSummary(conv.stageData),
        triggerType: 'OPTIONAL_COACHING',
      };
    default:
      return styleContext;
  }
}

// POST /api/conversations/[id]/chat —— 学生在会话内发消息（阶段由服务端决定，结构化产出落库）
export async function POST(req: Request, ctx: RouteContext<'/api/conversations/[id]/chat'>) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;

  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
  }

  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) {
    return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  }
  if (conv.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: '当前作业已提交或完成，暂不能继续发送消息' }, { status: 409 });
  }

  const blacklistedKeyword = checkBlacklistedKeywords(message);
  if (blacklistedKeyword) {
    return NextResponse.json(
      {
        error: 'safety_violation',
        keyword: blacklistedKeyword,
        message: `您的请求包含可能存在安全风险的内容（${blacklistedKeyword}），请调整后重试。为了确保实验安全，我们建议使用更安全的替代方案。`,
      },
      { status: 400 }
    );
  }

  try {
    const stage = conv.currentStage;
    const prevRounds = conv.stageData.roundCounts ?? {};
    const roundCount = (prevRounds[stage] ?? 0) + 1;
    const modelVersion = await resolveConversationModel(conversationId);
    const modelIdentity: RuntimeModelIdentity = {
      tag: modelVersion.tag,
      provider: modelVersion.provider,
      externalModelId: modelVersion.externalModelId,
      promptPolicyVersion: modelVersion.promptPolicyVersion,
      contractVersion: modelVersion.contractVersion,
    };

    const contractBranch = resolveChatContractBranch(conv.contractVersion, modelVersion.contractVersion);
    if (contractBranch === 'TUTOR_LANGUAGE_V1') {
      const turn = await runNewTutorTurn({ conversationId, message, conv, modelIdentity });
      const stageData = turn.stageData;
      const updatedMessages = [...conv.messages, turn.userMessage, turn.assistantMessage];
      if (turn.response.stage1_confirmed && turn.response.snapshot) {
        updatedMessages.push({
          id: uuidv4(),
          role: 'assistant',
          content: turn.response.snapshot,
          messageType: 'confirmation_doc',
        });
      }
      const nextStage = stage;
      await persistGenerationTurn({
        conversationId,
        studentAssignmentId: conv.studentAssignmentId,
        currentStage: stage,
        nextStage,
        updatedMessages,
        stageData,
        stageDataChanged: JSON.stringify(stageData) !== JSON.stringify(conv.stageData),
        userMessageId: turn.userMessage.id,
        assistantMessageId: turn.assistantMessage.id,
        userMessage: message,
        systemPrompt: turn.systemPrompt,
        systemPromptTemplate: turn.systemPromptTemplate,
        trainingSystemPromptSnapshot: conv.dataConsentStatus === 'GRANTED' ? turn.systemPrompt : '',
        response: turn.response,
        modelVersionId: modelVersion.id,
        modelIdentity,
        // 历史列保留为空；新合同不消费五风格。
        styleFamily: '',
        stylePolicyVersion: '',
        generationParams: turn.generationParams,
        contractCheck: turn.contractCheck,
        triggerType: stage === PhaseEnum.Execution && !conv.safetyQuizCompleted
          ? 'STAGE_ENTER'
          : stage === PhaseEnum.ResultsFormation && !conv.stageData.stage5?.sections
            ? 'REPORT_BOOTSTRAP'
            : stage === PhaseEnum.Reflection
              ? 'OPTIONAL_COACHING'
              : 'USER_MESSAGE',
      });
      return NextResponse.json({ ...turn.response, currentStage: nextStage, stageData: studentVisibleStageData(stageData) });
    }

    // 历史会话继续走 stage-contract-v2，不改变既有解析、风格快照和结构化产物。
    let context = buildContext(stage, conv);
    if (shouldNudgeConvergence(stage, roundCount)) {
      context = { ...(context ?? {}), nudgeConverge: true };
    }
    const systemPrompt = getPromptForPhase(stage as PhaseEnum, context);
    const visibleContext = stage === PhaseEnum.DataAnalysis
      ? JSON.stringify({ schema: context?.dataSchema, rows: context?.dataRows ?? [], rowNumbers: (context?.dataRows ?? []).map((_, index) => index + 1) })
      : JSON.stringify({ stageData: conv.stageData, priorSummary: context?.priorSummary });
    const llmResult = await callLLMWithTrace(systemPrompt, message, conv.messages, {
      stage,
      hasStage2Schema: (conv.stageData.stage2?.schema.columns.length ?? 0) > 0,
      triggerType: context?.triggerType ?? 'USER_MESSAGE',
      visibleContext,
    }, { provider: modelVersion.provider, model: modelVersion.externalModelId });
    const response = llmResult.response;
    const { stageData, advanceTo } = extractStageData(conv.currentStage, response, conv.stageData, {
      studentMessage: message,
      dataRows: conv.stageData.stage3?.rows ?? [],
    });
    stageData.roundCounts = { ...prevRounds, [stage]: roundCount };
    const userMessage: Message = { id: uuidv4(), role: 'user', content: message, status: 'sent' };
    const assistantMessage: Message = {
      id: uuidv4(), role: 'assistant', content: response.dialogue, options: response.options,
      hints: response.hints, actionType: response.next_action_type, phaseComplete: response.phase_complete,
    };
    const updatedMessages = [...conv.messages, userMessage, assistantMessage];
    if (response.stage1_confirmed && response.snapshot) {
      updatedMessages.push({ id: uuidv4(), role: 'assistant', content: response.snapshot, messageType: 'confirmation_doc' });
    }
    const nextStage = advanceTo ?? conv.currentStage;
    await persistGenerationTurn({
      conversationId,
      studentAssignmentId: conv.studentAssignmentId,
      currentStage: conv.currentStage,
      nextStage,
      updatedMessages,
      stageData,
      stageDataChanged: JSON.stringify(stageData) !== JSON.stringify(conv.stageData),
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      userMessage: message,
      systemPrompt,
      trainingSystemPromptSnapshot: conv.dataConsentStatus === 'GRANTED' ? systemPrompt : '',
      response,
      modelVersionId: modelVersion.id,
      modelIdentity,
      styleFamily: conv.styleFamily,
      stylePolicyVersion: conv.stylePolicyVersion,
      generationParams: llmResult.trace.generationParams,
      contractCheck: llmResult.trace.contractCheck,
      triggerType: context?.triggerType ?? 'USER_MESSAGE',
    });
    return NextResponse.json({ ...response, currentStage: nextStage, stageData: studentVisibleStageData(stageData) });
  } catch (err) {
    console.error('会话聊天处理出错:', err);
    const { error, detail, status } = classifyError(err);
    return NextResponse.json({ error, message: detail }, { status });
  }
}
