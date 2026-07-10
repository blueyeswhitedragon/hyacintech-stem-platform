import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { createDatasetRelease, listReleases } from '@/app/lib/dataLab/service';
import type { ReleaseRecipe } from '@/app/lib/dataLab/types';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ releases: await listReleases() });
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as { version?: string; campaignId?: string; recipe?: Partial<ReleaseRecipe> };
    if (!body.version?.trim() || !body.campaignId) return NextResponse.json({ error: 'version 和 campaignId 必填' }, { status: 400 });
    const release = await createDatasetRelease({ version: body.version.trim(), campaignId: body.campaignId, recipe: body.recipe, user: auth.user });
    return NextResponse.json({ release }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
