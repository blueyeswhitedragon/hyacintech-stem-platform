import { NextResponse } from 'next/server';
import { db } from '@/app/lib/db';
import { requireRole } from '@/app/lib/auth';
import { getClassAssignments } from '@/app/lib/queries';
import {
  DEFAULT_STYLE_POLICY_VERSION,
  isAssistantStyleSelection,
  type AssistantStyleSelection,
} from '@/app/lib/stylePolicy';
import { DATA_POLICY_VERSION } from '@/app/lib/productionCandidates';

// 校验班级存在且归属当前教师
async function assertClassOwnership(classId: string, teacherId: string) {
  const klass = await db.class.findUnique({
    where: { id: classId },
    select: { teacherId: true },
  });
  if (!klass) return { ok: false as const, error: '班级不存在', status: 404 as const };
  if (klass.teacherId !== teacherId)
    return { ok: false as const, error: '无权限', status: 403 as const };
  return { ok: true as const };
}

// POST /api/assignments —— 教师发布作业到指定班级
export async function POST(request: Request) {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { classId?: string; title?: string; topicDirection?: string; dueDate?: string; assistantStyleFamily?: AssistantStyleSelection; allowDataContribution?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const classId = body.classId?.trim();
  const title = body.title?.trim();
  if (!classId) return NextResponse.json({ error: '请选择班级' }, { status: 400 });
  if (!title) return NextResponse.json({ error: '请填写作业标题' }, { status: 400 });
  const assistantStyleFamily = body.assistantStyleFamily ?? 'auto';
  if (!isAssistantStyleSelection(assistantStyleFamily)) {
    return NextResponse.json({ error: '导师回复风格无效' }, { status: 400 });
  }

  const own = await assertClassOwnership(classId, auth.user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status });

  let dueDate: Date | null = null;
  if (body.dueDate) {
    const d = new Date(body.dueDate);
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: '截止日期格式错误' }, { status: 400 });
    }
    dueDate = d;
  }

  const assignment = await db.assignment.create({
    data: {
      classId,
      title,
      topicDirection: body.topicDirection?.trim() || null,
      assistantStyleFamily,
      stylePolicyVersion: DEFAULT_STYLE_POLICY_VERSION,
      dataContributionMode: body.allowDataContribution ? 'CONSENT_REQUIRED' : 'DISABLED',
      dataPolicyVersion: body.allowDataContribution ? DATA_POLICY_VERSION : null,
      dueDate,
    },
    select: { id: true, title: true, topicDirection: true, assistantStyleFamily: true, stylePolicyVersion: true, dataContributionMode: true, dataPolicyVersion: true, dueDate: true, createdAt: true },
  });

  return NextResponse.json({ assignment }, { status: 201 });
}

// GET /api/assignments?classId=... —— 教师获取某班级作业列表
export async function GET(request: Request) {
  const auth = await requireRole('teacher');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const classId = new URL(request.url).searchParams.get('classId')?.trim();
  if (!classId) return NextResponse.json({ error: '缺少 classId' }, { status: 400 });

  const own = await assertClassOwnership(classId, auth.user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status });

  const assignments = await getClassAssignments(classId);
  return NextResponse.json({ assignments });
}
