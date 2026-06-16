import Link from 'next/link';
import GuestWorkspace from '@/app/components/GuestWorkspace';

export default function ExperiencePage() {
  return (
    <main className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b p-4 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-blue-600">体验模式</h1>
            <span className="text-sm text-gray-400 hidden sm:inline">无需登录 · 进度仅保存在本页，刷新后清空</span>
          </div>
          <Link href="/" className="text-blue-600 hover:underline text-sm">返回首页</Link>
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto p-4 min-h-0">
        <div className="h-[calc(100vh-8rem)]">
          <GuestWorkspace />
        </div>
      </div>
    </main>
  );
}
