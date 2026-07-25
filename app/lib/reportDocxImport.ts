import type {
  Stage5ImportField,
  Stage5Sections,
} from '@/app/models/stageData';

export const REPORT_IMPORT_FIELDS: Array<{ key: Stage5ImportField; label: string }> = [
  { key: 'purpose', label: '研究目的' },
  { key: 'hypothesis', label: '假设' },
  { key: 'materials', label: '实验材料' },
  { key: 'procedure', label: '实验步骤' },
  { key: 'dataSummary', label: '数据概述' },
  { key: 'analysis', label: '数据分析' },
  { key: 'conclusion', label: '结论' },
  { key: 'limitationsDiscussion', label: '局限与讨论' },
];

const ALIASES: Record<Stage5ImportField, string[]> = {
  purpose: ['研究目的', '实验目的', '探究目的'],
  hypothesis: ['研究假设', '实验假设', '假设'],
  materials: ['实验材料', '材料与器材', '材料和器材', '材料'],
  procedure: ['实验步骤', '实验方法', '研究方法', '实验过程', '方法与步骤'],
  dataSummary: ['数据概述', '实验结果', '数据结果', '结果概述'],
  analysis: ['数据分析', '结果分析', '实验分析', '分析'],
  conclusion: ['实验结论', '研究结论', '结论'],
  limitationsDiscussion: ['局限与讨论', '局限性与讨论', '误差与改进', '局限与改进', '讨论与改进', '实验局限'],
};

const BOUNDARY_ONLY_HEADINGS = ['实验数据记录', '原始数据', '数据表', '附件', '参考文献'];

function stripHeadingPrefix(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/^第[一二三四五六七八九十百0-9]+[章节部分]\s*[、.．:：]?\s*/, '')
    .replace(/^(?:[一二三四五六七八九十百]+|[0-9]+)\s*[、.．)）]\s*/, '')
    .trim();
}

function headingMatch(line: string): {
  key: Stage5ImportField | null;
  inlineContent: string;
} | null {
  const normalized = stripHeadingPrefix(line);
  for (const { key } of REPORT_IMPORT_FIELDS) {
    for (const alias of ALIASES[key]) {
      if (normalized === alias) return { key, inlineContent: '' };
      const inline = normalized.match(new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]\\s*(.+)$`));
      if (inline) return { key, inlineContent: inline[1].trim() };
    }
  }
  if (BOUNDARY_ONLY_HEADINGS.some((heading) => normalized === heading)) {
    return { key: null, inlineContent: '' };
  }
  return null;
}

function cleanContent(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ParsedReportSections {
  sections: Partial<Stage5Sections>;
  detectedFields: Stage5ImportField[];
  missingFields: Stage5ImportField[];
  complete: boolean;
}

/** Parse recognized report headings from extracted DOCX text without guessing missing sections. */
export function parseReportSections(text: string): ParsedReportSections {
  const buckets = new Map<Stage5ImportField, string[]>();
  let current: Stage5ImportField | null | undefined;

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (current) buckets.get(current)?.push('');
      continue;
    }
    const heading = headingMatch(line);
    if (heading) {
      current = heading.key;
      if (current) {
        const values = buckets.get(current) ?? [];
        if (heading.inlineContent) values.push(heading.inlineContent);
        buckets.set(current, values);
      }
      continue;
    }
    if (current) buckets.get(current)?.push(line);
  }

  const sections: Partial<Stage5Sections> = {};
  for (const { key } of REPORT_IMPORT_FIELDS) {
    const content = cleanContent(buckets.get(key) ?? []);
    if (content && content !== '（未填写）' && content !== '(未填写)') {
      sections[key] = content;
    }
  }
  if (sections.limitationsDiscussion) sections.reflection = sections.limitationsDiscussion;
  const detectedFields = REPORT_IMPORT_FIELDS
    .map(({ key }) => key)
    .filter((key) => Boolean(sections[key]));
  const missingFields = REPORT_IMPORT_FIELDS
    .map(({ key }) => key)
    .filter((key) => !sections[key]);
  return {
    sections,
    detectedFields,
    missingFields,
    complete: missingFields.length === 0,
  };
}
