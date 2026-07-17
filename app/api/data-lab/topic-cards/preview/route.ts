import type { TopicCard } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { compileOneCase } from '@/app/lib/dataLab/bootstrap/caseCompiler';
import {
  topicCardV2Fields,
  validateTopicCardInput,
  type TopicCardInput,
} from '@/app/lib/dataLab/bootstrap/contracts';
import { deriveAcceptableDirections } from '@/app/lib/dataLab/bootstrap/topicCardV2';
import { TOPIC_ACTIVITY_MODE_LABELS } from '@/app/lib/dataLab/labels';
import { DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION } from '@/app/lib/tutorLanguage';

const FACT_KEY_LABELS: Record<string, string> = {
  researchQuestion: '研究问题',
  hypothesis: '学生当前预测',
  independentVariable: '主动改变的条件',
  dependentVariable: '观察结果',
  name: '名称',
  levels: '测试档位',
  measurement: '测量方式',
  unit: '单位',
  controlledVariables: '保持一致的条件',
  materials: '材料',
  procedure: '操作步骤',
  repeatCount: '重复次数',
  safetyNotes: '安全提醒',
};

function humanizeVisibleFacts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(humanizeVisibleFacts);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [FACT_KEY_LABELS[key] ?? key, humanizeVisibleFacts(item)]));
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return TOPIC_ACTIVITY_MODE_LABELS[value] ?? value;
  return value;
}

function inMemoryTopicCard(input: TopicCardInput): TopicCard {
  const now = new Date();
  const v2 = topicCardV2Fields(input);
  return {
    id: 'topic-card-preview',
    displayTitle: input.displayTitle.trim(),
    studentOpening: input.studentOpening.trim(),
    internalArchetype: input.internalArchetype.trim() || 'preview',
    subject: input.subject,
    gradeBand: input.gradeBand.trim(),
    coreMechanism: input.coreMechanism.trim(),
    acceptableDirectionsJson: JSON.stringify(v2 ? deriveAcceptableDirections(v2.inquiryBridges) : input.acceptableDirections),
    forbiddenDirectionsJson: JSON.stringify(input.forbiddenDirections),
    curriculumAnchorsJson: JSON.stringify(input.curriculumAnchors),
    sourceJson: JSON.stringify(input.source),
    compilerEvidenceJson: JSON.stringify(input.compilerEvidence ?? {}),
    schemaVersion: v2 ? 2 : 1,
    revision: 1,
    revisionOfId: null,
    activityMode: v2?.activityMode ?? '',
    contextModule: v2?.contextModule ?? '',
    disciplineAnchorsJson: JSON.stringify(v2?.disciplineAnchors ?? []),
    authenticNeed: v2?.authenticNeed ?? '',
    stakeholder: v2?.stakeholder ?? '',
    engineeringGoal: v2?.engineeringGoal ?? '',
    constraintsJson: JSON.stringify(v2?.constraints ?? []),
    performanceCriteriaJson: JSON.stringify(v2?.performanceCriteria ?? []),
    inquiryBridgesJson: JSON.stringify(v2?.inquiryBridges ?? []),
    sourceCandidateId: input.sourceCandidateId ?? null,
    status: 'DRAFT',
    rejectionReason: '',
    createdById: null,
    approvedById: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const input = await request.json() as TopicCardInput;
    const errors = validateTopicCardInput(input);
    if (errors.length) return NextResponse.json({ errors, preview: null });
    const card = inMemoryTopicCard(input);
    const samples = [
      compileOneCase({ card, phase: 1, challenge: '模糊输入', variant: 0, split: 'PILOT', promptVersion: DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION }),
      compileOneCase({ card, phase: 2, challenge: '测量方式含糊', variant: 0, split: 'PILOT', promptVersion: DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION }),
      compileOneCase({ card, phase: 4, challenge: '证据充分', variant: 0, split: 'PILOT', promptVersion: DATA_LAB_TUTOR_LANGUAGE_PROMPT_VERSION }),
    ];
    const phaseFourState = samples[2].stageState as Record<string, unknown>;
    return NextResponse.json({
      errors: [],
      preview: {
        studentMessages: samples.map((sample) => ({ phase: sample.phase, message: sample.studentMessage || '平台状态变化触发，本回合没有学生发言。' })),
        deterministicRows: {
          columns: Array.isArray(phaseFourState.数据列) ? phaseFourState.数据列 : [],
          rows: Array.isArray(phaseFourState.数据记录) ? phaseFourState.数据记录 : [],
        },
        visibleFactsSummary: samples.map((sample) => ({ phase: sample.phase, facts: humanizeVisibleFacts((sample.visibleFacts as { challengeVisibleState?: unknown }).challengeVisibleState ?? {}) })),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
