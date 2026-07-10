import AnnotationWorkbench from '@/app/components/dataLab/AnnotationWorkbench';

export default function AnnotatePage() {
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">我的标注</h1><p className="mt-1 text-sm text-gray-500">只修改导师回复；学生消息、主题、阶段和来源证据保持只读。</p></div><AnnotationWorkbench /></div>;
}
