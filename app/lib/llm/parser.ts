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

  return { dialogue, next_action_type, options, phase_complete };
}

export function safeParseChatResponse(raw: string): ChatResponse {
  try {
    const parsed = extractJSON(raw);
    return validateChatResponse(parsed);
  } catch (error) {
    console.error('Failed to parse LLM response:', error);
    console.error('Raw response:', raw);
    return {
      dialogue: '抱歉，AI回复格式出现异常，请重试。',
      next_action_type: 'text_input',
      phase_complete: false,
    };
  }
}
