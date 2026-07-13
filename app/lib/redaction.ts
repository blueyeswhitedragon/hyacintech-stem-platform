import { sha256 } from '@/app/lib/dataLab/validation';
import type { ShareGPTRecord } from '@/app/lib/dataLab/types';

export interface RedactionReport {
  policyVersion: string;
  replacements: Record<string, number>;
  attachmentsRemoved: number;
  clean: boolean;
}

const RULES: Array<[string, RegExp, string]> = [
  ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已脱敏]'],
  ['phone', /(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号已脱敏]'],
  ['id_card', /(?<!\d)\d{17}[\dXx](?!\d)/g, '[证件号已脱敏]'],
  ['address', /[\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|乡|街道|路|街)\s*[\u4e00-\u9fa5\d-]{1,20}(?:号|栋|室)?/g, '[地址已脱敏]'],
  ['url', /https?:\/\/[^\s"'<>]+/gi, '[链接已移除]'],
  ['upload_path', /\/?(?:public\/)?uploads\/[\w./%-]+/gi, '[附件已移除]'],
];

export function redactProductionRecord(
  record: ShareGPTRecord,
  knownIdentifiers: string[],
  policyVersion: string
): { record: ShareGPTRecord; report: RedactionReport } {
  const replacements: Record<string, number> = {};
  let attachmentsRemoved = 0;
  const identifiers = [...new Set(knownIdentifiers.map((item) => item.trim()).filter((item) => item.length >= 2))]
    .sort((a, b) => b.length - a.length);

  function redact(value: string): string {
    let output = value;
    for (const identifier of identifiers) {
      const count = output.split(identifier).length - 1;
      if (count > 0) {
        replacements.known_identifier = (replacements.known_identifier ?? 0) + count;
        output = output.split(identifier).join('[身份信息已脱敏]');
      }
    }
    for (const [name, pattern, replacement] of RULES) {
      pattern.lastIndex = 0;
      const matches = output.match(pattern)?.length ?? 0;
      if (matches > 0) {
        replacements[name] = (replacements[name] ?? 0) + matches;
        if (name === 'url' || name === 'upload_path') attachmentsRemoved += matches;
        output = output.replace(pattern, replacement);
      }
    }
    return output;
  }

  function walk(value: unknown): unknown {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    }
    return value;
  }

  const redacted = walk(record) as ShareGPTRecord;
  const report = {
    policyVersion,
    replacements,
    attachmentsRemoved,
    clean: true,
  };
  return { record: redacted, report };
}

export function productionContentFingerprint(record: ShareGPTRecord): string {
  return sha256(JSON.stringify(record.conversations));
}

export function productionFamilyKey(record: ShareGPTRecord): string {
  const human = record.conversations
    .filter((message) => message.from === 'human')
    .map((message) => message.value.toLowerCase().replace(/\s+/g, ' ').trim())
    .join('\n');
  return `production-${sha256(human).slice(0, 20)}`;
}
