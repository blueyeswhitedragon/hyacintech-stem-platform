#!/usr/bin/env tsx
import './load-script-env';
import { callStudentFactExtractor, mergeExtractedFacts } from '../app/lib/stateExtractor';
import { tutorFocusPlan } from '../app/lib/serverTutorState';
import { evaluateStage2Readiness } from '../app/lib/stage2Readiness';
import { buildTutorVisibleState, callTutorLanguageWithTrace } from '../app/lib/tutorLanguage';
import { validateConfig } from '../app/lib/llm/provider';
import type { StageData } from '../app/models/stageData';

const messages = [
  '我认为每天光照时间越多高度越高',
  '0、8、12、24小时四组',
  '是的，我控制光照时长作为变量，其他条件都一样',
  '水培，保证营养液量和水位等相同',
  '用刻度尺从种子量到茎尖，不包括根',
  '每天固定时间测量，轻柔拉直',
  '每组10颗取平均值，差不多就可以了',
];

async function main() {
  let stageData: StageData = {
    stage1: {
      confirmed: true,
      snapshot: '《探究问题确认书》\n研究问题：光照时长如何影响豆苗高度？',
      researchQuestion: '光照时长如何影响豆苗高度？',
    },
  };
  let afterNumericLevels: StageData | undefined;

  for (const message of messages) {
    const expectedFocusId = tutorFocusPlan(2, stageData).allowedFocusIds[0];
    const extraction = await callStudentFactExtractor({
      stage: 2,
      studentMessages: [message],
      expectedFocusId,
      existingFacts: stageData.extractedFacts,
    });
    stageData = mergeExtractedFacts(2, stageData, extraction.accepted, { currentStudentMessage: message, expectedFocusId }).stageData;
    if (message.startsWith('0、8')) afterNumericLevels = stageData;
    console.log(JSON.stringify({
      message,
      expectedFocusId,
      acceptedFields: extraction.accepted.map((fact) => fact.field),
      deterministicFallbacks: extraction.deterministicFallbacks,
      nextFocusId: evaluateStage2Readiness(stageData).nextFocusId,
    }));
  }

  const readiness = evaluateStage2Readiness(stageData);
  if (!readiness.complete || !stageData.stage2?.planDraft || !stageData.stage2.draftHash) {
    throw new Error(`Transcript did not produce a confirmable plan: ${JSON.stringify(readiness)}`);
  }
  const config = validateConfig();
  if (!config.valid || !config.provider || !config.model) throw new Error(config.issues.join(' '));
  if (!afterNumericLevels) throw new Error('Missing numeric-level checkpoint state');

  const tutorAtLevelsFocus = tutorFocusPlan(2, afterNumericLevels);
  const tutorAtLevelsReadiness = evaluateStage2Readiness(afterNumericLevels);
  const tutorAtLevels = await callTutorLanguageWithTrace({
    phase: 2,
    triggerType: 'USER_MESSAGE',
    currentStudentMessage: '0、8、12、24小时四组',
    priorStudentMessages: [],
    tutorHistory: [],
    visibleFacts: buildTutorVisibleState(2, afterNumericLevels),
    allowedFocusIds: tutorAtLevelsFocus.allowedFocusIds,
    focusDescriptions: tutorAtLevelsFocus.focusDescriptions,
    completedFocusIds: tutorAtLevelsReadiness.completedFields,
    planReady: tutorAtLevelsReadiness.complete,
  }, { provider: config.provider, model: config.model });
  if (tutorAtLevels.response.focus !== 'independent_variable' || /(?:哪些|哪几|几个).{0,12}(?:时长|组)|四组.{0,12}(?:最终|调整|增加)/.test(tutorAtLevels.response.dialogue)) {
    throw new Error(`Tutor reopened sufficient levels: ${tutorAtLevels.response.dialogue}`);
  }

  const finalFocus = tutorFocusPlan(2, stageData);
  const finalTutor = await callTutorLanguageWithTrace({
    phase: 2,
    triggerType: 'USER_MESSAGE',
    currentStudentMessage: messages.at(-1) ?? '',
    priorStudentMessages: messages.slice(0, -1),
    tutorHistory: [],
    visibleFacts: buildTutorVisibleState(2, stageData),
    allowedFocusIds: finalFocus.allowedFocusIds,
    focusDescriptions: finalFocus.focusDescriptions,
    completedFocusIds: readiness.completedFields,
    planReady: readiness.complete,
  }, { provider: config.provider, model: config.model });
  if (finalTutor.response.focus !== 'plan_confirmation' || finalTutor.response.interactionType !== 'checkpoint') {
    throw new Error(`Tutor did not converge to checkpoint: ${JSON.stringify(finalTutor.response)}`);
  }
  console.log(JSON.stringify({
    status: 'PASS',
    readiness,
    levels: stageData.stage2.planDraft.independentVariable.levels,
    repeatCount: stageData.stage2.planDraft.repeatCount,
    tutorAfterLevels: tutorAtLevels.response,
    finalTutor: finalTutor.response,
    provenance: stageData.stage2.planProvenance,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
