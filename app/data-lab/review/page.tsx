import ReviewWorkbench from '@/app/components/dataLab/ReviewWorkbench';

export default function ReviewPage() {
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">复审与仲裁</h1><p className="mt-1 text-sm text-gray-500">决策前不显示作者、风格、教师模型来源或候选等级。</p></div><ReviewWorkbench /></div>;
}
