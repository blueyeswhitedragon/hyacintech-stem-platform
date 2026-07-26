#!/usr/bin/env tsx
import { validateConfig } from '../app/lib/llm/provider';

const KEYS = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
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

function configure(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

try {
  console.log('LLM configuration:');

  configure({ DEEPSEEK_API_KEY: 'deepseek-real-test-key' });
  let result = validateConfig();
  check('单一 DeepSeek 密钥可自动选择 provider', result.valid && result.provider === 'deepseek');
  check('DeepSeek 默认模型保持兼容', result.model === 'deepseek-v4-pro');

  configure({ OPENAI_API_KEY: 'openai-real-test-key' });
  result = validateConfig();
  check('单一 OpenAI 密钥可自动选择 provider', result.valid && result.provider === 'openai');
  check('OpenAI 默认模型保持兼容', result.model === 'gpt-4o');

  configure({
    OPENAI_API_KEY: 'openai-real-test-key',
    DEEPSEEK_API_KEY: 'deepseek-real-test-key',
  });
  result = validateConfig();
  check('两家真实密钥但未指定 provider 时拒绝歧义配置', !result.valid && result.issues.some((issue) => issue.includes('同时')));

  configure({
    LLM_PROVIDER: 'deepseek',
    LLM_MODEL: 'explicit-model',
    OPENAI_API_KEY: 'openai-real-test-key',
    DEEPSEEK_API_KEY: 'deepseek-real-test-key',
  });
  result = validateConfig();
  check('显式 provider 可消除双密钥歧义', result.valid && result.provider === 'deepseek');
  check('显式模型优先于默认模型', result.model === 'explicit-model');

  configure({
    LLM_PROVIDER: 'unsupported-provider',
    OPENAI_API_KEY: 'openai-real-test-key',
  });
  result = validateConfig();
  check('未知 LLM_PROVIDER 被拒绝', !result.valid && result.issues.some((issue) => issue.includes('openai') && issue.includes('deepseek')));

  configure({
    LLM_PROVIDER: 'openai',
    DEEPSEEK_API_KEY: 'deepseek-real-test-key',
  });
  result = validateConfig();
  check('显式 provider 缺少匹配密钥时被拒绝', !result.valid && result.issues.some((issue) => issue.includes('OPENAI_API_KEY')));
} finally {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
