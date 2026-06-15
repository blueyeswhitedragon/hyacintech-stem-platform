import { ChatResponse } from '../../models/types';

function extractJSON(raw: string): unknown {
  const trimmed = raw.trim();

  // Strategy 1: direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // Strategy 2: extract from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  // Strategy 3: brace matching — find first { to last }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // continue
    }
  }

  throw new Error('Failed to extract JSON from LLM response');
}

function validateChatResponse(obj: unknown): ChatResponse {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('Parsed value is not an object');
  }

  const raw = obj as Record<string, unknown>;

  const dialogue = typeof raw.dialogue === 'string' && raw.dialogue.length > 0
    ? raw.dialogue
    : '抱歉，我暂时无法处理您的请求，请重新描述您的问题。';

  const validActionTypes = ['ask_choice', 'text_input', 'confirmation', 'info'];
  const next_action_type = typeof raw.next_action_type === 'string' && validActionTypes.includes(raw.next_action_type)
    ? raw.next_action_type as ChatResponse['next_action_type']
    : 'text_input';

  const options = Array.isArray(raw.options) && raw.options.every((o: unknown) => typeof o === 'string')
    ? raw.options as string[]
    : undefined;

  const phase_complete = typeof raw.phase_complete === 'boolean'
    ? raw.phase_complete
    : false;

  return {
    dialogue,
    next_action_type,
    options,
    phase_complete,
    ...extractStructuredFields(raw),
  };
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

/**
 * 透传 M4 结构化字段：形状合法才保留，畸形则丢弃（绝不抛错）。
 */
function extractStructuredFields(raw: Record<string, unknown>): Partial<ChatResponse> {
  const out: Partial<ChatResponse> = {};

  // 阶段1
  if (raw.stage1_confirmed === true) out.stage1_confirmed = true;
  if (isStr(raw.snapshot)) out.snapshot = raw.snapshot;
  if (
    raw.variables &&
    typeof raw.variables === 'object' &&
    isStr((raw.variables as Record<string, unknown>).independent) &&
    isStr((raw.variables as Record<string, unknown>).dependent)
  ) {
    const v = raw.variables as Record<string, string>;
    out.variables = { independent: v.independent, dependent: v.dependent };
  }

  // 阶段2 数据表结构
  const dts = raw.data_table_schema as Record<string, unknown> | undefined;
  if (dts && Array.isArray(dts.columns)) {
    const columns = dts.columns.filter(
      (c): c is { key: string; title: string; type: 'text' | 'number' | 'image'; required: boolean } =>
        !!c &&
        typeof c === 'object' &&
        isStr((c as Record<string, unknown>).key) &&
        isStr((c as Record<string, unknown>).title) &&
        ['text', 'number', 'image'].includes((c as Record<string, unknown>).type as string)
    ).map((c) => ({
      key: c.key,
      title: c.title,
      type: c.type,
      required: (c as Record<string, unknown>).required === true,
    }));
    if (columns.length > 0) {
      out.data_table_schema = {
        columns,
        minRows: typeof dts.minRows === 'number' ? dts.minRows : 1,
        maxRows: typeof dts.maxRows === 'number' ? dts.maxRows : 200,
      };
    }
  }

  // 阶段2 风险标注
  if (Array.isArray(raw.risks)) {
    const risks = raw.risks
      .filter(
        (r): r is Record<string, unknown> =>
          !!r && typeof r === 'object' && isStr((r as Record<string, unknown>).description)
      )
      .map((r) => ({
        columnKey: isStr(r.columnKey) ? (r.columnKey as string) : undefined,
        description: r.description as string,
        severity: (['low', 'medium', 'high'].includes(r.severity as string)
          ? r.severity
          : 'low') as 'low' | 'medium' | 'high',
      }));
    if (risks.length > 0) out.risks = risks;
  }

  // 阶段3 安全问答
  const sq = raw.safety_quiz as Record<string, unknown> | undefined;
  if (
    sq &&
    isStr(sq.question) &&
    Array.isArray(sq.options) &&
    sq.options.every(isStr) &&
    sq.options.length >= 2 &&
    typeof sq.correct === 'number' &&
    sq.correct >= 0 &&
    sq.correct < sq.options.length
  ) {
    out.safety_quiz = {
      question: sq.question as string,
      options: sq.options as string[],
      correct: sq.correct as number,
    };
  }

  // 阶段5 报告框架
  const rs = raw.report_sections as Record<string, unknown> | undefined;
  if (rs && typeof rs === 'object') {
    const keys = ['purpose', 'hypothesis', 'materials', 'procedure', 'dataSummary', 'analysis'] as const;
    if (keys.some((k) => isStr(rs[k]))) {
      out.report_sections = {
        purpose: isStr(rs.purpose) ? rs.purpose : '',
        hypothesis: isStr(rs.hypothesis) ? rs.hypothesis : '',
        materials: isStr(rs.materials) ? rs.materials : '',
        procedure: isStr(rs.procedure) ? rs.procedure : '',
        dataSummary: isStr(rs.dataSummary) ? rs.dataSummary : '',
        analysis: isStr(rs.analysis) ? rs.analysis : '',
      };
    }
  }

  return out;
}

/**
 * Fallback: extract a ChatResponse from natural language text when JSON parsing fails.
 */
function heuristicExtract(raw: string): ChatResponse {
  const dialogue = raw.trim();

  // Detect numbered options: lines starting with 1. 2. 3. or 1) 2) 3) or 1、2、3、
  const optionPattern = /(?:^|\n)\s*(\d+)[\.\)、]\s*(.+?)(?=\n\s*\d+[\.\)、]|\n*$)/g;
  const optionMatches: string[] = [];
  let match;
  while ((match = optionPattern.exec(dialogue)) !== null) {
    if (match[2]?.trim()) {
      optionMatches.push(match[2].trim());
    }
  }

  // Determine action type
  let next_action_type: ChatResponse['next_action_type'];
  if (optionMatches.length >= 2) {
    next_action_type = 'ask_choice';
  } else if (/确认|确定|准备好|开始|继续/.test(dialogue)) {
    next_action_type = 'confirmation';
  } else {
    next_action_type = 'text_input';
  }

  return {
    dialogue,
    next_action_type,
    options: optionMatches.length >= 2 ? optionMatches : undefined,
    phase_complete: false,
  };
}

export function safeParseChatResponse(raw: string | null | undefined): ChatResponse {
  if (!raw || !raw.trim()) {
    return {
      dialogue: '抱歉，AI服务返回了空内容，请重试。',
      next_action_type: 'text_input',
      phase_complete: false,
    };
  }

  try {
    const parsed = extractJSON(raw);
    const result = validateChatResponse(parsed);
    // Check if dialogue came from the fallback (JSON parsed but had no valid dialogue)
    if (result.dialogue === '抱歉，我暂时无法处理您的请求，请重新描述您的问题。') {
      throw new Error('JSON parsed but dialogue was empty');
    }
    return result;
  } catch {
    // JSON extraction failed — fall back to heuristic parsing from natural language
    console.warn('JSON extraction failed, using heuristic fallback');
    const heuristic = heuristicExtract(raw);
    if (!heuristic.dialogue) {
      return {
        dialogue: '抱歉，AI回复格式出现异常，请重试。',
        next_action_type: 'text_input',
        phase_complete: false,
      };
    }
    return heuristic;
  }
}
