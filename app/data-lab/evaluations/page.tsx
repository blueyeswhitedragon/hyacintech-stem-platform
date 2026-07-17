import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/app/lib/session';

export default async function EvaluationsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  redirect('/data-lab/models#evaluation');
}
