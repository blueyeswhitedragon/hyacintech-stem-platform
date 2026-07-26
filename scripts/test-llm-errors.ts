#!/usr/bin/env tsx
import { classifyError } from '../app/lib/llm/errors';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function classify(status: number, body: string) {
  return classifyError(new Error(`LLM API error ${status}: ${body}`));
}

console.log('LLM error classification:');

for (const marker of ['model_not_found', 'model-not-found', 'invalid_model']) {
  const result = classify(503, JSON.stringify({ error: { code: marker } }));
  check(`503 + ${marker} 归类为 invalid_model`, result.error === 'invalid_model');
  check(`503 + ${marker} 保留上游状态码`, result.status === 503);
  check(`503 + ${marker} 使用模型不可用文案`, result.detail.includes('模型不可用或未配置'));
}

const spacedModelError = classify(404, 'model not found');
check('404 + model not found 仍归类为 invalid_model', spacedModelError.error === 'invalid_model');
check('404 + model not found 保留 404', spacedModelError.status === 404);

const overloaded = classify(503, 'upstream overloaded at capacity');
check('真正的 503 overload 仍归类为 server_overloaded', overloaded.error === 'server_overloaded');

const generic = classify(500, 'unexpected upstream failure');
check('普通 500 仍归类为 server_error', generic.error === 'server_error');

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
