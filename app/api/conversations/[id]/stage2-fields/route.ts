import { NextResponse } from 'next/server';
import { requireUser } from '@/app/lib/auth';
import { getConversationForUser } from '@/app/lib/conversation';
import { db } from '@/app/lib/db';
import { advanceHint } from '@/app/lib/advanceHint';
import { mergeExtractedFacts, type ExtractedFact } from '@/app/lib/stateExtractor';
import { finalizeStageData, studentVisibleStageData } from '@/app/lib/stageState';
import type { Stage2CoreField } from '@/app/models/stageData';

const FIELD_TO_LEDGER: Record<Stage2CoreField, string> = {
  independent_variable: 'stage2.independentVariable.name',
  levels: 'stage2.independentVariable.levels',
  dependent_variable: 'stage2.dependentVariable.name',
  measurement_tool: 'stage2.measurement.tool',
  measurement_timing: 'stage2.measurement.timing',
  recorded_fields: 'stage2.recordedFields',
  procedure: 'stage2.procedure',
  controls: 'stage2.controlledVariables',
  repeats: 'stage2.repeatCount',
  hypothesis: 'stage2.hypothesis',
};

const LIST_FIELDS = new Set<Stage2CoreField>(['levels', 'recorded_fields', 'procedure', 'controls']);

function splitList(field: Stage2CoreField, raw: string): string[] {
  if (field === 'controls' && /^(?:无|没有|不需要|无需)(?:额外|其他)?(?:控制条件)?$/.test(raw.trim())) return [];
  const separator = field === 'procedure' ? /[\n；;]/ : /[\n，,、；;\/]|和|与/;
  return [...new Set(raw.split(separator).map((item) => item.trim()).filter(Boolean))];
}

function toFact(field: Stage2CoreField, input: unknown): { fact?: ExtractedFact; error?: string } {
  if (typeof input !== 'string') return { error: `字段 ${field} 必须是文本` };
  const sourceQuote = input.trim();
  if (!sourceQuote || sourceQuote.length > 600) return { error: `字段 ${field} 不能为空且不得超过 600 字` };

  let value: unknown = sourceQuote;
  if (field === 'repeats') {
    const parsed = Number(sourceQuote);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) return { error: '独立重复次数必须是 1 到 20 的整数' };
    value = parsed;
  } else if (LIST_FIELDS.has(field)) {
    value = splitList(field, sourceQuote);
    if (field === 'levels' && (value as string[]).length < 2) return { error: '请填写至少两个不同的变量水平' };
    if (field !== 'controls' && (value as string[]).length === 0) return { error: `字段 ${field} 至少需要一项` };
  }

  return {
    fact: {
      field: FIELD_TO_LEDGER[field],
      value,
      sourceQuote,
      origin: 'student_form',
    },
  };
}

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/conversations/[id]/stage2-fields'>,
) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: conversationId } = await ctx.params;
  let body: { fields?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const entries = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
    ? Object.entries(body.fields)
    : [];
  if (entries.length === 0) return NextResponse.json({ error: '请至少填写一个方案字段' }, { status: 400 });

  const facts: ExtractedFact[] = [];
  for (const [key, value] of entries) {
    if (!Object.hasOwn(FIELD_TO_LEDGER, key)) {
      return NextResponse.json({ error: `不支持的方案字段：${key}` }, { status: 400 });
    }
    const parsed = toFact(key as Stage2CoreField, value);
    if (!parsed.fact) return NextResponse.json({ error: parsed.error }, { status: 400 });
    facts.push(parsed.fact);
  }

  const conv = await getConversationForUser(conversationId, auth.user.id);
  if (!conv) return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  if (conv.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: '当前作业已提交或完成，不能修改' }, { status: 409 });
  }
  if (conv.currentStage !== 2) {
    return NextResponse.json({ error: '当前不在方案设计阶段' }, { status: 400 });
  }

  const merged = mergeExtractedFacts(2, conv.stageData, facts, {
    currentStudentMessage: facts.map((fact) => fact.sourceQuote).join('\n'),
  }).stageData;
  const stageData = finalizeStageData(conv.stageData, merged, {
    mutation: 'STAGE2_STUDENT_FIELDS_SAVED',
    promptPolicyVersion: conv.stageData.contractMeta?.promptPolicyVersion,
    serverArtifactTypes: merged.stage2?.planDraft ? ['experiment_plan'] : [],
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: { stageData: JSON.stringify(stageData) },
  });

  return NextResponse.json({
    stageData: studentVisibleStageData(stageData),
    advanceHint: advanceHint({ currentStage: conv.currentStage, stageData, safetyQuizCompleted: conv.safetyQuizCompleted }),
  });
}
