#!/usr/bin/env tsx
import type { ChatResponse } from '../app/models/types';
import { claimsStage2ArtifactReady, validateChatContract } from '../app/lib/llm/chatContract';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function response(extra: Partial<ChatResponse> = {}): ChatResponse {
  return {
    dialogue: '我们继续完善变量设置。',
    next_action_type: 'text_input',
    phase_complete: false,
    ...extra,
  };
}

const schema: NonNullable<ChatResponse['data_table_schema']> = {
  columns: [{ key: 'day', title: '天数', type: 'number', required: true }],
  minRows: 3,
  maxRows: 200,
};

check('阶段二中间对话允许没有 schema', validateChatContract(response(), { stage: 2 }).ok);
check('confirmation 且无任何 schema 被拒绝', !validateChatContract(response({ next_action_type: 'confirmation' }), { stage: 2 }).ok);
{
  const result = validateChatContract(response({ next_action_type: 'confirmation' }), { stage: 2, canonicalize: true });
  check('运行时把中间方案确认安全降级为 text_input', result.ok && result.response.next_action_type === 'text_input');
  check('运行时记录中间方案确认修复', result.repairs.some((item) => item.code === 'P2_CONFIRMATION_WITHOUT_SCHEMA'));
}
check('明确声称已生成但无 schema 被拒绝', !validateChatContract(response({ dialogue: '我根据你的方案生成了数据记录表，右侧面板可以查看。' }), { stage: 2 }).ok);
check(
  '运行时不能修复声称表格已生成但缺少 schema 的回复',
  !validateChatContract(response({ dialogue: '我已经生成了数据记录表。', next_action_type: 'confirmation' }), { stage: 2, canonicalize: true }).ok,
);
check('未来时态不会误判为已生成', !claimsStage2ArtifactReady('接下来我们要生成数据记录表。'));
check('否定陈述不会误判为已生成', !claimsStage2ArtifactReady('目前还没有生成数据记录表。'));
check('schema + confirmation 通过', validateChatContract(response({ next_action_type: 'confirmation', data_table_schema: schema }), { stage: 2 }).ok);

{
  const result = validateChatContract(response({ data_table_schema: schema }), { stage: 2, canonicalize: true });
  check('运行时把 schema 对应动作规范为 confirmation', result.ok && result.response.next_action_type === 'confirmation');
  check('运行时记录安全修复', result.repairs.some((item) => item.code === 'P2_SCHEMA_ACTION_MISMATCH'));
}

check('Data Lab 不静默修复动作不一致', !validateChatContract(response({ data_table_schema: schema }), { stage: 2 }).ok);
check('此前已有 schema 时允许后续 confirmation 不重复 schema', validateChatContract(response({ next_action_type: 'confirmation' }), { stage: 2, hasStage2Schema: true }).ok);
check('此前已有 schema 时允许 phase_complete 不重复 schema', validateChatContract(response({ phase_complete: true }), { stage: 2, hasStage2Schema: true }).ok);
check('此前没有 schema 时 phase_complete 被拒绝', !validateChatContract(response({ phase_complete: true }), { stage: 2 }).ok);
check(
  '运行时不能修复无 schema 的阶段完成回复',
  !validateChatContract(response({ next_action_type: 'confirmation', phase_complete: true }), { stage: 2, canonicalize: true }).ok,
);
check('其他阶段不套用阶段二规则', validateChatContract(response({ next_action_type: 'confirmation' }), { stage: 1 }).ok);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
