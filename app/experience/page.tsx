import Link from 'next/link';
import GuestWorkspace from '@/app/components/GuestWorkspace';

export default function ExperiencePage() {
  return (
    <main className="density-roomy flex min-h-screen flex-col bg-canvas">
      <header className="flex-shrink-0 border-b border-hairline bg-canvas p-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="display-sm">体验模式</h1>
            <span className="hidden truncate text-sm text-muted sm:inline">无需登录 · 进度仅保存在本页，刷新后清空</span>
          </div>
          <Link href="/" className="shrink-0 text-sm text-muted transition-colors duration-[120ms] hover:text-coral">
            返回首页
          </Link>
        </div>
      </header>

      <div className="mx-auto min-h-0 w-full max-w-6xl flex-1 p-4">
        <div className="h-[calc(100vh-8rem)]">
          <GuestWorkspace />
        </div>
      </div>
    </main>
  );
}
