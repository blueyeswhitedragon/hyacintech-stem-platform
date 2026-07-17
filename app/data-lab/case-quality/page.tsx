import { redirect } from 'next/navigation';
import CaseQualityManager from '@/app/components/dataLab/CaseQualityManager';
import { listTutorCaseQualityTasks } from '@/app/lib/dataLab/bootstrap/service';
import { getCurrentUser } from '@/app/lib/session';

export default async function CaseQualityPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const tasks = await listTutorCaseQualityTasks();
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-semibold">案例退回处理</h1><p className="mt-1 text-sm text-gray-500">核对审核人员提交的学生问题修改；批准后创建独立新版本并重新生成候选，旧审核证据保持不变。</p></div>
    <CaseQualityManager tasks={tasks} />
  </div>;
}
