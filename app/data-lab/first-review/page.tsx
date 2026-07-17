import { redirect } from 'next/navigation';
import TutorReviewWorkbench from '@/app/components/dataLab/TutorReviewWorkbench';
import { getCurrentUser } from '@/app/lib/session';

export default async function FirstReviewPage() {
  const user = await getCurrentUser();
  if (!user || !['annotator', 'admin'].includes(user.role)) redirect('/data-lab');
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">导师草稿初审</h1><p className="mt-1 text-sm text-gray-500">标注员负责比较两个候选、选择或合并基底、编辑完整导师回复并记录明确理由。AI 可以辅助，但默认不能绕过人工初审。</p></div><TutorReviewWorkbench type="EDIT" /></div>;
}
