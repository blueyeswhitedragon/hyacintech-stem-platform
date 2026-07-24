import { PrismaClient } from '@prisma/client';
import { validateTopicCardInput } from '/root/hyacintech-stem-platform/app/lib/dataLab/bootstrap/contracts';

async function main() {
  const db = new PrismaClient();
  const card = await db.topicCard.findUnique({ where: { id: 'cb2de9bf-9e55-42b3-90db-c3cc53e0aabf' } });
  if (!card) { console.log('card not found'); return; }
  const bridges = JSON.parse(card.inquiryBridgesJson);
  const payload: any = {
    displayTitle: card.displayTitle, studentOpening: card.studentOpening, internalArchetype: card.internalArchetype,
    subject: card.subject, gradeBand: card.gradeBand, coreMechanism: card.coreMechanism,
    acceptableDirections: bridges.map((b: any) => b.researchQuestion).filter(Boolean),
    forbiddenDirections: JSON.parse(card.forbiddenDirectionsJson), curriculumAnchors: JSON.parse(card.curriculumAnchorsJson),
    source: { title: '', kind: 'manual_v2_edit' }, schemaVersion: 2,
    activityMode: card.activityMode, contextModule: card.contextModule, disciplineAnchors: JSON.parse(card.disciplineAnchorsJson),
    authenticNeed: card.authenticNeed, stakeholder: card.stakeholder, engineeringGoal: card.engineeringGoal,
    constraints: JSON.parse(card.constraintsJson), performanceCriteria: JSON.parse(card.performanceCriteriaJson),
    inquiryBridges: bridges, compilerEvidence: {}, criticOverrideReason: '',
  };
  const errors = validateTopicCardInput(payload);
  console.log('校验错误:', errors.length ? errors : '无');
  console.log('---card 字段---');
  console.log('displayTitle:', JSON.stringify(card.displayTitle));
  console.log('activityMode:', JSON.stringify(card.activityMode));
  console.log('contextModule:', JSON.stringify(card.contextModule));
  console.log('authenticNeed:', JSON.stringify(card.authenticNeed));
  console.log('coreMechanism:', JSON.stringify(card.coreMechanism));
  console.log('curriculumAnchors:', card.curriculumAnchorsJson);
  console.log('bridges count:', bridges.length);
  await db.$disconnect();
}
main().catch(console.error);
