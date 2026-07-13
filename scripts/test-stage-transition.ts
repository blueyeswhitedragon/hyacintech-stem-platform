import { buildStage4TransitionResult } from '../app/lib/stageTransition';
import { injectMessageOnce } from '../app/lib/messageInjection';
import type { ChatResponse, Message } from '../app/models/types';
import type { StageData } from '../app/models/stageData';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const previous: StageData = {
  stage2: {
    submitted: true,
    approved: true,
    schema: {
      columns: [{ key: 'value', title: '数值', type: 'number', required: true }],
      minRows: 3,
      maxRows: 200,
    },
  },
  stage3: { rows: [{ value: 1 }, { value: 2 }, { value: 3 }] },
};
const response: ChatResponse = {
  dialogue: '我已读取数据表。请先比较三行数值，并引用具体数据描述一个变化。',
  next_action_type: 'text_input',
  phase_complete: false,
};
const result = buildStage4TransitionResult(previous, response, 'transition-1');
check('3→4 标记数据已提交', result.stageData.stage3?.submitted === true && result.stageData.stage3?.approved === null);
check('3→4 初始化有效分析轮次为0', result.stageData.stage4?.analysisCount === 0);
check('过渡消息是 assistant-only stage_transition', result.transitionMessage.role === 'assistant' && result.transitionMessage.messageType === 'stage_transition');
check('过渡消息使用服务端稳定 ID', result.transitionMessage.id === 'transition-1');

const initial: Message[] = [{ id: 'welcome', role: 'assistant', content: '欢迎' }];
const once = injectMessageOnce(initial, result.transitionMessage);
const twice = injectMessageOnce(once, result.transitionMessage);
check('主动消息首次注入到聊天末尾', once.length === 2 && once[1].id === 'transition-1');
check('按 ID 重复注入会去重', twice === once && twice.length === 2);
check('注入过程中没有伪造用户消息', twice.every((message) => message.role === 'assistant'));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
