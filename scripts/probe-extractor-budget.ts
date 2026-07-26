/** 诊断脚本（非测试）：用不同 maxTokens 重跑被截断的学生消息，确认预算是否为真因。 */
import { createLLMProvider } from '../app/lib/llm/provider';
import { buildExtractorPrompt, validateExtractedFacts } from '../app/lib/stateExtractor';

const MESSAGES = [
  '维持都是五个桥支撑，一个是原型一个是方形，然后在上面不断加砝码直到倒塌',
  '实验只需要准备好控制变量的桥即可\n数据记录表每次加5G的砝码直到倒塌',
];

async function run(message: string, maxTokens: number) {
  const provider = createLLMProvider({ role: 'EVALUATOR' });
  const c = await provider.complete([
    { role: 'system', content: buildExtractorPrompt(2) },
    { role: 'user', content: JSON.stringify({ currentStudentMessage: message, expectedFocusId: 'variable_design', existingFacts: {} }) },
  ], { useJsonFormat: true, maxTokens });
  console.log(`\n[maxTokens=${maxTokens}] finish=${c.finishReason} reasoningTokens=${c.usage.reasoningTokens} completion=${c.usage.completionTokens}`);
  console.log('raw:', c.content.slice(0, 400) || '(空)');
  return c.content;
}

(async () => {
  for (const m of MESSAGES) {
    console.log('==================================================');
    console.log('学生消息:', JSON.stringify(m));
    await run(m, 1400);
    const raw = await run(m, 8000);
    try {
      const facts = JSON.parse(raw).facts ?? [];
      console.log('校验后:', JSON.stringify(validateExtractedFacts(2, facts, [m]), null, 2));
    } catch { console.log('(无法解析)'); }
  }
})();
