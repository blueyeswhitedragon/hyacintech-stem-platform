#!/usr/bin/env tsx
import { generateTutorCandidateWithRetries, type CandidateGenerationCase } from '../app/lib/dataLab/bootstrap/service';
import { resolveTutorCaseAllowedFocusIds } from '../app/lib/dataLab/bootstrap/contracts';
import { probeStructuredJson } from '../app/lib/dataLab/runtimeRegistry';
import type { ChatOptions, LLMMessage, LLMProvider } from '../app/lib/llm/types';

let passed = 0;
let failed = 0;

function check(condition: unknown, label: string) {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.error(`FAIL ${label}`); }
}

function expectThrow(fn: () => unknown, fragment: string) {
  try { fn(); return false; }
  catch (error) { return error instanceof Error && error.message.includes(fragment); }
}

async function main() {
  check(
    resolveTutorCaseAllowedFocusIds({ visibleFactsJson: '{}', privateReviewSpecJson: '{"allowedFocusIds":["cite_evidence"]}' })[0] === 'cite_evidence',
    '生产回流案例从 privateReviewSpecJson 恢复 server-owned focus',
  );
  check(
    resolveTutorCaseAllowedFocusIds({ visibleFactsJson: '{"allowedFocusIds":["research_question"]}', privateReviewSpecJson: '{}' })[0] === 'research_question',
    '普通案例继续使用 visibleFactsJson focus',
  );
  check(
    expectThrow(() => resolveTutorCaseAllowedFocusIds({ visibleFactsJson: '{"allowedFocusIds":["a"]}', privateReviewSpecJson: '{"allowedFocusIds":["b"]}' }), '来源不一致'),
    '双来源 focus 不一致时拒绝继续',
  );
  check(
    expectThrow(() => resolveTutorCaseAllowedFocusIds({ visibleFactsJson: '{}', privateReviewSpecJson: '{}' }), '缺少服务器确认'),
    '缺失 server-owned focus 时拒绝继续',
  );

  const caseItem: CandidateGenerationCase = {
    systemPrompt: '只输出 tutor-language-v1 JSON。', historyJson: '[]', visibleFactsJson: '{}',
    privateReviewSpecJson: '{"allowedFocusIds":["cite_evidence"]}', phase: 4,
    triggerType: 'USER_MESSAGE', studentMessage: '第1行是5.2，第2行是4.8。',
  };
  const calls: Array<{ messages: LLMMessage[]; options?: ChatOptions }> = [];
  const outputs = [
    { content: '   ', finishReason: 'stop', reasoningChars: 48 },
    { content: '{"dialogue":"请再引用一组表格数值来比较。","interactionType":"clarification","focus":"cite_evidence","hints":[]}', finishReason: 'stop', reasoningChars: 0 },
  ];
  const provider: LLMProvider = {
    async complete(messages, options) {
      calls.push({ messages, options });
      const output = outputs[calls.length - 1];
      return { ...output, usage: { totalTokens: 1 }, request: { jsonFormat: options?.useJsonFormat !== false, maxTokens: options?.maxTokens ?? 0, timeoutMs: 30_000, thinking: null, reasoningEffort: null } };
    },
    async chat() { return ''; },
  };
  const generated = await generateTutorCandidateWithRetries(caseItem, provider);
  const generatedParams = generated.params as { successfulAttempt?: number; previousAttempts?: Array<{ failureCode?: string }> };
  check(calls.length === 2 && calls[0].options?.useJsonFormat === true && calls[1].options?.useJsonFormat === false, '空 content 后关闭 JSON mode 并进行有界重试');
  check(generatedParams.successfulAttempt === 2 && generatedParams.previousAttempts?.[0]?.failureCode === 'EMPTY_CONTENT', '候选重试保留成功序号与空内容诊断');
  check(calls[1].messages.at(-1)?.content.includes('EMPTY_CONTENT'), '重试 Prompt 明确携带结构失败原因');

  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];
  let fetchCalls = 0;
  globalThis.fetch = async (_input, init) => {
    fetchCalls += 1;
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const payload = fetchCalls === 1
      ? { choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: '{"ok":true}' } }] }
      : { choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}', reasoning_content: '' } }] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const probe = await probeStructuredJson({ baseUrl: 'https://probe.invalid/v1', apiKey: 'test-only-key', model: 'test-model', timeoutMs: 1_000 });
    check(probe.ok && probe.successfulAttempt === 2 && probe.previousAttempts[0]?.failureCode === 'EMPTY_CONTENT', '连接探针不把 reasoning_content 当作最终结构化输出');
    check('response_format' in requestBodies[0] && !('response_format' in requestBodies[1]), '连接探针在空 content 后退出 response_format 模式');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\nProduction focus repair tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
