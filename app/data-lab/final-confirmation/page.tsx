import { redirect } from 'next/navigation';
import TutorReviewWorkbench from '@/app/components/dataLab/TutorReviewWorkbench';
import { getCurrentUser } from '@/app/lib/session';

export default async function FinalConfirmationPage() {
  const user = await getCurrentUser();
  if (!user || !['reviewer', 'admin'].includes(user.role)) redirect('/data-lab');
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">人工定稿</h1><p className="mt-1 text-sm text-gray-500">定稿人负责正式质量门：可修改导师回复后直接定稿，也可退回标注员修订，或将学生案例提交管理员处理。</p></div><TutorReviewWorkbench type="CONFIRM" /></div>;
}
