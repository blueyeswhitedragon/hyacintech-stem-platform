import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import {
  createProviderConnection,
  listProviderConnections,
} from '@/app/lib/dataLab/runtimeRegistry';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ connections: await listProviderConnections() });
}

export async function POST(request: Request) {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json() as {
      name?: string;
      protocol?: string;
      baseUrl?: string;
      credentialSource?: string;
      envVarName?: string;
      apiKey?: string;
      capabilities?: unknown;
    };
    const connection = await createProviderConnection({
      name: body.name ?? '',
      protocol: body.protocol,
      baseUrl: body.baseUrl ?? '',
      credentialSource: body.credentialSource ?? 'ENV',
      envVarName: body.envVarName,
      apiKey: body.apiKey,
      capabilities: body.capabilities,
      user: auth.user,
    });
    return NextResponse.json({ connection }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
