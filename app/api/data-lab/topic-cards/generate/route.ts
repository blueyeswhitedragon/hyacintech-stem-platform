import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { generateTopicCardDrafts } from '@/app/lib/dataLab/bootstrap/service';
import { TOPIC_ACTIVITY_MODES, TOPIC_CONTEXT_MODULES, type TopicActivityMode, type TopicContextModule } from '@/app/lib/dataLab/bootstrap/topicCardV2';

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as { theme?: string; activityMode?: string; contextModule?: string; count?: number };
    const activityMode = body.activityMode && TOPIC_ACTIVITY_MODES.includes(body.activityMode as TopicActivityMode) ? body.activityMode as TopicActivityMode : undefined;
    const contextModule = body.contextModule && TOPIC_CONTEXT_MODULES.includes(body.contextModule as TopicContextModule) ? body.contextModule as TopicContextModule : undefined;
    const result = await generateTopicCardDrafts({ theme: body.theme, activityMode, contextModule, count: body.count, user: auth.user });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
