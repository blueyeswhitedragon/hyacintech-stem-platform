import { createHash } from 'crypto';

const MAX_ARTIFACT_TAG_LENGTH = 256;

export function normalizeEvaluationArtifactTag(value: string | undefined, source = '评测 tag'): string {
  const tag = value?.trim();
  if (!tag) throw new Error(`${source} 不能为空`);
  if (tag.length > MAX_ARTIFACT_TAG_LENGTH) throw new Error(`${source} 不能超过 ${MAX_ARTIFACT_TAG_LENGTH} 个字符`);
  if (/[\u0000-\u001f\u007f]/.test(tag)) throw new Error(`${source} 不能包含控制字符`);
  return tag;
}

export function resolveCollectArtifactTag(cliTag: string | undefined, envTag: string | undefined): string {
  return normalizeEvaluationArtifactTag(cliTag ?? envTag, '--tag / MODEL_TAG');
}

export function evaluationArtifactFilePart(tag: string): string {
  const normalized = normalizeEvaluationArtifactTag(tag);
  const readable = normalized
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'tag';
  if (readable === normalized) return readable;
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `${readable}-${hash}`;
}
