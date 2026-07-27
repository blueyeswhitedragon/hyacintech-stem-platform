#!/usr/bin/env tsx
import {
  evaluateRuntimeConsistency,
  inferModelFamily,
  normalizeServiceBaseUrl,
  promptManifestSha256,
  runtimeBundleChangeSummary,
  stableJson,
  type PromptPolicyManifest,
} from '../app/lib/dataLab/runtimeGovernance';
import { normalizeModelFamily } from '../app/lib/dataLab/bootstrap/contracts';

let passed = 0;
let failed = 0;
function check(condition: unknown, label: string) {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.error(`FAIL ${label}`); }
}

check(normalizeServiceBaseUrl('https://example.com/v1///') === 'https://example.com/v1', 'Base URL 去除尾部斜杠且保留路径');
let credentialInUrlBlocked = false;
try { normalizeServiceBaseUrl('https://user:secret@example.com/v1'); } catch { credentialInUrlBlocked = true; }
check(credentialInUrlBlocked, 'Base URL 禁止内嵌凭据');
check(inferModelFamily('custom', 'Qwen3.5-35B-A3B') === 'qwen', '从远程 model ID 识别 Qwen 家族');
// 启动器登记的运行时模型曾把 modelFamily 留空，导致案例生成页把 DeepSeek 与
// Anthropic 判成同一家族。家族必须能从 provider/model 推断出非空值。
check(inferModelFamily('deepseek', 'deepseek-v4-pro') === 'deepseek', '从 provider 识别 DeepSeek 家族');
check(normalizeModelFamily({ provider: 'openai', model: 'claude-opus-4-6' }) === 'anthropic', '网关 provider 为 openai 时仍按模型名归入 anthropic 家族');
check(normalizeModelFamily({ provider: 'deepseek', model: 'deepseek-v4-pro', family: '' })
  !== normalizeModelFamily({ provider: 'openai', model: 'claude-opus-4-6', family: '' }),
  '家族为空时两个候选不会被推断成同一家族');
check(stableJson({ b: 1, a: 2 }) === stableJson({ a: 2, b: 1 }), 'manifest 稳定序列化不受键顺序影响');

const manifest: PromptPolicyManifest = {
  version: 'tutor-policy-v2.3',
  rendererVersion: 'renderer-v2.3',
  visibleStateVersion: 'visible-v2',
  focusPlannerVersion: 'focus-v2',
  semanticValidatorVersion: 'validator-v2',
  fallbackVersion: 'fallback-v2',
  contracts: { tutor: 'tutor-language-v1', stage: 'stage-contract-v2', extractor: 'extractor-v1', extractorPrompt: 'extractor-prompt-v1' },
  sourceCommit: 'abc123',
  behaviorSpecSha256: 'behavior',
};
check(promptManifestSha256(manifest) === promptManifestSha256({ ...manifest }), '同一 Prompt manifest 可重放为相同哈希');

const compatible = evaluateRuntimeConsistency({
  roleKey: 'FORMAL_TUTOR',
  model: { id: 'm1', status: 'TRAINED', verificationStatus: 'VERIFIED_IDENTITY', trainedPromptPolicyVersionId: 'p1' },
  endpoint: { status: 'ACTIVE', connectionStatus: 'ACTIVE', modelVersionId: 'm1' },
  prompt: { id: 'p1', status: 'APPROVED', tutorContractVersion: 't1', stageContractVersion: 's1', extractorVersion: 'e1' },
  contracts: { tutor: 't1', stage: 's1', extractor: 'e1' },
});
check(compatible.ok && compatible.blockers.length === 0, '完整一致的运行组合通过确定性检查');

const mismatched = evaluateRuntimeConsistency({
  roleKey: 'FORMAL_TUTOR',
  model: { id: 'm1', status: 'TRAINED', verificationStatus: 'LEGACY_UNVERIFIED', trainedPromptPolicyVersionId: 'p0' },
  endpoint: { status: 'ACTIVE', connectionStatus: 'ACTIVE', modelVersionId: 'm2' },
  prompt: { id: 'p1', status: 'CANDIDATE', tutorContractVersion: 't1', stageContractVersion: 's1', extractorVersion: 'e1' },
  contracts: { tutor: 't2', stage: 's1', extractor: 'e1' },
});
check(!mismatched.ok && mismatched.blockers.length === 3, 'Endpoint、Prompt 状态和合同不一致均形成明确阻断');
check(mismatched.warnings.length === 2, '历史身份与训练 Prompt 变化形成独立警告');

const change = runtimeBundleChangeSummary(
  { modelVersionId: 'm1', endpointId: 'e1', promptPolicyVersionId: 'p1' },
  { modelVersionId: 'm1', endpointId: 'e2', promptPolicyVersionId: 'p1' },
);
check(change.kind === 'ENDPOINT_MIGRATION', '仅 Endpoint 变化识别为迁移');
check(runtimeBundleChangeSummary(
  { modelVersionId: 'm1', endpointId: 'e1', promptPolicyVersionId: 'p1' },
  { modelVersionId: 'm2', endpointId: 'e1', promptPolicyVersionId: 'p2' },
).kind === 'MODEL_AND_PROMPT', '模型与 Prompt 同时变化被明确识别');

console.log(`\nRuntime governance tests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
