import { NextResponse } from 'next/server';
import { checkBlacklistedKeywords } from '@/app/prompts';
import { classifyError } from '@/app/lib/llm/errors';
import { checkRateLimit } from '@/app/lib/guestRateLimit';
import { PhaseEnum, type Message } from '@/app/models/types';
import type { Stage2Data, StageData } from '@/app/models/stageData';
import { isSystemTriggeredTurn, type StageTriggerType } from '@/app/lib/stageContract';
import { applyDeterministicExtractionFallbacks, callStudentFactExtractor, mergeExtractedFacts } from '@/app/lib/stateExtractor';
import { attachServerOwnedArtifacts, tutorFocusPlan, updateServerAnalysis, visibleDataRows } from '@/app/lib/serverTutorState';
import { buildTutorVisibleState, callTutorLanguageWithTrace, toCompatibleChatResponse } from '@/app/lib/tutorLanguage';
import { validateConfig } from '@/app/lib/llm/provider';
import { finalizeStageData } from '@/app/lib/stageState';
import { evaluateStage2Readiness } from '@/app/lib/stage2Readiness';
import { describeStage4LastRound } from '@/app/lib/stage4Readiness';
import { callAnalysisClaimExtractor, type ValidatedAnalysisClaim } from '@/app/lib/analysisClaimExtractor';

const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY = 20;

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}

// POST /api/guest/chat —— 体验模式使用 tutor-language-v1；不落库，但仍先独立提取学生事实。
export async function POST(req: Request) {
  const rl = checkRateLimit(clientIp(req));
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited', message: rl.error }, { status: 429 });

  let body: {
    message?: string;
    stage?: number;
    history?: Message[];
    dataRows?: Record<string, unknown>[];
    dataSchema?: Stage2Data['schema'];
    stageData?: StageData;
    needSafetyQuiz?: boolean;
    priorSummary?: string;
    hasStage2Schema?: boolean;
    triggerType?: StageTriggerType;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
  if (message.length > MAX_MESSAGE_LEN) return NextResponse.json({ error: `消息过长（上限 ${MAX_MESSAGE_LEN} 字）` }, { status: 400 });

  const blacklistedKeyword = checkBlacklistedKeywords(message);
  if (blacklistedKeyword) {
    return NextResponse.json({
      error: 'safety_violation', keyword: blacklistedKeyword,
      message: `您的请求包含可能存在安全风险的内容（${blacklistedKeyword}），请调整后重试。为了确保实验安全，我们建议使用更安全的替代方案。`,
    }, { status: 400 });
  }

  const stage = typeof body.stage === 'number' && body.stage >= 1 && body.stage <= 6 ? body.stage : 1;
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  const allowedTriggers: StageTriggerType[] = ['USER_MESSAGE', 'STAGE_ENTER', 'STAGE_TRANSITION', 'REPORT_BOOTSTRAP', 'OPTIONAL_COACHING'];
  const triggerType = body.triggerType && allowedTriggers.includes(body.triggerType)
    ? body.triggerType
    : stage === PhaseEnum.Execution && body.needSafetyQuiz
      ? 'STAGE_ENTER'
      : stage === PhaseEnum.ResultsFormation
        ? 'REPORT_BOOTSTRAP'
        : stage === PhaseEnum.Reflection
          ? 'OPTIONAL_COACHING'
          : 'USER_MESSAGE';

  try {
    let stageData = body.stageData ?? {};
    if ([1, 2].includes(stage) && !isSystemTriggeredTurn(triggerType)) {
      const expectedFocusId = tutorFocusPlan(stage, stageData, { triggerType }).allowedFocusIds[0];
      try {
        const extraction = await callStudentFactExtractor({
          stage,
          studentMessages: [message],
          expectedFocusId,
          existingFacts: stageData.extractedFacts,
        });
        const merged = mergeExtractedFacts(stage, stageData, extraction.accepted, {
          currentStudentMessage: message,
          expectedFocusId,
        });
        stageData = merged.stageData;
      } catch (error) {
        const deterministic = applyDeterministicExtractionFallbacks(stage, [], message, { expectedFocusId });
        if (deterministic.accepted.length > 0) {
          stageData = mergeExtractedFacts(stage, stageData, deterministic.accepted, {
            currentStudentMessage: message,
            expectedFocusId,
          }).stageData;
        }
        console.warn('Guest extractor failed; continuing with deterministic facts only:', error instanceof Error ? error.message : String(error));
      }
    }

    let analysisAccepted = false;
    if (stage === 4 && !isSystemTriggeredTurn(triggerType)) {
      // 体验模式不落库，因此没有 StateExtractionTrace；抽取失败同样只回落到确定性路径。
      let claim: ValidatedAnalysisClaim | null = null;
      try {
        claim = (await callAnalysisClaimExtractor({ stageData, studentMessage: message })).claim;
      } catch (error) {
        console.warn('Guest analysis claim extractor failed; falling back to deterministic evidence:', error instanceof Error ? error.message : String(error));
      }
      const analysis = updateServerAnalysis(stageData, message, claim);
      stageData = analysis.stageData;
      analysisAccepted = analysis.accepted;
    }

    if (!isSystemTriggeredTurn(triggerType)) {
      const previousRounds = stageData.roundCounts ?? {};
      stageData = {
        ...stageData,
        roundCounts: { ...previousRounds, [stage]: (previousRounds[stage] ?? 0) + 1 },
      };
    }

    const server = attachServerOwnedArtifacts({
      stage,
      stageData,
      triggerType,
      safetyQuizCompleted: body.needSafetyQuiz === false,
    });
    stageData = server.stageData;
    stageData = finalizeStageData(body.stageData ?? {}, stageData, {
      mutation: isSystemTriggeredTurn(triggerType) ? `GUEST_${triggerType}` : 'GUEST_USER_MESSAGE',
    });
    const focus = tutorFocusPlan(stage, stageData, { triggerType, analysisAccepted });
    const visibleFacts = stage === 4
      ? {
          研究方案: stageData.stage2?.experimentPlan,
          数据记录: visibleDataRows(stageData),
          已接受分析次数: stageData.stage4?.analysisCount ?? 0,
          上一轮判定: describeStage4LastRound(stageData.stage4),
        }
      : buildTutorVisibleState(stage, stageData, { 前序摘要: body.priorSummary });
    const config = validateConfig();
    if (!config.valid || !config.provider || !config.model) throw new Error(config.issues.join(' '));
    const stage2Readiness = stage === 2 ? evaluateStage2Readiness(stageData) : undefined;
    const tutor = await callTutorLanguageWithTrace({
      phase: stage,
      triggerType,
      currentStudentMessage: isSystemTriggeredTurn(triggerType) ? '' : message,
      priorStudentMessages: history.filter((item) => item.role === 'user').map((item) => item.content),
      tutorHistory: history.filter((item) => item.role === 'assistant' && !item.messageType).map((item) => item.content),
      visibleFacts,
      allowedFocusIds: focus.allowedFocusIds,
      focusDescriptions: focus.focusDescriptions,
      completedFocusIds: stage2Readiness?.completedFields,
      planReady: stage2Readiness?.complete,
    }, { provider: config.provider, model: config.model });
    const response = toCompatibleChatResponse(tutor.response, server.envelope);
    const publicStageData: StageData = stageData.stage3?.safetyQuiz ? {
      ...stageData,
      stage3: {
        ...stageData.stage3,
        safetyQuiz: {
          question: stageData.stage3.safetyQuiz.question,
          options: stageData.stage3.safetyQuiz.options,
          selected: stageData.stage3.safetyQuiz.selected,
          passed: stageData.stage3.safetyQuiz.passed,
        },
      },
    } : stageData;
    return NextResponse.json({ ...response, stageData: publicStageData, currentStage: stage });
  } catch (err) {
    console.error('体验模式聊天出错:', err);
    const { error, detail, status } = classifyError(err);
    return NextResponse.json({ error, message: detail }, { status });
  }
}
