import { requireRole } from '@/app/lib/auth';
import { workloadCsv } from '@/app/lib/dataLab/service';

export async function GET() {
  const auth = await requireRole('admin');
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const csv = await workloadCsv();
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="annotation-workload.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
