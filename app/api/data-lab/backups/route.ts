import { NextResponse } from 'next/server';
import { requireRole } from '@/app/lib/auth';
import { createDataLabBackup } from '@/app/lib/dataLab/backup';
import { db } from '@/app/lib/db';

export async function POST() {
  const auth = await requireRole('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await createDataLabBackup();
    await db.dataLabAuditLog.create({ data: { actorId: auth.user.id, action: 'DATABASE_BACKUP_CREATED', entityType: 'Database', entityId: result.sha256, payloadJson: JSON.stringify(result) } });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
