import { PrismaClient } from '@prisma/client';
import { validateTopicCardInput } from '../app/lib/dataLab/bootstrap/contracts';

// 完全复刻 TopicCardManager 里的 bridgeFromUnknown + lines + cardPayload
function listValue(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }
function lines(value: string) { return value.split('\n').map((item) => item.trim()).filter(Boolean); }
function bridgeFromUnknown(value: unknown, index: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null as never;
  const raw = value as Record<string, unknown>;
  const scaffold = raw.testScaffold && typeof raw.testScaffold === 'object' && !Array.isArray(raw.testScaffold) ? raw.testScaffold as Record<string, unknown> : {};
  const range = Array.isArray(scaffold.safeValueRange) ? scaffold.safeValueRange : [];
  return {
    label: String(raw.label ?? `候选方向 ${index + 1}`), retainedFeature: String(raw.retainedFeature ?? ''), researchQuestion: String(raw.researchQuestion ?? ''),
    factor: String(raw.factor ?? ''), phenomenon: String(raw.phenomenon ?? ''), levels: listValue(scaffold.levels).join('\n'), measurement: String(scaffold.measurement ?? ''),
    unit: String(scaffold.unit ?? ''), metricKind: String(scaffold.metricKind ?? 'OTHER'), safeMin: range[0] === undefined ? '' : String(range[0]), safeMax: range[1] === undefined ? '' : String(range[1]),
    controlledConditions: listValue(scaffold.controlledConditions).join('\n'), returnToDesign: String(raw.returnToDesign ?? ''),
  };
}

async function main() {
  const db = new PrismaClient();
  const card = await db.topicCard.findUnique({ where: { id: 'cb2de9bf-9e55-42b3-90db-c3cc53e0aabf' } });
  if (!card) { console.log('card not found'); return; }
  const parseList = (raw: string) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
  // edit() 填表
  const form = {
    displayTitle: card.displayTitle, studentOpening: card.studentOpening, internalArchetype: card.internalArchetype, subject: card.subject, gradeBand: card.gradeBand,
    coreMechanism: card.coreMechanism, forbiddenDirections: parseList(card.forbiddenDirectionsJson).join('\n'), curriculumAnchors: parseList(card.curriculumAnchorsJson).join('\n'),
    sourceTitle: '', activityMode: card.activityMode || 'SCIENTIFIC_INQUIRY', contextModule: card.contextModule || 'LIFE_HEALTH',
    disciplineAnchors: parseList(card.disciplineAnchorsJson), authenticNeed: card.authenticNeed || card.studentOpening,
    stakeholder: card.stakeholder, engineeringGoal: card.engineeringGoal, constraints: parseList(card.constraintsJson).join('\n'), performanceCriteria: parseList(card.performanceCriteriaJson).join('\n'),
    bridges: JSON.parse(card.inquiryBridgesJson).map(bridgeFromUnknown),
  };
  // cardPayload()
  const payload: any = {
    displayTitle: form.displayTitle, studentOpening: form.studentOpening, internalArchetype: form.internalArchetype, subject: form.subject, gradeBand: form.gradeBand,
    coreMechanism: form.coreMechanism, acceptableDirections: form.bridges.map((b: any) => b.researchQuestion).filter(Boolean), forbiddenDirections: lines(form.forbiddenDirections),
    curriculumAnchors: lines(form.curriculumAnchors), source: { title: form.sourceTitle, kind: 'manual_v2_edit' },
    schemaVersion: 2, activityMode: form.activityMode, contextModule: form.contextModule, disciplineAnchors: form.disciplineAnchors, authenticNeed: form.authenticNeed,
    stakeholder: form.stakeholder, engineeringGoal: form.engineeringGoal, constraints: lines(form.constraints), performanceCriteria: lines(form.performanceCriteria),
    inquiryBridges: form.bridges.map((bridge: any) => ({
      label: bridge.label, retainedFeature: bridge.retainedFeature, researchQuestion: bridge.researchQuestion, factor: bridge.factor, phenomenon: bridge.phenomenon,
      testScaffold: {
        levels: lines(bridge.levels), measurement: bridge.measurement, unit: bridge.unit, metricKind: bridge.metricKind,
        ...(bridge.safeMin !== '' && bridge.safeMax !== '' ? { safeValueRange: [Number(bridge.safeMin), Number(bridge.safeMax)] } : {}),
        controlledConditions: lines(bridge.controlledConditions),
      },
      ...(bridge.returnToDesign.trim() ? { returnToDesign: bridge.returnToDesign } : {}),
    })),
    compilerEvidence: {}, criticOverrideReason: '',
  };
  const errors = validateTopicCardInput(payload);
  console.log('编辑遮光卡的往返校验:', errors.length ? errors : '通过，无错误');
  await db.$disconnect();
}
main().catch(console.error);
