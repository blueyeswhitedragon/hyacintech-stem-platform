import Link from 'next/link';
import { getCurrentUser } from './lib/session';
import { dashboardForRole, roleLabel } from './lib/roles';

export default async function Home() {
  const user = await getCurrentUser();
  const dashboard = user ? dashboardForRole(user.role) : '/student/dashboard';

  return (
    <main className="min-h-screen flex flex-col">
      <header className="bg-white border-b p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center">
            <h1 className="text-2xl font-bold text-blue-600">Hyacintech</h1>
            <span className="ml-4 font-medium text-gray-500">AI驱动的STEM教育平台</span>
          </div>
          {user ? (
            <Link href={dashboard} className="text-sm text-blue-600 hover:underline">
              {user.displayName}（{roleLabel(user.role)}）→ 进入
            </Link>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <Link href="/auth/login" className="text-blue-600 hover:underline">登录</Link>
              <Link href="/auth/register" className="text-blue-600 hover:underline">注册</Link>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-gray-800 mb-3">用 AI 导师，走完一次完整的科学探究</h2>
          <p className="text-gray-500 mb-8">
            基于上海市初中科学课程标准，AI 教师引导你完成「选题 → 方案 → 执行 → 分析 → 成果 → 反思」六个阶段，全程安全监护。
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/experience"
              className="px-6 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600"
            >
              直接体验（无需注册）
            </Link>
            {user ? (
              <Link
                href={dashboard}
                className="px-6 py-3 bg-white border border-blue-500 text-blue-600 rounded-lg font-medium hover:bg-blue-50"
              >
                进入我的{user.role === 'student' ? '主页' : '工作台'}
              </Link>
            ) : (
              <Link
                href="/auth/login"
                className="px-6 py-3 bg-white border border-blue-500 text-blue-600 rounded-lg font-medium hover:bg-blue-50"
              >
                登录 / 注册
              </Link>
            )}
          </div>

          <p className="text-xs text-gray-400 mt-6">
            体验模式仅在本页保存进度（刷新清空）；正式账号支持教师布置作业、进度持久化与审核。
          </p>
        </div>
      </div>

      <footer className="bg-gray-50 border-t py-6">
        <div className="max-w-5xl mx-auto px-4 text-center text-gray-500 text-sm">
          <p>Copyright © 2024 Hyacintech 团队. 保留所有权利。</p>
          <p className="mt-1">基于上海市课程标准，让STEM教育资源普惠全国各地学生</p>
        </div>
      </footer>
    </main>
  );
}
