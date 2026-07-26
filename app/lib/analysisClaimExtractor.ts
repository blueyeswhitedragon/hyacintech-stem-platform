import { createHash } from 'crypto';
import { createLLMProvider } from '@/app/lib/llm/provider';
import type { LLMRuntimeOverride } from '@/app/lib/llm/types';
import type { Stage2Data, StageData } from '@/app/models/stageData';
import { repairJson } from '@/app/lib/llm/jsonRepair';
import { locateSourceQuote } from '@/app/lib/sourceQuote';
import {
  ANALYSIS_CLAIM_EXTRACTOR_PROMPT_VERSION,
  ANALYSIS_CLAIM_EXTRACTOR_VERSION,
} from '@/app/lib/contractVersions';
import {
  columnAliases,
  containsCellValue,
  evidenceCellFingerprint,
  isIndexColumn,
  normalizedCellValue,
  type AnalysisCellEvidence,
} from '@/app/lib/serverTutorState';

export const CLAIM_EXTRACTOR_VERSION = ANALYSIS_CLAIM_EXTRACTOR_VERSION;
export const CLAIM_EXTRACTOR_PROMPT_VERSION = ANALYSIS_CLAIM_EXTRACTOR_PROMPT_VERSION;

/** 模型声称的一条单元格引用。行号是学生视角的 1 起始行号。 */
export interface AnalysisClaimCitation {
  rowNumber: number;
  columnTitle: string;
  value: string;
  sourceQuote: string;
}

export interface RejectedAnalysisClaimCitation extends AnalysisClaimCitation {
  reason: string;
}

export interface RawAnalysisClaim {
  citations: AnalysisClaimCitation[];
  comparison: { isComparison: boolean; sourceQuote: string };
}

/** 服务器核验后的主张：citations 已解析到真实单元格，comparison 已确认引文存在。 */
export interface ValidatedAnalysisClaim {
  citations: AnalysisCellEvidence[];
  rejected: RejectedAnalysisClaimCitation[];
  comparison: boolean;
  comparisonSourceQuote: string;
  comparisonRejection: string | null;
}

export interface AnalysisClaimCallResult {
  claim: ValidatedAnalysisClaim;
  rawOutput: string;
  prompt: string;
  promptSha256: string;
  provider: string;
  model: string;
  modelFamily: string;
  generationParams: Record<string, unknown>;
  attempts: Array<{ attempt: number; failure: string; finishReason: string | null }>;
  truncated: boolean;
}

function modelFamily(provider: string, model: string): string {
  const normalized = model.toLowerCase();
  if (normalized.includes('deepseek')) return 'deepseek';
  if (normalized.includes('qwen')) return 'qwen';
  if (normalized.includes('claude')) return 'anthropic';
  if (/gpt|o\d|openai/.test(normalized) || provider === 'openai') return 'openai';
  return `${provider}:${normalized.split(/[-_:]/)[0] || 'unknown'}`;
}

function parseClaim(raw: string): RawAnalysisClaim | null {
  const candidates = [raw.trim()];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);
  for (const candidate of candidates) {
    for (const repaired of [candidate, repairJson(candidate)]) {
      try {
        const parsed = JSON.parse(repaired) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const shape = parsed as { citations?: unknown; comparison?: unknown };
        const citations = Array.isArray(shape.citations)
          ? shape.citations.flatMap((item) => {
            if (!item || typeof item !== 'object') return [];
            const citation = item as Record<string, unknown>;
            const rowNumber = Number(citation.rowNumber);
            if (!Number.isFinite(rowNumber)) return [];
            return [{
              rowNumber,
              columnTitle: String(citation.columnTitle ?? ''),
              value: String(citation.value ?? ''),
              sourceQuote: String(citation.sourceQuote ?? ''),
            }];
          })
          : [];
        const comparisonShape = (shape.comparison ?? {}) as Record<string, unknown>;
        return {
          citations,
          comparison: {
            isComparison: comparisonShape.isComparison === true,
            sourceQuote: String(comparisonShape.sourceQuote ?? ''),
          },
        };
      } catch {
        // Try next representation.
      }
    }
  }
  return null;
}

function sameValue(cellValue: string, claimedValue: string): boolean {
  if (!cellValue || !claimedValue) return false;
  if (cellValue === claimedValue) return true;
  const cellNumber = Number(cellValue);
  const claimedNumber = Number(claimedValue);
  // 「10」与「10.0」是同一个格；带单位的「10克」不是——单位由学生自己写，不代表表里的值。
  return Number.isFinite(cellNumber) && Number.isFinite(claimedNumber) && cellNumber === claimedNumber;
}

function resolveColumn(
  schema: Stage2Data['schema'] | undefined,
  columnTitle: string,
): { key: string; title: string } | null {
  const wanted = normalizedCellValue(columnTitle);
  if (!wanted) return null;
  const columns = schema?.columns ?? [];
  const exact = columns.find((column) => (
    normalizedCellValue(column.title) === wanted || normalizedCellValue(column.key) === wanted
  ));
  if (exact) return { key: exact.key, title: exact.title };
  const aliased = columns.find((column) => (
    columnAliases(column.key, column.title).some((alias) => normalizedCellValue(alias) === wanted)
  ));
  return aliased ? { key: aliased.key, title: aliased.title } : null;
}

/**
 * 服务器核验模型给出的分析主张。**模型只负责语言理解，事实核验不下放**：
 * 一条引用必须同时通过「引文在学生原话里逐字存在」「行列在冻结的表里存在」
 * 「该单元格的值确实等于所声称的值」「所声称的值出现在引文里」四关，任一不满足整条丢弃。
 *
 * 与 validateExtractedFacts 同构，纯函数，可单测。
 */
export function validateAnalysisClaim(
  stageData: StageData,
  studentMessage: string,
  claim: RawAnalysisClaim,
): ValidatedAnalysisClaim {
  const rows = stageData.stage3?.rows ?? [];
  const schema = stageData.stage2?.schema;
  const citations: AnalysisCellEvidence[] = [];
  const rejected: RejectedAnalysisClaimCitation[] = [];
  const seen = new Set<string>();

  for (const item of claim.citations) {
    // 与 validateExtractedFacts 同口径：定位成功即回填学生原文，容忍模型吞掉 Markdown 标记。
    const sourceQuote = locateSourceQuote(studentMessage, item.sourceQuote) ?? item.sourceQuote.trim();
    const column = resolveColumn(schema, item.columnTitle);
    const rowIndex = item.rowNumber - 1;
    const cellValue = column && rowIndex >= 0 && rowIndex < rows.length
      ? normalizedCellValue(rows[rowIndex][column.key])
      : '';
    const claimedValue = normalizedCellValue(item.value);

    let reason = '';
    if (!sourceQuote || !studentMessage.includes(sourceQuote)) reason = 'SOURCE_QUOTE_NOT_FOUND_IN_STUDENT_MESSAGES';
    else if (!column) reason = 'COLUMN_NOT_IN_LOCKED_SCHEMA';
    else if (isIndexColumn(column.key, column.title)) reason = 'INDEX_COLUMN_IS_NOT_EVIDENCE';
    else if (!Number.isInteger(item.rowNumber) || rowIndex < 0 || rowIndex >= rows.length) reason = 'ROW_NOT_IN_SUBMITTED_DATA';
    else if (!sameValue(cellValue, claimedValue)) reason = 'VALUE_DOES_NOT_MATCH_SUBMITTED_CELL';
    else if (!containsCellValue(sourceQuote, cellValue)) reason = 'VALUE_NOT_IN_SOURCE_QUOTE';

    if (reason || !column) {
      rejected.push({ ...item, sourceQuote, reason: reason || 'COLUMN_NOT_IN_LOCKED_SCHEMA' });
      continue;
    }
    const fingerprint = evidenceCellFingerprint(rowIndex, column.key, cellValue);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    citations.push({
      rowIndex,
      columnKey: column.key,
      columnName: column.title,
      citedValue: cellValue,
      fingerprint,
    });
  }

  const comparisonSourceQuote = locateSourceQuote(studentMessage, claim.comparison.sourceQuote)
    ?? claim.comparison.sourceQuote.trim();
  const comparisonRejection = !claim.comparison.isComparison
    ? 'MODEL_SAYS_NOT_A_COMPARISON'
    : !comparisonSourceQuote || !studentMessage.includes(comparisonSourceQuote)
      ? 'SOURCE_QUOTE_NOT_FOUND_IN_STUDENT_MESSAGES'
      : null;

  return {
    citations,
    rejected,
    comparison: comparisonRejection === null,
    comparisonSourceQuote,
    comparisonRejection,
  };
}

export function buildAnalysisClaimPrompt(stageData: StageData): string {
  const columns = (stageData.stage2?.schema.columns ?? []).map((column) => ({
    列名: column.title,
    类型: column.type,
    是否序号列: isIndexColumn(column.key, column.title),
  }));
  const rows = (stageData.stage3?.rows ?? []).map((row, index) => Object.fromEntries([
    ['行号', index + 1],
    ...(stageData.stage2?.schema.columns ?? []).map((column) => [column.title, row[column.key]] as const),
  ]));
  return `你是版本化的第四阶段分析主张提取器 ${CLAIM_EXTRACTOR_VERSION}。你不是导师，不生成教学语言，不评价学生。
你的唯一任务：读学生这一句话，指出他引用了数据表里的哪些单元格，以及这句话有没有在做比较。

数据表列（序号列不算证据，不要引用）：${JSON.stringify(columns)}
已提交的数据行：${JSON.stringify(rows)}

规则：
1. 只有学生自己在这句话里写出来的数值才算引用。他没写出的数值、他自己算出的平均值、表里不存在的数值，一律不要输出。
2. 每条引用必须给出能在学生原话中逐字定位的 sourceQuote，且该数值必须出现在这段 sourceQuote 里。
3. rowNumber 用表里的「行号」，columnTitle 用上面给出的列名原文。
4. 只报行号（例如「第一行比第三行高」）而没有写出数值的，不算引用，输出空数组。
5. comparison.isComparison 表示这句话是否把两个及以上的数据放在一起做了比较（含「大于/更高/一样/超过/不如」等任意中文表达），并给出对应的 sourceQuote。不确定就填 false。
6. 不要推测、不要补全、不要改写学生的原文。

只输出 JSON：{"citations":[{"rowNumber":1,"columnTitle":"列名","value":"表中的值","sourceQuote":"学生原文片段"}],"comparison":{"isComparison":false,"sourceQuote":""}}`;
}

export async function callAnalysisClaimExtractor(input: {
  stageData: StageData;
  studentMessage: string;
  runtimeModel?: LLMRuntimeOverride;
}): Promise<AnalysisClaimCallResult> {
  const providerName = input.runtimeModel?.provider ?? process.env.EXTRACTOR_LLM_PROVIDER ?? process.env.LLM_PROVIDER ?? 'deepseek';
  const model = input.runtimeModel?.model ?? process.env.EXTRACTOR_LLM_MODEL ?? process.env.LLM_MODEL ?? (providerName === 'openai' ? 'gpt-4o-mini' : 'deepseek-v4-pro');
  const prompt = buildAnalysisClaimPrompt(input.stageData);
  const provider = createLLMProvider({ provider: providerName, model, role: 'EVALUATOR' });
  const attempts: AnalysisClaimCallResult['attempts'] = [];
  const baseMessages = [
    { role: 'system' as const, content: prompt },
    { role: 'user' as const, content: JSON.stringify({ currentStudentMessage: input.studentMessage }) },
  ];
  let completion: Awaited<ReturnType<typeof provider.complete>> | null = null;
  let parsed: RawAnalysisClaim | null = null;
  let successfulAttempt: number | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    completion = await provider.complete(
      attempt === 1
        ? baseMessages
        : [...baseMessages, { role: 'system' as const, content: '上一次输出未完成或不是合法 JSON。只输出 JSON，不要解释。' }],
      { useJsonFormat: true },
    );
    parsed = parseClaim(completion.content);
    if (parsed && completion.finishReason !== 'length') {
      successfulAttempt = attempt;
      break;
    }
    attempts.push({
      attempt,
      failure: completion.finishReason === 'length' ? 'OUTPUT_TRUNCATED' : 'INVALID_EXTRACTOR_JSON',
      finishReason: completion.finishReason,
    });
  }
  const truncated = completion?.finishReason === 'length';
  const claim = validateAnalysisClaim(
    input.stageData,
    input.studentMessage,
    parsed ?? { citations: [], comparison: { isComparison: false, sourceQuote: '' } },
  );
  return {
    claim,
    rawOutput: completion?.content ?? '',
    prompt,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
    provider: providerName,
    model,
    modelFamily: modelFamily(providerName, model),
    generationParams: {
      ...(completion?.request ?? {}),
      finishReason: completion?.finishReason ?? null,
      usage: completion?.usage,
      successfulAttempt,
    },
    attempts,
    truncated,
  };
}
