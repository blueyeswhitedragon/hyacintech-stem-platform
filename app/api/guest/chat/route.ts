import { NextResponse } from 'next/server';
import { checkBlacklistedKeywords, getPromptForPhase, type PromptContext } from '@/app/prompts';
import { classifyError } from '@/app/lib/llm/errors';
import { callLLM } from '@/app/lib/llm/chat';
import { checkRateLimit } from '@/app/lib/guestRateLimit';
import { PhaseEnum, type Message } from '@/app/models/types';
import type { Stage2Data } from '@/app/models/stageData';
import type { StageTriggerType } from '@/app/lib/stageContract';

const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY = 20;

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}

// POST /api/guest/chat —— 体验模式聊天（免登录，限流，不落库）
export async function POST(req: Request) {
  const rl = checkRateLimit(clientIp(req));
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate_limited', message: rl.error }, { status: 429 });
  }

  let body: {
    message?: string;
    stage?: number;
    history?: Message[];
    dataRows?: Record<string, unknown>[];
    dataSchema?: Stage2Data['schema'];
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
  if (message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: `消息过长（上限 ${MAX_MESSAGE_LEN} 字）` }, { status: 400 });
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

  const stage = typeof body.stage === 'number' && body.stage >= 1 && body.stage <= 6 ? body.stage : 1;
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];

  const allowedTriggers: StageTriggerType[] = [
    'USER_MESSAGE', 'STAGE_ENTER', 'STAGE_TRANSITION', 'REPORT_BOOTSTRAP', 'OPTIONAL_COACHING',
  ];
  const triggerType = body.triggerType && allowedTriggers.includes(body.triggerType)
    ? body.triggerType
    : stage === PhaseEnum.Execution && body.needSafetyQuiz
      ? 'STAGE_ENTER'
      : stage === PhaseEnum.ResultsFormation
        ? 'REPORT_BOOTSTRAP'
        : stage === PhaseEnum.Reflection
          ? 'OPTIONAL_COACHING'
          : 'USER_MESSAGE';
  const context: PromptContext = { triggerType };
  if (stage === PhaseEnum.PlanDesign && body.priorSummary) {
    context.priorSummary = body.priorSummary;
  }
  if (stage === PhaseEnum.Execution) {
    if (body.needSafetyQuiz) context.needSafetyQuiz = true;
    if (body.priorSummary) context.priorSummary = body.priorSummary;
  }
  if (stage === PhaseEnum.DataAnalysis) {
    context.dataRows = body.dataRows ?? [];
    context.dataSchema = body.dataSchema;
  }
  if ((stage === PhaseEnum.ResultsFormation || stage === PhaseEnum.Reflection) && body.priorSummary) {
    context.priorSummary = body.priorSummary;
  }

  try {
    const systemPrompt = getPromptForPhase(stage as PhaseEnum, context);
    const visibleContext = stage === PhaseEnum.DataAnalysis
      ? JSON.stringify({ schema: body.dataSchema, rows: body.dataRows ?? [], rowNumbers: (body.dataRows ?? []).map((_, index) => index + 1) })
      : body.priorSummary;
    const response = await callLLM(systemPrompt, message, history, {
      stage,
      hasStage2Schema: body.hasStage2Schema === true,
      triggerType,
      visibleContext,
    });
    return NextResponse.json(response);
  } catch (err) {
    console.error('体验模式聊天出错:', err);
    const { error, detail, status } = classifyError(err);
    return NextResponse.json({ error, message: detail }, { status });
  }
}
