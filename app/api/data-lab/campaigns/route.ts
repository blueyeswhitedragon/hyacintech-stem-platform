import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { createCampaign, listCampaigns } from '@/app/lib/dataLab/service';
import { STYLE_FAMILIES, type CampaignParticipantInput, type CampaignSelection, type StyleQuota } from '@/app/lib/dataLab/types';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ campaigns: await listCampaigns() });
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as {
      name?: string;
      selection?: CampaignSelection;
      styleQuota?: StyleQuota;
      goldSlots?: number;
      silverDoubleReviewPercent?: number;
      maxActivePerAnnotator?: number;
      participants?: CampaignParticipantInput[];
    };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: '请填写活动名称' }, { status: 400 });
    if (body.styleQuota && Object.keys(body.styleQuota).some((style) => !STYLE_FAMILIES.includes(style as keyof typeof body.styleQuota))) {
      return NextResponse.json({ error: '包含未知风格族' }, { status: 400 });
    }
    const campaign = await createCampaign({
      name,
      selection: body.selection ?? {},
      styleQuota: body.styleQuota,
      goldSlots: body.goldSlots,
      silverDoubleReviewPercent: body.silverDoubleReviewPercent,
      maxActivePerAnnotator: body.maxActivePerAnnotator,
      participants: body.participants,
      user: auth.user,
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
