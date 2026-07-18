import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { createLLMProvider } from '@/app/lib/llm/provider';
import {
  deriveAcceptableDirections,
  normalizeInquiryBridges,
  TOPIC_CARD_SCHEMA_V2,
  type TopicActivityMode,
  type TopicContextModule,
  type TopicDisciplineAnchor,
} from '@/app/lib/dataLab/bootstrap/topicCardV2';
import type { TopicCardInput } from '@/app/lib/dataLab/bootstrap/contracts';

// 内部辅助函数（从 service.ts 复制）
function objectFromRaw(raw: string): Record<string, unknown> | null {
  const clean = raw.trim();
  try { return JSON.parse(clean) as Record<string, unknown>; } catch {}
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/m.exec(clean);
  if (fenced) {
    try { return JSON.parse(fenced[1]) as Record<string, unknown>; } catch {}
  }
  const braced = /(\{[\s\S]*\})/.exec(clean);
  if (braced) {
    try { return JSON.parse(braced[1]) as Record<string, unknown>; } catch {}
  }
  return null;
}

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '')).map((line) => line.trim()).filter(Boolean);
}

function ideationSystemPrompt() {
  return `你是初中科学教育的设计者，负责为初中生设计真实情境探究话题。
情境必须真实可信、贴近初中生生活或社会议题，材料安全易得；不得使用泡腾片、纸飞机等被过度使用的通用模板。
subject 只能是 biology_ecology、chemistry、physics、engineering、high_concept_interdisciplinary。
activityMode 只能是 SCIENTIFIC_INQUIRY、ENGINEERING_DESIGN、HYBRID。
contextModule 只能是 LIFE_HEALTH、ENERGY_ENVIRONMENT、INTELLIGENT_INFORMATION、AEROSPACE、DEEP_EARTH_OCEAN。
disciplineAnchors 只能从 biology、chemistry、physics、earth_science、mathematics、information_technology、engineering 中选择。
必须给出至少两个同一主题机制下的 inquiryBridges。每个桥包含 label、retainedFeature、researchQuestion、factor、phenomenon、testScaffold；testScaffold 包含至少两个 levels、measurement、unit、metricKind、controlledConditions，可选 safeValueRange。levels 必须是学生实际可设置的具体档位。工程或混合型还必须填写 engineeringGoal、constraints、performanceCriteria，并为每个桥填写 returnToDesign。
curriculumAnchors 至少一条，引用初中科学课程中的真实概念。
学生开场应自然表达困惑或需求，不得列出桥、变量或答案菜单。
只输出一个 JSON 对象：
{"displayTitle":"","studentOpening":"","subject":"","gradeBand":"初中","coreMechanism":"","activityMode":"","contextModule":"","disciplineAnchors":[],"authenticNeed":"","stakeholder":"","engineeringGoal":"","constraints":[],"performanceCriteria":[],"inquiryBridges":[],"forbiddenDirections":[],"curriculumAnchors":[]}。不要输出 internalArchetype。`;
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as Partial<TopicCardInput>;
    const provider = createLLMProvider({ role: 'EVALUATOR' });
    const system = ideationSystemPrompt();
    const brief = {
      已有标题: body.displayTitle || '由你创建',
      已有开场: body.studentOpening || '由你创建',
      已有核心机制: body.coreMechanism || '由你创建',
      指定活动模式: body.activityMode || '不限',
      指定情境模块: body.contextModule || '不限',
      提示: '基于以上信息补全缺失字段，特别是 inquiryBridges 研究路线',
    };
    const completion = await provider.complete(
      [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(brief) }],
      { useJsonFormat: true, maxTokens: 8000 },
    );
    const parsed = objectFromRaw(completion.content);
    if (!parsed) {
      return NextResponse.json({ error: `模型输出无法解析：${completion.content.slice(0, 200)}` }, { status: 400 });
    }
    const bridges = normalizeInquiryBridges(parsed.inquiryBridges);
    const filled: TopicCardInput = {
      displayTitle: String(parsed.displayTitle ?? body.displayTitle ?? ''),
      studentOpening: String(parsed.studentOpening ?? body.studentOpening ?? ''),
      internalArchetype: body.internalArchetype || 'ai_autofill_v1',
      subject: (String(parsed.subject ?? body.subject ?? 'biology_ecology')) as TopicCardInput['subject'],
      gradeBand: String(parsed.gradeBand ?? body.gradeBand ?? '初中'),
      coreMechanism: String(parsed.coreMechanism ?? body.coreMechanism ?? ''),
      acceptableDirections: deriveAcceptableDirections(bridges),
      forbiddenDirections: cleanStrings(parsed.forbiddenDirections),
      curriculumAnchors: cleanStrings(parsed.curriculumAnchors),
      source: body.source ?? { kind: 'AI_AUTOFILL', promptVersion: 'autofill-v1' },
      compilerEvidence: { raw: completion.content.slice(0, 1000), autofill: true },
      schemaVersion: TOPIC_CARD_SCHEMA_V2,
      activityMode: (body.activityMode ?? String(parsed.activityMode ?? 'SCIENTIFIC_INQUIRY')) as TopicActivityMode,
      contextModule: (body.contextModule ?? String(parsed.contextModule ?? 'LIFE_HEALTH')) as TopicContextModule,
      disciplineAnchors: (cleanStrings(parsed.disciplineAnchors).length ? cleanStrings(parsed.disciplineAnchors) : body.disciplineAnchors ?? ['biology']) as TopicDisciplineAnchor[],
      authenticNeed: String(parsed.authenticNeed ?? body.authenticNeed ?? ''),
      stakeholder: String(parsed.stakeholder ?? body.stakeholder ?? ''),
      engineeringGoal: String(parsed.engineeringGoal ?? body.engineeringGoal ?? ''),
      constraints: cleanStrings(parsed.constraints),
      performanceCriteria: cleanStrings(parsed.performanceCriteria),
      inquiryBridges: bridges,
    };
    return NextResponse.json({ filled });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
