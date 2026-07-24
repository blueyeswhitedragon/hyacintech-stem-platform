import Link from 'next/link';
import { getCurrentUser } from './lib/session';
import { dashboardForRole, roleLabel } from './lib/roles';

const phases = ['选题定向', '方案设计', '过程执行', '数据分析', '报告成型', '结果反思'];

export default async function Home() {
  const user = await getCurrentUser();
  const dashboard = user ? dashboardForRole(user.role) : '/student/dashboard';

  return (
    <main className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-sm font-bold text-white">H</div>
            <div className="min-w-0"><h1 className="text-xl font-bold tracking-tight text-blue-700">Hyacintech</h1><p className="truncate text-xs text-slate-500">AI 驱动的 STEM 教育平台</p></div>
          </div>
          {user ? (
            <Link href={dashboard} className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
              {user.displayName}（{roleLabel(user.role)}）→ 进入
            </Link>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <Link href="/auth/login" className="text-blue-700 hover:underline">登录</Link>
              <Link href="/auth/register" className="rounded-lg bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700">注册</Link>
            </div>
          )}
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,_#dbeafe,_transparent_70%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:py-24">
          <div><div className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">面向初中科学探究的六阶段 AI 导师</div><h2 className="mt-5 text-4xl font-bold leading-tight tracking-tight text-slate-950 sm:text-5xl">让每一次好奇，走成一条完整的科学探究路径</h2><p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">基于上海市初中科学课程标准，AI 导师陪伴学生完成选题、方案、执行、分析、报告与反思，并在关键环节提供安全提示和结构化支持。</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/experience"
              className="rounded-xl bg-blue-600 px-6 py-3 text-center font-medium text-white shadow-sm hover:bg-blue-700"
            >
              直接体验（无需注册）
            </Link>
            {user ? (
              <Link
                href={dashboard}
                className="rounded-xl border border-blue-300 bg-white px-6 py-3 text-center font-medium text-blue-700 hover:bg-blue-50"
              >
                进入我的{user.role === 'student' ? '主页' : '工作台'}
              </Link>
            ) : (
              <Link
                href="/auth/login"
                className="rounded-xl border border-blue-300 bg-white px-6 py-3 text-center font-medium text-blue-700 hover:bg-blue-50"
              >
                登录 / 注册
              </Link>
            )}
          </div><p className="mt-4 text-xs text-slate-500">
            体验模式仅在本页保存进度（刷新清空）；正式账号支持教师布置作业、进度持久化与审核。
          </p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-blue-100/60"><div className="flex items-center justify-between"><div><p className="text-xs font-medium text-blue-700">探究路径</p><h3 className="mt-1 text-lg font-semibold">六个阶段，步步有据</h3></div><span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-700">安全监护</span></div><ol className="mt-5 space-y-2">{phases.map((phase, index) => <li key={phase} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-blue-600 text-xs font-semibold text-white">{index + 1}</span><span className="font-medium text-slate-700">{phase}</span></li>)}</ol></div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-4 px-6 py-10 md:grid-cols-3"><article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-semibold text-blue-700">学生</p><h3 className="mt-2 text-lg font-semibold">从问题到成果</h3><p className="mt-2 text-sm leading-6 text-slate-600">AI 不代替思考，而是帮助学生明确变量、记录证据并形成自己的结论。</p></article><article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-semibold text-violet-700">教师</p><h3 className="mt-2 text-lg font-semibold">过程可见、关键可审</h3><p className="mt-2 text-sm leading-6 text-slate-600">查看阶段进度与关键产出，在方案和报告节点进行专业把关。</p></article><article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-semibold text-emerald-700">数据闭环</p><h3 className="mt-2 text-lg font-semibold">可追溯的教学模型改进</h3><p className="mt-2 text-sm leading-6 text-slate-600">通过结构化标注、匿名仲裁和版本发布持续提升课堂对话质量。</p></article></section>

      <footer className="mt-auto border-t border-slate-200 bg-white py-6">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-slate-500">
          <p>Copyright © 2024 Hyacintech 团队. 保留所有权利。</p>
          <p className="mt-1">基于上海市课程标准，让STEM教育资源普惠全国各地学生</p>
        </div>
      </footer>
    </main>
  );
}
