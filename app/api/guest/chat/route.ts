import { NextResponse } from 'next/server';
import { checkBlacklistedKeywords } from '@/app/prompts';
import { classifyError } from '@/app/lib/llm/errors';
import { checkRateLimit } from '@/app/lib/guestRateLimit';
import { PhaseEnum, type Message } from '@/app/models/types';
import type { Stage2Data, StageData } from '@/app/models/stageData';
import type { StageTriggerType } from '@/app/lib/stageContract';
import { callStudentFactExtractor, mergeExtractedFacts } from '@/app/lib/stateExtractor';
import { attachServerOwnedArtifacts, tutorFocusPlan, updateServerAnalysis, visibleDataRows } from '@/app/lib/serverTutorState';
import { buildTutorVisibleState, callTutorLanguageWithTrace, toCompatibleChatResponse } from '@/app/lib/tutorLanguage';
import { validateConfig } from '@/app/lib/llm/provider';

const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY = 20;

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}

function isSystemTrigger(triggerType: StageTriggerType) {
  return ['STAGE_ENTER', 'STAGE_TRANSITION', 'REPORT_BOOTSTRAP'].includes(triggerType);
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
    let advanceTo: number | undefined;
    if ([1, 2].includes(stage) && !isSystemTrigger(triggerType)) {
      const sources = [...history.filter((item) => item.role === 'user').map((item) => item.content), message];
      try {
        const extraction = await callStudentFactExtractor({ stage, studentMessages: sources });
        const merged = mergeExtractedFacts(stage, stageData, extraction.accepted);
        stageData = merged.stageData;
        advanceTo = merged.advanceTo;
      } catch (error) {
        console.warn('Guest extractor failed; continuing without state write:', error instanceof Error ? error.message : String(error));
      }
    }

    let analysisAccepted = false;
    if (stage === 4 && !isSystemTrigger(triggerType)) {
      const analysis = updateServerAnalysis(stageData, message);
      stageData = analysis.stageData;
      analysisAccepted = analysis.accepted;
    }

    const server = attachServerOwnedArtifacts({
      stage,
      stageData,
      triggerType,
      safetyQuizCompleted: body.needSafetyQuiz === false,
    });
    stageData = server.stageData;
    const focus = tutorFocusPlan(stage, stageData, { triggerType, analysisAccepted });
    const visibleFacts = stage === 4
      ? { 研究方案: stageData.stage2?.experimentPlan, 数据记录: visibleDataRows(stageData), 已接受分析次数: stageData.stage4?.analysisCount ?? 0 }
      : buildTutorVisibleState(stage, stageData, { 前序摘要: body.priorSummary });
    const config = validateConfig();
    if (!config.valid || !config.provider || !config.model) throw new Error(config.issues.join(' '));
    const tutor = await callTutorLanguageWithTrace({
      phase: stage,
      triggerType,
      currentStudentMessage: isSystemTrigger(triggerType) ? '' : message,
      priorStudentMessages: history.filter((item) => item.role === 'user').map((item) => item.content),
      tutorHistory: history.filter((item) => item.role === 'assistant' && !item.messageType).map((item) => item.content),
      visibleFacts,
      allowedFocusIds: focus.allowedFocusIds,
      focusDescriptions: focus.focusDescriptions,
    }, { provider: config.provider, model: config.model });
    const response = toCompatibleChatResponse(tutor.response, server.envelope);
    return NextResponse.json({ ...response, stageData, currentStage: advanceTo ?? stage });
  } catch (err) {
    console.error('体验模式聊天出错:', err);
    const { error, detail, status } = classifyError(err);
    return NextResponse.json({ error, message: detail }, { status });
  }
}
