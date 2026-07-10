#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import type { ChatResponse } from '../app/models/types';
import { applyRevision, canonicalizeRecord, familyKey, parseShareGPTDataset, validateShareGPTRecord } from '../app/lib/dataLab/validation';

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
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
