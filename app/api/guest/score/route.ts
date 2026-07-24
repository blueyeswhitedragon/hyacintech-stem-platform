import { NextResponse } from 'next/server';
import { generateReferenceScore } from '@/app/lib/llm/scoring';
import { checkRateLimit } from '@/app/lib/guestRateLimit';
import type { Stage5Sections } from '@/app/models/stageData';

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}

const KEYS: (keyof Stage5Sections)[] = [
  'purpose', 'hypothesis', 'materials', 'procedure', 'dataSummary', 'analysis', 'conclusion', 'limitationsDiscussion', 'reflection',
];

// POST /api/guest/score —— 体验模式报告 AI 参考评分（免登录，限流，不落库）
export async function POST(req: Request) {
  const rl = checkRateLimit(clientIp(req));
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate_limited', message: rl.error }, { status: 429 });
  }

  let body: { sections?: Partial<Stage5Sections> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  if (!body.sections || typeof body.sections !== 'object') {
    return NextResponse.json({ error: '缺少报告内容' }, { status: 400 });
  }

  // 规整为完整 Stage5Sections（缺字段补空串）
  const sections = Object.fromEntries(
    KEYS.map((k) => [k, typeof body.sections![k] === 'string' ? body.sections![k] : ''])
  ) as unknown as Stage5Sections;
  sections.limitationsDiscussion ||= sections.reflection;
  sections.reflection = sections.limitationsDiscussion;

  const score = await generateReferenceScore(sections);
  return NextResponse.json({ score });
}
