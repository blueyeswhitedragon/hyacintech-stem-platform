import ReviewWorkbench from '@/app/components/dataLab/ReviewWorkbench';

export default function ReviewPage() {
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">复审与仲裁</h1><p className="mt-1 text-sm text-gray-500">决策前不显示作者、来源模型或候选等级；目标风格会显示，用于判断各版本是否执行了同一规范。</p></div><ReviewWorkbench /></div>;
}
