/**
 * 探测脚本（Layer 1）：检查当前网关/模型是否支持 OpenAI 风格的
 * `response_format: { type: "json_schema", strict: true }`。
 *
 * 在你的机器上运行（需已配置 .env 的 OPENAI_API_KEY/DEEPSEEK_API_KEY）:
 *   npx tsx scripts/probe-json-schema.ts
 *
 * 若返回「支持」，可考虑在 provider.ts 第一次尝试时改用 json_schema strict，
 * 从源头减少掉格式；若「不支持」，保持现有 json_object（Layer 2/3 仍独立生效）。
 */

const openaiKey = process.env.OPENAI_API_KEY;
const deepseekKey = process.env.DEEPSEEK_API_KEY;

const provider = process.env.LLM_PROVIDER ?? (openaiKey ? 'openai' : deepseekKey ? 'deepseek' : null);
if (!provider) {
  console.error('未检测到 API Key（OPENAI_API_KEY / DEEPSEEK_API_KEY）。');
  process.exit(2);
}
const apiKey = (provider === 'openai' ? openaiKey : deepseekKey)!;
const baseURL =
  provider === 'openai'
    ? process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1'
    : process.env.DEEPSEEK_API_BASE ?? 'https://api.deepseek.com/v1';
const model = process.env.LLM_MODEL ?? (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o');

const schema = {
  name: 'chat_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['dialogue', 'next_action_type', 'phase_complete'],
    properties: {
      dialogue: { type: 'string' },
      next_action_type: { type: 'string', enum: ['ask_choice', 'text_input', 'confirmation', 'info'] },
      phase_complete: { type: 'boolean' },
    },
  },
};

async function main() {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '只输出一个 JSON 对象。' },
        { role: 'user', content: '说你好' },
      ],
      max_tokens: 200,
      response_format: { type: 'json_schema', json_schema: schema },
    }),
  });

  const body = await res.text();
  console.log(`provider=${provider} model=${model} status=${res.status}`);
  if (res.ok) {
    console.log('✅ 网关接受 json_schema strict —— 可在 provider.ts 启用作为 Layer 1。');
    console.log('返回片段：', body.slice(0, 200));
  } else {
    console.log('❌ 网关不支持 json_schema strict（或参数被拒）。保持 json_object 即可，Layer 2/3 仍生效。');
    console.log('错误片段：', body.slice(0, 300));
  }
}

main().catch((e) => {
  console.error('探测请求失败：', e?.message ?? e);
  process.exit(1);
});
