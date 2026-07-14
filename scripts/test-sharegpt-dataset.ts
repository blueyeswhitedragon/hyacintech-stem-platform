/**
 * Deterministic validation for the hand-crafted ShareGPT STEM seed set.
 *
 * Run:
 *   npx tsx scripts/test-sharegpt-dataset.ts
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { safeParseChatResponse } from '../app/lib/llm/parser';
import type { ChatResponse } from '../app/models/types';
import { evaluateShareGPTRecordSemantic } from './semantic-guardrails';
import { STAGE_CONTRACT_VERSION, validateStageResponseBehavior, type StageTriggerType } from '../app/lib/stageContract';

const DEFAULT_DATASET = path.join(process.cwd(), 'data/sft/sharegpt-stem-seed.json');
const DATASET = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DATASET;

type From = 'human' | 'gpt';

interface ShareGPTMessage {
  from: From;
  value: string;
}

interface ShareGPTRecord {
  id: string;
  source?: string;
  scenario: string;
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  rubricTargets: string[];
  qualityNotes?: string;
  conversations: ShareGPTMessage[];
  meta?: {
    personaId?: string;
    subject?: string;
    studentType?: string;
    failureModes?: string[];
    expectedTransformation?: unknown;
    tier?: string;
    sourceTag?: string;
    stageContractVersion?: string;
    stageTriggerType?: string;
    systemPrompt?: string;
    generationContext?: Record<string, unknown>;
  };
}

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function parseAssistantJson(value: string): ChatResponse | null {
  try {
    const raw = JSON.parse(value);
    if (!raw || typeof raw !== 'object') return null;
    return safeParseChatResponse(value);
  } catch {
    return null;
  }
}

function hasLineMarker(dialogue: string): boolean {
  return /(^|\n)\s*[-*]\s+/.test(dialogue.replace(/\*\*[^*]+\*\*/g, ''));
}

function tooMuchBold(dialogue: string): boolean {
  const count = (dialogue.match(/\*\*/g) ?? []).length;
  return count % 2 !== 0 || count / 2 > 4;
}

function phase1LooksChoicey(response: ChatResponse): boolean {
  const text = [response.dialogue, ...(response.hints ?? [])].join('\n');
  return (
    response.next_action_type === 'ask_choice' ||
    (response.options?.length ?? 0) > 0 ||
    /你想.*还是.*还是/.test(text) ||
    /光照时间、光的颜色|生命怎么生存|材料怎么保护|设备怎么自动工作/.test(text)
  );
}

function hasNotesColumn(response: ChatResponse): boolean {
  return !!response.data_table_schema?.columns.some((c) => c.key === 'notes' && c.type === 'text');
}

function validateRecord(record: ShareGPTRecord) {
  check(`${record.id}: id present`, typeof record.id === 'string' && record.id.length > 0);
  check(`${record.id}: scenario present`, typeof record.scenario === 'string' && record.scenario.length > 0);
  check(`${record.id}: rubric targets present`, Array.isArray(record.rubricTargets) && record.rubricTargets.length > 0);
  check(`${record.id}: phase valid`, [1, 2, 3, 4, 5, 6].includes(record.phase));
  check(`${record.id}: conversations nonempty`, Array.isArray(record.conversations) && record.conversations.length >= 2);
  check(`${record.id}: starts with human`, record.conversations[0]?.from === 'human');
  const semantic = evaluateShareGPTRecordSemantic(record);
  check(`${record.id}: semantic guardrails pass${semantic.reason ? ` (${semantic.reason})` : ''}`, semantic.status === 'ok');
  const isV2 = record.meta?.stageContractVersion === STAGE_CONTRACT_VERSION;
  if (isV2) {
    check(`${record.id}: v2 has system prompt snapshot`, typeof record.meta?.systemPrompt === 'string' && record.meta.systemPrompt.trim().length > 0);
    check(`${record.id}: v2 has trigger type`, typeof record.meta?.stageTriggerType === 'string' && record.meta.stageTriggerType.length > 0);
  }

  for (let i = 0; i < record.conversations.length; i++) {
    const msg = record.conversations[i];
    check(`${record.id}: message ${i} from valid`, msg?.from === 'human' || msg?.from === 'gpt');
    check(`${record.id}: message ${i} value string`, typeof msg?.value === 'string' && msg.value.trim().length > 0);
    if (i > 0) {
      check(`${record.id}: message ${i} alternates`, record.conversations[i - 1].from !== msg.from);
    }

    if (msg.from !== 'gpt') continue;
    const parsed = parseAssistantJson(msg.value);
    check(`${record.id}: assistant ${i} valid JSON ChatResponse`, parsed !== null);
    if (!parsed) continue;
    check(`${record.id}: assistant ${i} dialogue present`, parsed.dialogue.trim().length > 0);
    check(`${record.id}: assistant ${i} no markdown list marker`, !hasLineMarker(parsed.dialogue));
    check(`${record.id}: assistant ${i} bold bounded`, !tooMuchBold(parsed.dialogue));
    check(`${record.id}: assistant ${i} options/action consistent`, !parsed.options?.length || parsed.next_action_type === 'ask_choice');

    if (record.phase === 1) {
      check(`${record.id}: phase1 no options/ask_choice`, !phase1LooksChoicey(parsed));
      if (parsed.phase_complete === true || parsed.stage1_confirmed === true) {
        check(`${record.id}: phase1 confirmation has stage1_confirmed`, parsed.stage1_confirmed === true);
        check(`${record.id}: phase1 confirmation has theme_mapping`, !!parsed.theme_mapping);
        check(`${record.id}: phase1 confirmation has snapshot`, !!parsed.snapshot?.trim());
        if (isV2) {
          check(`${record.id}: phase1 confirmation has factor direction`, !!parsed.topic_direction?.factor?.trim());
          check(`${record.id}: phase1 confirmation has phenomenon direction`, !!parsed.topic_direction?.phenomenon?.trim());
          check(`${record.id}: phase1 confirmation does not operationalize dependent/control`, !parsed.variables?.dependent?.trim() && !(parsed.variables?.controlled?.length));
        } else {
          check(`${record.id}: legacy phase1 confirmation has independent variable`, !!parsed.variables?.independent?.trim());
        }
      }
    }

    if (record.phase === 2 && (parsed.data_table_schema || parsed.next_action_type === 'confirmation' || parsed.phase_complete === true)) {
      check(`${record.id}: phase2 confirmation has schema`, !!parsed.data_table_schema);
      check(`${record.id}: phase2 schema has notes`, hasNotesColumn(parsed));
      check(`${record.id}: phase2 schema minRows at least 3`, (parsed.data_table_schema?.minRows ?? 0) >= 3);
      check(`${record.id}: phase2 schema maxRows 200`, parsed.data_table_schema?.maxRows === 200);
      if (isV2) check(`${record.id}: phase2 v2 has experiment_plan`, !!parsed.experiment_plan);
    }

    if (record.phase === 5) {
      const sections = parsed.report_sections;
      check(`${record.id}: phase5 has report_sections`, !!sections);
      if (sections) {
        for (const key of ['purpose', 'hypothesis', 'materials', 'procedure', 'dataSummary', 'analysis'] as const) {
          check(`${record.id}: phase5 section ${key}`, sections[key].trim().length > 0);
        }
      }
    }

    if (isV2) {
      const assistantTurnIndex = record.conversations.slice(0, i).filter((message) => message.from === 'gpt').length;
      const turnTriggerTypes = record.meta?.generationContext?.turnTriggerTypes;
      const triggerType = (Array.isArray(turnTriggerTypes) && typeof turnTriggerTypes[assistantTurnIndex] === 'string'
        ? turnTriggerTypes[assistantTurnIndex]
        : record.meta?.stageTriggerType ?? 'USER_MESSAGE') as StageTriggerType;
      const stageIssues = validateStageResponseBehavior(record.phase, parsed, { triggerType, visibleContext: record.meta?.systemPrompt });
      check(`${record.id}: assistant ${i} stage-contract has no errors`, !stageIssues.some((issue) => issue.severity === 'error'));
    }
  }
}

async function main() {
  const raw = await readFile(DATASET, 'utf8');
  const data = JSON.parse(raw) as ShareGPTRecord[];
  check('dataset is array', Array.isArray(data));
  const isDefaultDataset = DATASET === DEFAULT_DATASET;
  check(isDefaultDataset ? 'dataset has seed records' : 'dataset has records', data.length >= (isDefaultDataset ? 8 : 1));

  const ids = new Set<string>();
  for (const record of data) {
    check(`${record.id}: unique id`, !ids.has(record.id));
    ids.add(record.id);
    validateRecord(record);
  }

  if (isDefaultDataset) {
    const targetCoverage = new Set(data.flatMap((r) => r.rubricTargets ?? []));
    for (const target of [
      'theme_fidelity',
      'student_agency',
      'proxy_quality',
      'transformation_reasoning',
      'interdisciplinary_integration',
      'cognitive_load_control',
      'stage_discipline',
      'stem_fit',
      'safety',
      'structure_compliance',
      'expression',
    ]) {
      check(`rubric coverage: ${target}`, targetCoverage.has(target));
    }
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
