/**
 * 确定性单测：掉格式三层防线（jsonRepair + 文本抢救）+ variables 回归。
 * 运行: npx tsx scripts/test-parser.ts
 */
import { repairJson } from '../app/lib/llm/jsonRepair';
import { safeParseChatResponse } from '../app/lib/llm/parser';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const APOLOGY = [
  '抱歉，AI服务返回了空内容，请重试。',
  '抱歉，AI回复格式出现异常，请重试。',
  '抱歉，我暂时无法处理您的请求，请重新描述您的问题。',
];
const notApology = (s: string) => !APOLOGY.includes(s);

console.log('repairJson:');
// 尾逗号
check('去尾逗号(对象)', JSON.parse(repairJson('{"a":1,}')).a === 1);
check('去尾逗号(数组)', Array.isArray(JSON.parse(repairJson('{"a":[1,2,]}')).a));
// 字符串内裸换行
{
  const fixed = repairJson('{"dialogue":"第一行\n第二行"}');
  check('裸换行被转义可解析', JSON.parse(fixed).dialogue === '第一行\n第二行');
}
// 字符串内未转义内部引号
{
  const fixed = repairJson('{"dialogue":"他说"你好"了"}');
  const obj = JSON.parse(fixed);
  check('未转义内部引号被修复', typeof obj.dialogue === 'string' && obj.dialogue.includes('你好'));
}
// 弯引号归一
{
  const fixed = repairJson('{“dialogue”:"hi"}');
  check('弯引号归一', JSON.parse(fixed).dialogue === 'hi');
}

console.log('safeParseChatResponse 端到端:');
// 合法 JSON
{
  const p = safeParseChatResponse('{"dialogue":"你好","next_action_type":"text_input","phase_complete":false}');
  check('合法 JSON 透传', p.dialogue === '你好' && p.next_action_type === 'text_input');
}
// 尾逗号 → 修复
{
  const p = safeParseChatResponse('{"dialogue":"测试","next_action_type":"text_input","phase_complete":false,}');
  check('尾逗号被修复', p.dialogue === '测试' && notApology(p.dialogue));
}
// 裸换行 → 修复
{
  const p = safeParseChatResponse('{"dialogue":"第一行\n第二行","next_action_type":"text_input","phase_complete":false}');
  check('裸换行被修复', p.dialogue.includes('第一行') && p.dialogue.includes('第二行') && notApology(p.dialogue));
}
// 文字包裹 + 代码围栏
{
  const p = safeParseChatResponse('好的，这是结果：\n```json\n{"dialogue":"围栏内容","next_action_type":"info","phase_complete":false}\n```\n谢谢');
  check('代码围栏内提取', p.dialogue === '围栏内容');
}
// 前后有噪声文字
{
  const p = safeParseChatResponse('Sure! {"dialogue":"噪声里的","next_action_type":"text_input","phase_complete":false} done');
  check('噪声中花括号提取', p.dialogue === '噪声里的');
}
// 彻底坏掉但含 dialogue 字段 → 抢救该字段，不返回道歉
{
  const p = safeParseChatResponse('{"dialogue":"被抢救的对话", oops this is broken nonsense ::: ');
  check('坏 JSON 抢救 dialogue 字段', p.dialogue === '被抢救的对话' && notApology(p.dialogue));
  check('抢救后 action 默认 text_input', p.next_action_type === 'text_input');
}
// 纯自然语言（无 JSON）→ 用原文作 dialogue，不道歉
{
  const p = safeParseChatResponse('我们来想想你的实验需要控制哪些变量。');
  check('纯文本作 dialogue', p.dialogue.includes('控制哪些变量') && notApology(p.dialogue));
}
// 空内容 → 道歉兜底（可接受）
{
  const p = safeParseChatResponse('   ');
  check('空内容返回兜底', !notApology(p.dialogue));
}

console.log('variables 回归（dependent 可空）:');
// 仅 independent 也应透传 variables（Batch A 后 dependent 可空）
{
  const raw = JSON.stringify({
    dialogue: '确认', next_action_type: 'confirmation', phase_complete: true,
    stage1_confirmed: true,
    snapshot: 'snap',
    theme_mapping: {
      originalInterest: '火星基地种菜',
      retainedFeature: '人工控制光照',
      classroomProxy: '不同人工光照时长',
      researchQuestion: '不同人工光照时长是否影响绿豆发芽',
    },
    variables: { independent: '光照时长' },
  });
  const p = safeParseChatResponse(raw);
  check('theme_mapping 透传', p.theme_mapping?.classroomProxy === '不同人工光照时长');
  check('仅 independent 透传 variables', p.variables?.independent === '光照时长');
  check('缺 dependent 不丢 variables', p.variables !== undefined && p.variables.dependent === undefined);
}
// 含 dependent 仍正常
{
  const raw = JSON.stringify({
    dialogue: 'x', next_action_type: 'confirmation', phase_complete: true,
    variables: { independent: '温度', dependent: '溶解速度', controlled: ['体积'] },
  });
  const p = safeParseChatResponse(raw);
  check('含 dependent 正常透传', p.variables?.dependent === '溶解速度' && p.variables?.controlled?.[0] === '体积');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
