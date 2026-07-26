/**
 * 引文定位：把「逐字引用」判定放宽到「忽略 Markdown 强调标记与空白后逐字」，并回填学生原文。
 *
 * 为什么需要：抽取器被要求逐字引用，但学生自己用 Markdown 排版时（`**一、操作步骤**`），
 * 模型极易把强调标记吞掉引成「一、操作步骤」，后面几百字一模一样却整条被驳回。
 * 线上实测有学生因此在第二阶段卡了 9 轮——他把操作步骤和控制条件写得完全清楚。
 *
 * 放宽的只是「怎么算引到了」，不是「引的是不是学生说的」：
 * 归一化后必须仍然逐字命中，且返回值是**学生原文里的那一段**，不是模型改写过的版本。
 * 账本、确认判定、后续核验拿到的始终是学生自己的字。
 */

/** 会被忽略的排版噪声：Markdown 强调/标题/引用标记与全部空白。不含 `-`（可能是「步骤 3-4」这类真实内容）。 */
const NOISE = /[*`~#>\s 　]/;

function isNoise(char: string): boolean {
  return NOISE.test(char);
}

/** 归一化文本，同时保留每个保留字符在原文中的下标，用于把命中位置映射回原文。 */
function normalizeWithOffsets(text: string): { normalized: string; offsets: number[] } {
  let normalized = '';
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (isNoise(char)) continue;
    normalized += char;
    offsets.push(i);
  }
  return { normalized, offsets };
}

function normalize(text: string): string {
  let out = '';
  for (const char of text) if (!isNoise(char)) out += char;
  return out;
}

/**
 * 在 `message` 中定位 `quote`，返回原文中对应的那一段；定位不到返回 null。
 *
 * 先试严格逐字（绝大多数情况走这条，行为与原来完全一致），再退到忽略排版噪声的匹配。
 */
export function locateSourceQuote(message: string, quote: string): string | null {
  const trimmed = quote.trim();
  if (!trimmed) return null;
  if (message.includes(trimmed)) return trimmed;

  const needle = normalize(trimmed);
  if (!needle) return null;
  const { normalized, offsets } = normalizeWithOffsets(message);
  const at = normalized.indexOf(needle);
  if (at < 0) return null;
  return message.slice(offsets[at], offsets[at + needle.length - 1] + 1);
}

/** 在多条学生消息里定位引文，返回首个命中的原文片段。 */
export function locateSourceQuoteIn(messages: string[], quote: string): string | null {
  for (const message of messages) {
    const located = locateSourceQuote(message, quote);
    if (located) return located;
  }
  return null;
}
