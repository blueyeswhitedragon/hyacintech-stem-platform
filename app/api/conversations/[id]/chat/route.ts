import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import { checkBlacklistedKeywords, getPromptForPhase, type PromptContext } from '@/app/prompts';
import { classifyError } from '@/app/lib/llm/errors';
import { callLLM } from '@/app/lib/llm/chat';
import { extractStageData } from '@/app/lib/stageExtraction';
import { PhaseEnum, type Message } from '@/app/models/types';
import type { StageData } from '@/app/models/stageData';

/** 给阶段5用：把前序阶段内容压成一段文本摘要。 */
function buildPriorSummary(stageData: StageData): string {
  const parts: string[] = [];
  if (stageData.stage1?.snapshot) {
    parts.push(`【选题确认书】\n${stageData.stage1.snapshot}`);
    if (stageData.stage1.variables) {
      parts.push(`自变量：${stageData.stage1.variables.independent}，因变量：${stageData.stage1.variables.dependent}${stageData.stage1.variables.controlled?.length ? '，控制变量：' + stageData.stage1.variables.controlled.join('、') : ''}`);
    }
  }
  if (stageData.stage2?.schema) {
    const cols = stageData.stage2.schema.columns.map((c) => `${c.title}(${c.type})`).join('、');
    parts.push(`【实验方案-数据表列】${cols}，最少${stageData.stage2.schema.minRows}行，最多${stageData.stage2.schema.maxRows}行`);
  }
  if (stageData.stage3?.rows?.length) {
    const keys = stageData.stage2?.schema?.columns.map(c => c.key) ?? Object.keys(stageData.stage3.rows[0]);
    const titles = stageData.stage2?.schema?.columns.map(c => c.title) ?? keys;
    const header = titles.join(' | ');
    const body = stageData.stage3.rows.map((row, i) =>
      `${i + 1}. ` + keys.map(k => String(row[k] ?? '')).join(' | ')
    ).join('\n');
    parts.push(`【实验数据-共${stageData.stage3.rows.length}行】\n${header}\n${body}`);
  }
  return parts.join('\n\n') || '（前序阶段暂无结构化摘要，请参考对话历史）';
}

function buildContext(stage: number, conv: {
  topicDirection: string | null;
  stageData: StageData;
  safetyQuizCompleted: boolean;
}): PromptContext | undefined {
  switch (stage) {
    case PhaseEnum.TopicSelection:
      return conv.topicDirection ? { topicDirection: conv.topicDirection } : undefined;
    case PhaseEnum.Execution:
      return conv.safetyQuizCompleted ? undefined : { needSafetyQuiz: true };
    case PhaseEnum.DataAnalysis:
      return { dataRows: conv.stageData.stage3?.rows ?? [] };
    case PhaseEnum.ResultsFormation:
      return { priorSummary: buildPriorSummary(conv.stageData) };
    default:
      return undefined;
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
    const context = buildContext(conv.currentStage, conv);
    const systemPrompt = getPromptForPhase(conv.currentStage as PhaseEnum, context);
    const response = await callLLM(systemPrompt, message, conv.messages);

    // 结构化提取（纯函数）
    const { stageData, advanceTo } = extractStageData(conv.currentStage, response, conv.stageData);

    // 阶段4：每发一条学生消息，分析轮次 +1
    if (conv.currentStage === 4) {
      stageData.stage4 = { analysisCount: (conv.stageData.stage4?.analysisCount ?? 0) + 1 };
    }

    const userMessage: Message = { id: uuidv4(), role: 'user', content: message, status: 'sent' };
    const assistantMessage: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: response.dialogue,
      options: response.options,
      hints: response.hints,
      actionType: response.next_action_type,
      phaseComplete: response.phase_complete,
    };
    const updatedMessages = [...conv.messages, userMessage, assistantMessage];

    // 阶段推进只认 stage1 的 advanceTo（stage1_confirmed）。
    // 其余阶段一律显式推进：3→4/4→5 走 /advance 按钮，2→3/5→6 走教师审核，
    // 6→完成走 stage6-respond。phase_complete 仅作 UI 提示，不再驱动阶段。
    const nextStage = advanceTo ?? conv.currentStage;

    const stageChanged = nextStage !== conv.currentStage;
    const stageDataChanged = JSON.stringify(stageData) !== JSON.stringify(conv.stageData);

    await db.$transaction([
      db.conversation.update({
        where: { id: conversationId },
        data: {
          messages: JSON.stringify(updatedMessages),
          ...(stageDataChanged ? { stageData: JSON.stringify(stageData) } : {}),
        },
      }),
      ...(stageChanged
        ? [
            db.studentAssignment.update({
              where: { id: conv.studentAssignmentId },
              data: { currentStage: nextStage },
            }),
          ]
        : []),
    ]);

    return NextResponse.json({ ...response, currentStage: nextStage, stageData });
  } catch (err) {
    console.error('会话聊天处理出错:', err);
    const { error, detail, status } = classifyError(err);
    return NextResponse.json({ error, message: detail }, { status });
  }
}
