/** 诊断脚本（非测试）：用更大 token 预算在内存中重放该会话的阶段2，看 readiness 能否走完。不写库。 */
import { createLLMProvider } from '../app/lib/llm/provider';
import {
  buildExtractorPrompt, validateExtractedFacts,
  applyDeterministicExtractionFallbacks, mergeExtractedFacts,
} from '../app/lib/stateExtractor';
import { evaluateStage2Readiness } from '../app/lib/stage2Readiness';
import { repairJson } from '../app/lib/llm/jsonRepair';
import type { StageData } from '../app/models/stageData';

const MSGS = [
  '我觉得可能是正方形截面的最厉害，圆形截面的最不厉害。我想比较两者差异',
  '维持都是五个桥支撑，一个是原型一个是方形，然后在上面不断加砝码直到倒塌',
  '纸张类型保持一致、桥的长度保持一致',
  '是的',
  '是的，我确认',
  '实验只需要准备好控制变量的桥即可\n数据记录表每次加5G的砝码直到倒塌',
  '我认为四环节应该已经完成了，请你确认',
  '准确',
];

let stageData: StageData = {
  stage1: { confirmed: true, snapshot: '', researchQuestion: '观察不同形状桥梁的承重能力区别' },
  extractedFacts: {
    'stage1.researchQuestion': { value: '观察不同形状桥梁的承重能力区别', sourceQuote: '观察不同形状桥梁的承重能力区别' },
  },
} as StageData;

(async () => {
  for (const message of MSGS) {
    const provider = createLLMProvider({ role: 'EVALUATOR' });
    const readiness = evaluateStage2Readiness(stageData);
    const c = await provider.complete([
      { role: 'system', content: buildExtractorPrompt(2) },
      { role: 'user', content: JSON.stringify({
        currentStudentMessage: message,
        expectedFocusId: readiness.nextFocusId,
        existingFacts: stageData.extractedFacts ?? {},
      }) },
    ], { useJsonFormat: true, maxTokens: 12000 });
    let facts: unknown[] = [];
    try { facts = JSON.parse(repairJson(c.content)).facts ?? []; } catch { /* ignore */ }
    const validated = validateExtractedFacts(2, facts as never, [message]);
    const det = applyDeterministicExtractionFallbacks(2, validated.accepted, message);
    stageData = mergeExtractedFacts(2, stageData, det.accepted, { currentStudentMessage: message }).stageData;
    console.log(`\n>>> ${JSON.stringify(message.slice(0, 30))} finish=${c.finishReason}`);
    console.log('    接受:', det.accepted.map((f) => f.field).join(', ') || '(无)');
    console.log('    驳回:', validated.rejected.map((f) => `${f.field}:${f.reason}`).join(', ') || '(无)');
  }
  const final = evaluateStage2Readiness(stageData);
  console.log('\n================ 最终 readiness ================');
  console.log('complete:', final.complete);
  console.log('已完成字段:', final.completedFields.join(', '));
  console.log('仍缺字段:', final.missingFields.join(', '));
  console.log('仍缺环节:', final.missingSections.join(', '));
})();
