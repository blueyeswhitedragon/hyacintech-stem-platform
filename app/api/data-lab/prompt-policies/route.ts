import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import {
  ensureDataLabRuntimeRegistry,
  listPromptPolicies,
} from '@/app/lib/dataLab/runtimeRegistry';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await ensureDataLabRuntimeRegistry(auth.user);
  return NextResponse.json({ policies: await listPromptPolicies() });
}

export async function POST() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    await ensureDataLabRuntimeRegistry(auth.user);
    return NextResponse.json({ policies: await listPromptPolicies() }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
