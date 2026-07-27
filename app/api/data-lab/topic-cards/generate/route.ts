import { NextResponse } from 'next/server';
import { authFailureResponse, requireRole } from '@/app/lib/auth';
import { generateTopicCardDrafts } from '@/app/lib/dataLab/bootstrap/service';
import { BOOTSTRAP_SUBJECTS, type BootstrapSubject } from '@/app/lib/dataLab/bootstrap/contracts';
import { TOPIC_ACTIVITY_MODES, TOPIC_CONTEXT_MODULES, type TopicActivityMode, type TopicContextModule } from '@/app/lib/dataLab/bootstrap/topicCardV2';

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return authFailureResponse(auth);
  try {
    const body = await request.json() as { theme?: string; subject?: string; activityMode?: string; contextModule?: string; count?: number };
    if (body.subject && !BOOTSTRAP_SUBJECTS.includes(body.subject as BootstrapSubject)) throw new Error('指定学科不在允许范围内');
    const subject = body.subject ? body.subject as BootstrapSubject : undefined;
    const activityMode = body.activityMode && TOPIC_ACTIVITY_MODES.includes(body.activityMode as TopicActivityMode) ? body.activityMode as TopicActivityMode : undefined;
    const contextModule = body.contextModule && TOPIC_CONTEXT_MODULES.includes(body.contextModule as TopicContextModule) ? body.contextModule as TopicContextModule : undefined;
    const result = await generateTopicCardDrafts({ theme: body.theme, subject, activityMode, contextModule, count: body.count, user: auth.user });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
