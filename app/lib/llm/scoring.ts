import { createLLMProvider } from './provider';
import { buildScoringPrompt, buildReportText } from '@/app/prompts/scoring';
import type { Stage5Sections, Stage5ReferenceScore } from '@/app/models/stageData';
import type { LLMMessage } from './types';

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function extractJSON(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw.trim());
  } catch {
    const i = raw.indexOf('{');
    const j = raw.lastIndexOf('}');
    if (i !== -1 && j > i) {
      try {
        return JSON.parse(raw.slice(i, j + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * 调 LLM 为报告生成参考评分。失败（配置/网络/解析）一律返回 null，
 * 不抛错 —— 提交报告流程不应被评分失败阻断。
 */
export async function generateReferenceScore(
  sections: Stage5Sections
): Promise<Stage5ReferenceScore | null> {
  try {
    const provider = createLLMProvider();
    const messages: LLMMessage[] = [
      { role: 'system', content: buildScoringPrompt() },
      { role: 'user', content: buildReportText(sections) },
    ];
    const raw = await provider.chat(messages, { useJsonFormat: true });
    const obj = extractJSON(raw);
    if (!obj) return null;

    const dimsRaw = (obj.dimensions ?? {}) as Record<string, unknown>;
    const dimensions = {
      completeness: clamp(dimsRaw.completeness, 1, 10, 5),
      logic: clamp(dimsRaw.logic, 1, 10, 5),
      dataUsage: clamp(dimsRaw.dataUsage, 1, 10, 5),
      innovation: clamp(dimsRaw.innovation, 1, 10, 5),
      expression: clamp(dimsRaw.expression, 1, 10, 5),
    };

    const highlights = Array.isArray(obj.highlights)
      ? obj.highlights.filter((h): h is string => typeof h === 'string')
      : [];
    const suggestions = Array.isArray(obj.suggestions)
      ? obj.suggestions
          .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as Record<string, unknown>).text === 'string')
          .map((s) => ({
            text: s.text as string,
            targetSection: typeof s.targetSection === 'string' ? (s.targetSection as string) : '',
          }))
      : [];

    return {
      overall: clamp(obj.overall, 1, 10, 5),
      dimensions,
      highlights,
      suggestions,
      safetyCompliance: obj.safetyCompliance !== false,
    };
  } catch (err) {
    console.warn('生成参考评分失败:', err);
    return null;
  }
}
