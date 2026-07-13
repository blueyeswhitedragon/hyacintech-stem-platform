#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import type { ChatResponse } from '../app/models/types';
import { applyRevision, assertRevisionIntent, canonicalizeRecord, familyKey, normalizeLegacyEmptyStage2Schemas, parseShareGPTDataset, validateShareGPTRecord } from '../app/lib/dataLab/validation';
import { chooseAnnotationCandidate, claimUnavailableReason, hasMeaningfulDraft } from '../app/lib/dataLab/assignment';
import type { ShareGPTRecord } from '../app/lib/dataLab/types';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

async function main() {
  const file = path.join(process.cwd(), 'data/sft/sharegpt-distill-dsv4-all-clean.json');
  const records = parseShareGPTDataset(await readFile(file, 'utf8'));
  check('loads 489 merged records', records.length === 489);
  const ids = new Set(records.map((record) => record.id));
  check('record ids unique', ids.size === records.length);
  const first = canonicalizeRecord(records[0]);
  check('family key removes version hash', !/-[0-9a-f]{8,}$/.test(familyKey(first)));
  const result = validateShareGPTRecord(first);
  check('first record has no hard errors', !result.issues.some((issue) => issue.severity === 'error'));
  const assistantIndexes = first.conversations.map((message, index) => message.from === 'gpt' ? index : -1).filter((index) => index >= 0);
  const input = {
    assistantMessages: assistantIndexes.map((messageIndex) => ({
      messageIndex,
      response: JSON.parse(first.conversations[messageIndex].value) as ChatResponse,
    })),
    issueTags: [],
    changeReason: 'roundtrip',
    noChange: true,
  };
  const revised = applyRevision(first, input);
  check('human messages unchanged after revision', revised.conversations.filter((message) => message.from === 'human').every((message, index) => message.value === first.conversations.filter((source) => source.from === 'human')[index].value));
  check('revision roundtrip remains valid', validateShareGPTRecord(revised).status !== 'error');

  const incomplete = structuredClone(first);
  const finalAssistant = [...incomplete.conversations].reverse().find((message) => message.from === 'gpt');
  if (finalAssistant) {
    const response = JSON.parse(finalAssistant.value) as ChatResponse;
    response.phase_complete = true;
    delete response.theme_mapping;
    finalAssistant.value = JSON.stringify(response);
    check('phase1 missing mapping rejected', validateShareGPTRecord(incomplete).issues.some((issue) => issue.ruleCode === 'PHASE1_CONFIRMATION_INCOMPLETE'));
  }

  const tableSchema: NonNullable<ChatResponse['data_table_schema']> = {
    columns: [
      { key: 'day', title: '天数', type: 'number', required: true },
      { key: 'notes', title: '备注', type: 'text', required: false },
    ],
    minRows: 3,
    maxRows: 200,
  };
  const p2 = (responses: ChatResponse[]): ShareGPTRecord => ({
    id: 'p2-contract-test', scenario: '阶段二契约测试', phase: 2,
    conversations: responses.flatMap((response, index) => [
      { from: 'human' as const, value: `学生消息 ${index + 1}` },
      { from: 'gpt' as const, value: JSON.stringify(response) },
    ]),
  });
  const baseP2 = (extra: Partial<ChatResponse> = {}): ChatResponse => ({ dialogue: '继续讨论。', next_action_type: 'text_input', phase_complete: false, ...extra });

  check('P2 过早 phase_complete 被拒绝', validateShareGPTRecord(p2([baseP2({ phase_complete: true })]), 'submit').issues.some((item) => item.ruleCode === 'P2_PHASE_COMPLETE_WITHOUT_SCHEMA'));
  check('P2 声称生成但缺 schema 被拒绝', validateShareGPTRecord(p2([baseP2({ dialogue: '我已经生成了数据记录表。' })]), 'submit').issues.some((item) => item.ruleCode === 'P2_ARTIFACT_CLAIM_WITHOUT_SCHEMA'));
  const wrongAction = p2([baseP2({ data_table_schema: tableSchema })]);
  check('P2 schema/action 不一致在导入时为 warning', validateShareGPTRecord(wrongAction, 'import').issues.some((item) => item.ruleCode === 'P2_SCHEMA_ACTION_MISMATCH' && item.severity === 'warning'));
  check('P2 schema/action 不一致在提交时为 error', validateShareGPTRecord(wrongAction, 'submit').issues.some((item) => item.ruleCode === 'P2_SCHEMA_ACTION_MISMATCH' && item.severity === 'error'));
  const priorSchema = p2([
    baseP2({ dialogue: '数据表生成好了。', next_action_type: 'confirmation', data_table_schema: tableSchema }),
    baseP2({ dialogue: '方案确认完成。', phase_complete: true }),
  ]);
  check('P2 已有 schema 后可在后续轮次完成', !validateShareGPTRecord(priorSchema, 'submit').issues.some((item) => item.ruleCode === 'P2_PHASE_COMPLETE_WITHOUT_SCHEMA'));
  const invalidAction = structuredClone(priorSchema);
  const firstGpt = invalidAction.conversations.find((message) => message.from === 'gpt');
  if (firstGpt) firstGpt.value = firstGpt.value.replace('"confirmation"', '"require_confirm"');
  check('非法原始 action 在导入时可见为 warning', validateShareGPTRecord(invalidAction, 'import').issues.some((item) => item.ruleCode === 'ACTION_TYPE_INVALID' && item.severity === 'warning'));
  check('非法原始 action 在提交时被拒绝', validateShareGPTRecord(invalidAction, 'submit').issues.some((item) => item.ruleCode === 'ACTION_TYPE_INVALID' && item.severity === 'error'));

  let noChangeRejected = false;
  try {
    assertRevisionIntent(priorSchema, {
      assistantMessages: [{ messageIndex: 1, response: baseP2({ dialogue: '被修改', next_action_type: 'confirmation', data_table_schema: tableSchema }) }, { messageIndex: 3, response: baseP2({ dialogue: '方案确认完成。', phase_complete: true }) }],
      issueTags: [], changeReason: '', noChange: true,
    });
  } catch { noChangeRejected = true; }
  check('修改回复后不能勾选无需修改', noChangeRejected);

  const emptySchema = { columns: [], minRows: 1, maxRows: 200 };
  const normalizedDraft = normalizeLegacyEmptyStage2Schemas({
    assistantMessages: [{ messageIndex: 1, response: baseP2({ data_table_schema: emptySchema }) }],
    issueTags: [], changeReason: '', noChange: false,
  });
  check('旧版中间轮次空表会被安全移除', normalizedDraft.removedMessageIndexes[0] === 1 && !normalizedDraft.input.assistantMessages[0].response.data_table_schema);
  const invalidFinalDraft = normalizeLegacyEmptyStage2Schemas({
    assistantMessages: [{ messageIndex: 1, response: baseP2({ dialogue: '数据表已经生成。', next_action_type: 'confirmation', data_table_schema: emptySchema }) }],
    issueTags: [], changeReason: '', noChange: false,
  });
  check('声称生成表格的空 schema 不会被静默隐藏', invalidFinalDraft.removedMessageIndexes.length === 0 && !!invalidFinalDraft.input.assistantMessages[0].response.data_table_schema);
  check('空对象草稿允许安全转派', !hasMeaningfulDraft('{}'));
  check('含回复的草稿禁止自动转派', hasMeaningfulDraft(JSON.stringify({ assistantMessages: [{ messageIndex: 1 }] })));
  const candidates = [
    { id: 'same', campaignId: 'c1', sampleId: 's1', familyKey: 'f1', draftJson: '{}' },
    { id: 'fresh-family', campaignId: 'c1', sampleId: 's2', familyKey: 'recent', draftJson: '{}' },
    { id: 'fresh', campaignId: 'c1', sampleId: 's3', familyKey: 'new', draftJson: '{}' },
  ];
  check('候选选择同时避开已标样本和近期家族', chooseAnnotationCandidate(candidates, new Set(['c1:s1']), new Set(['recent']))?.id === 'fresh');
  check('只剩本人看过的样本时返回双标耗尽原因', claimUnavailableReason({ activeCampaigns: 1, remainingGlobal: 3, blockedByDoubleBlind: 3 }) === 'DOUBLE_BLIND_EXHAUSTED');
  check('未加入活动时返回未分配原因', claimUnavailableReason({ activeCampaigns: 1, assignedCampaigns: 0, remainingGlobal: 0, blockedByDoubleBlind: 0 }) === 'NO_CAMPAIGN_ASSIGNMENT');
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
